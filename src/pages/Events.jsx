// src/pages/Events.jsx
import { useEffect, useMemo, useState } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  Timestamp,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { useParams } from "react-router-dom";
import BackToHome from "../components/BackToHome";
import { useToast } from "../components/Toast.jsx";
import { useConfirm } from "../components/ConfirmModal.jsx";

/**
 * Mapping fijo (NO adivinanzas) para evitar mezclar botellas.
 */
const BOTTLE_ID_BY_ORG = {
  iglesia: "de-la-iglesia",
  "construyendo-lazos": "construyendo-lazos",
};

/* ------------------ helpers para agrupar por tiempo ------------------ */
function pad2(n) {
  return String(n).padStart(2, "0");
}
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfWeek(d) {
  const x = startOfDay(d);
  let dow = x.getDay();
  dow = dow === 0 ? 7 : dow;
  return addDays(x, -(dow - 1));
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfYear(d) {
  return new Date(d.getFullYear(), 0, 1);
}
function isoWeekNum(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - ys) / 86400000 + 1) / 7);
}
function fmtBucket(rangeId, d) {
  if (rangeId === "day") return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  if (rangeId === "week") return `${d.getFullYear()}-W${pad2(isoWeekNum(d))}`;
  if (rangeId === "month") return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  if (rangeId === "year") return `${d.getFullYear()}`;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** ✅ FIX: soporta Firestore Timestamp */
function bucketOf(rangeId, dateVal) {
  const raw = dateVal?.toDate ? dateVal.toDate() : dateVal;
  const d = raw ? new Date(raw) : new Date();

  if (rangeId === "day") return fmtBucket("day", startOfDay(d));
  if (rangeId === "week") return fmtBucket("week", startOfWeek(d));
  if (rangeId === "month") return fmtBucket("month", startOfMonth(d));
  if (rangeId === "year") return fmtBucket("year", startOfYear(d));
  return fmtBucket("month", startOfMonth(d));
}

function groupEntries(list, rangeId) {
  const map = new Map();
  for (const en of list) {
    const raw = en.date || en.createdAt || en._dateForGrouping;
    const b = bucketOf(rangeId, raw);
    const obj = map.get(b) || { ingreso: 0, gasto: 0 };

    if (en.type === "income") obj.ingreso += Number(en.amount || 0);
    else obj.gasto += Number(en.amount || 0);

    map.set(b, obj);
  }

  return Array.from(map.entries())
    .map(([bucket, v]) => ({
      bucket,
      ingreso: v.ingreso,
      gasto: v.gasto,
      neto: v.ingreso - v.gasto,
    }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

/** ✅ Totales */
function totals(list) {
  let ingreso = 0;
  let gasto = 0;
  for (const en of list) {
    const amt = Number(en.amount || 0);
    if (en.type === "income") ingreso += amt;
    else gasto += amt;
  }
  return { ingreso, gasto, neto: ingreso - gasto };
}

/* ------------------ helpers bootstrap ------------------ */
function normKey(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
function toEntryType(tipo) {
  const t = normKey(tipo);
  if (t.includes("ing")) return "income";
  if (t.includes("egr")) return "expense";
  return "expense";
}
function toAmount(v) {
  if (typeof v === "string") {
    const cleaned = v.replace(/,/g, "").trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function toDateFromMov(m) {
  const v = m?.fecha ?? m?.FECHA ?? m?.date ?? m?.Date ?? m?.createdAt;
  if (!v) return new Date();
  if (v?.toDate) return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? new Date() : d;
}
function pickStr(m, ...keys) {
  for (const k of keys) {
    const v = m?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/* ===================== Movimientos -> “entry-like” (solo para display) ===================== */
function normalizeMovToEntry(docSnap) {
  const m = docSnap?.data ? (docSnap.data() || {}) : (docSnap || {});
  const id = docSnap?.id || m._mid || m.id || "";

  // fecha
  const v = m.fecha ?? m.Fecha ?? m.FECHA ?? m.date ?? m.Date ?? m.createdAt;
  let dt;
  if (v?.toDate) dt = v.toDate();
  else if (v instanceof Date) dt = v;
  else if (typeof v?.seconds === "number") dt = new Date(v.seconds * 1000);
  else dt = v ? new Date(v) : new Date();
  if (isNaN(dt.getTime())) dt = new Date();

  // tipo
  const rawTipo = String(m.tipo ?? m.TIPO ?? m.Tipo ?? m.type ?? "").toLowerCase();
  const type = rawTipo.includes("ing") || rawTipo.includes("inc") ? "income" : "expense";

  // monto
  const rawMonto =
    m.monto ?? m.Monto ?? m.MONTO ?? m.IMPORTE ?? m.importe ?? m.PAGADO ?? m.PRECIO ?? m.amount ?? 0;
  let amount = 0;
  if (typeof rawMonto === "string") {
    const cleaned = rawMonto.replace(/,/g, "").trim();
    const n = Number(cleaned);
    amount = Number.isFinite(n) ? n : 0;
  } else {
    const n = Number(rawMonto);
    amount = Number.isFinite(n) ? n : 0;
  }

  // campos opcionales
  const paymentMethod = String(
    m.formaPago ?? m.forma_de_pago ?? m["Forma de pago"] ?? m.FORMA_DE_PAGO ?? ""
  ).trim();
  const beneficiary = String(
    m.beneficiario ??
      m["Referencia/Beneficiario"] ??
      m.BENEFICIARIO_O_PROVEEDOR_DE_LA_COMPRA ??
      ""
  ).trim();
  const reference = String(m.referencia ?? m.REFERENCIA ?? m.REFER ?? "").trim();

  return {
    id,
    type,
    amount,
    date: Timestamp.fromDate(dt),
    paymentMethod,
    beneficiary,
    reference,
    source: "movimientos",
    _dateForGrouping: Timestamp.fromDate(dt),
  };
}

/** ✅ Fecha segura para ordenar */
function entryMillis(e) {
  const raw = e?.date ?? e?.createdAt ?? e?._dateForGrouping;
  const d = raw?.toDate ? raw.toDate() : raw instanceof Date ? raw : raw ? new Date(raw) : null;
  const ms = d && !isNaN(d.getTime()) ? d.getTime() : 0;
  return ms;
}
function sortByDateDesc(a, b) {
  return entryMillis(b) - entryMillis(a);
}

/** ✅ Lista scrolleable de operaciones (SIEMPRE ordenada) */
function EntriesList({ list }) {
  const ordered = useMemo(() => {
    const copy = Array.isArray(list) ? [...list] : [];
    copy.sort(sortByDateDesc);
    return copy;
  }, [list]);

  return (
    <div className="mt-3 border rounded-xl overflow-hidden">
      <div className="max-h-[320px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white border-b">
            <tr className="text-slate-600">
              <th className="text-left py-2 px-2">Fecha</th>
              <th className="text-left py-2 px-2">Tipo</th>
              <th className="text-right py-2 px-2">Monto</th>
              <th className="text-left py-2 px-2">Forma pago</th>
              <th className="text-left py-2 px-2">Beneficiario</th>
              <th className="text-left py-2 px-2">Referencia</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((e) => {
              const d = e.date?.toDate ? e.date.toDate() : e.date ? new Date(e.date) : null;
              const dateStr = d && !isNaN(d.getTime()) ? d.toLocaleDateString("es-MX") : "—";
              const isInc = e.type === "income";
              return (
                <tr key={e.id} className="border-b last:border-0">
                  <td className="py-2 px-2">{dateStr}</td>
                  <td className="py-2 px-2">{isInc ? "Ingreso" : "Gasto"}</td>
                  <td className={"py-2 px-2 text-right " + (isInc ? "text-green-600" : "text-red-600")}>
                    {Number(e.amount || 0).toLocaleString("es-MX")}
                  </td>
                  <td className="py-2 px-2">{e.paymentMethod || "—"}</td>
                  <td className="py-2 px-2">{e.beneficiary || "—"}</td>
                  <td className="py-2 px-2">{e.reference || "—"}</td>
                </tr>
              );
            })}

            {ordered.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-500">
                  Sin operaciones.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Events() {
  const { orgId } = useParams();

  // ✅ auth estable
  const [uid, setUid] = useState("");
  const [authReady, setAuthReady] = useState(false);

  // ✅ bottleId detectado (por mapping fijo)
  const [bottleId, setBottleId] = useState("");

  // ✅ ROLE (viewer/editor/administrador)
  const [role, setRole] = useState("viewer");
  const [roleReady, setRoleReady] = useState(false);

  const canEdit = role === "admin" || role === "editor";
  const isAdmin = role === "admin";

  // debug
  const [bootstrapInfo, setBootstrapInfo] = useState({
    tried: [],
    usedBottleId: "",
    migCount: 0,
    catCount: 0,
    done: false,
    note: "",
  });

  // UI states
  const [name, setName] = useState("");
  const [categories, setCategories] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [catType, setCatType] = useState("ingreso"); // ingreso | egreso

  const [subName, setSubName] = useState("");
  const [subCategories, setSubCategories] = useState([]);
  const [selectedSubCategoryId, setSelectedSubCategoryId] = useState("");

  const [conceptName, setConceptName] = useState("");
  const [concepts, setConcepts] = useState([]);
  const [selectedConceptId, setSelectedConceptId] = useState("");

  const [bankAccounts, setBankAccounts] = useState([]);
  const [bankName, setBankName] = useState("");
  const [selectedBankAccountId, setSelectedBankAccountId] = useState("");

  // ✅ NUEVO: cache global de entries (para no “perder” resultados por queries compuestas)
  const [allEntries, setAllEntries] = useState([]);
  const [entriesLoading, setEntriesLoading] = useState(false);

  // ✅ modo automático según lo que exista en la botella
  // dataMode: de dónde se leen operaciones (entries o movimientos)
  // catalogMode: si hay catálogos (full) o solo "Entradas recientes" (recent-only)
  const [dataMode, setDataMode] = useState("entries"); // "entries" | "movimientos"
  const [catalogMode, setCatalogMode] = useState("full"); // "full" | "recent-only"

  // vistas (mantengo tus states para no tocar la UI)
  const [entriesForCategory, setEntriesForCategory] = useState([]);
  const [entriesForSubCategory, setEntriesForSubCategory] = useState([]);
  const [entriesForConcept, setEntriesForConcept] = useState([]);
  const [entriesForBank, setEntriesForBank] = useState([]);

  const [groupBankBy, setGroupBankBy] = useState("month");
  const [groupCatBy, setGroupCatBy] = useState("month");
  const [groupSubBy, setGroupSubBy] = useState("month");
  const [groupConceptBy, setGroupConceptBy] = useState("month");

  const [saving, setSaving] = useState(false);
  const [busyCatId, setBusyCatId] = useState("");
  const [busySubId, setBusySubId] = useState("");
  const [busyConceptId, setBusyConceptId] = useState("");
  const [busyBankId, setBusyBankId] = useState("");
  const { showToast } = useToast();
  const confirm = useConfirm();
  const showAnalytics = false;

  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, (u) => {
      setUid(u?.uid || "");
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // ✅ Fijar bottleId por mapping SI existe, si no usar orgId como bottleId (botella personal)
  useEffect(() => {
    if (!authReady || !uid || !orgId) return;

    const mapped = BOTTLE_ID_BY_ORG[orgId] || orgId;

    setBottleId(mapped);
    setBootstrapInfo((s) => ({
    ...s,
      tried: [mapped],
      usedBottleId: mapped,
      migCount: 0,
      catCount: 0,
      done: false,
      note: BOTTLE_ID_BY_ORG[orgId]
      ? "BottleId por mapping orgId (fijo)"
      : "BottleId directo (botella personal)",
    }));
  }, [authReady, uid, orgId]);

  // ✅ Reset total al cambiar de bottleId (evita mezcla visual entre organizaciones)
  useEffect(() => {
    setName("");
    setCategories([]);
    setSelectedCategoryId("");
    setSubName("");
    setSubCategories([]);
    setSelectedSubCategoryId("");
    setConceptName("");
    setConcepts([]);
    setSelectedConceptId("");
    setBankAccounts([]);
    setBankName("");
    setSelectedBankAccountId("");

    setAllEntries([]);
    setEntriesForCategory([]);
    setEntriesForSubCategory([]);
    setEntriesForConcept([]);
    setEntriesForBank([]);

    setDataMode("entries");
    setCatalogMode("full");

    setRole("viewer");
    setRoleReady(false);
  }, [bottleId]);

  const orgRefs = useMemo(() => {
    if (!uid || !orgId || !bottleId) return null;
    const base = ["botellas", bottleId];

    return {
      memberDoc: doc(db, ...base, "members", uid),

      categoriesCol: collection(db, ...base, "categories"),
      subcategoriesCol: (categoryId) => collection(db, ...base, "categories", categoryId, "subcategories"),
      conceptsCol: (categoryId, subCategoryId) =>
        collection(db, ...base, "categories", categoryId, "subcategories", subCategoryId, "concepts"),

      categoryDoc: (categoryId) => doc(db, ...base, "categories", categoryId),
      subcategoryDoc: (categoryId, subCategoryId) =>
        doc(db, ...base, "categories", categoryId, "subcategories", subCategoryId),
      conceptDoc: (categoryId, subCategoryId, conceptId) =>
        doc(db, ...base, "categories", categoryId, "subcategories", subCategoryId, "concepts", conceptId),

      entriesCol: collection(db, ...base, "entries"),
      bankAccountsCol: collection(db, ...base, "bankAccounts"),
      bankAccountDoc: (bankId) => doc(db, ...base, "bankAccounts", bankId),

      migratedMovsCol: collection(db, ...base, "movimientos"),
      metaMigrationDoc: doc(db, ...base, "meta", "migration"),
    };
  }, [uid, orgId, bottleId]);

  // ✅ cargar rol
  useEffect(() => {
    if (!orgRefs?.memberDoc) return;
    (async () => {
      try {
        setRoleReady(false);
        const snap = await getDoc(orgRefs.memberDoc);
        const r = snap.exists() ? String(snap.data()?.role || "viewer") : "viewer";
        setRole(r === "admin" || r === "editor" || r === "viewer" ? r : "viewer");
      } catch {
        setRole("viewer");
      } finally {
        setRoleReady(true);
      }
    })();
  }, [orgRefs?.memberDoc?.path]);

  // ✅ botón reset migración (borra meta/migration)
  async function resetMigration() {
    if (!orgRefs) return;
    if (!isAdmin) {
      showToast("No tienes permisos para resetear migración (solo administrador).", "error");
      return;
    }

    const ok = await confirm(
      "Esto borrará el flag meta/migration (done=true) para volver a correr el bootstrap. ¿Continuar?"
    );
    if (!ok) return;

    try {
      await deleteDoc(orgRefs.metaMigrationDoc);
      setBootstrapInfo((s) => ({
        ...s,
        done: false,
        migCount: 0,
        catCount: 0,
        note: "Meta migration borrado. Recargando…",
      }));
      window.location.reload();
    } catch (e) {
      showToast(e?.message || String(e), "error");
    }
  }

  async function safeGetMigratedMovs(migratedMovsCol) {
    // intentamos varios orderBy reales según tus campos
    const tries = [
      ["Fecha", "desc"],
      ["fecha", "desc"],
      ["createdAt", "desc"],
    ];

    for (const [field, dir] of tries) {
      try {
        const snap = await getDocs(query(migratedMovsCol, orderBy(field, dir), limit(6000)));
        if (!snap.empty) return snap.docs.map((d) => ({ _mid: d.id, ...d.data() }));
      } catch {
        // seguimos intentando
      }
    }

    // fallback SIEMPRE: sin orderBy (esto debe traer docs sí o sí)
    const snap = await getDocs(query(migratedMovsCol, limit(6000)));
    return snap.docs.map((d) => ({ _mid: d.id, ...d.data() }));
  }

  async function detectDataMode() {
    if (!orgRefs) return "entries";

    const eSnap = await getDocs(query(orgRefs.entriesCol, limit(1)));
    if (!eSnap.empty) return "entries";

    const mSnap = await getDocs(query(orgRefs.migratedMovsCol, limit(1)));
    if (!mSnap.empty) return "movimientos";

    return "entries";
  }

  async function loadAllEntries() {
    if (!orgRefs) return;
    setEntriesLoading(true);
    try {
      const mode = await detectDataMode();
      setDataMode(mode);

      if (mode === "movimientos") {
        let snap = null;

        // intentamos varios orderBy que sí existen en tu colección
        const tries = [
          ["Fecha", "desc"],
          ["fecha", "desc"],
          ["createdAt", "desc"],
        ];

        for (const [field, dir] of tries) {
          try {
            snap = await getDocs(query(orgRefs.migratedMovsCol, orderBy(field, dir), limit(10000)));
            if (!snap.empty) break;
          } catch {
            // siguiente intento
          }
        }

        // fallback sin orderBy
        if (!snap) {
          snap = await getDocs(query(orgRefs.migratedMovsCol, limit(10000)));
        }

        const docs = snap.docs.map((d) => normalizeMovToEntry(d));
        docs.sort(sortByDateDesc);

        setAllEntries(docs);
        setBootstrapInfo((s) => ({ ...s, migCount: docs.length }));
        return;
      }

      let docs = [];
      try {
        const snap = await getDocs(query(orgRefs.entriesCol, orderBy("date", "desc"), limit(10000)));
        docs = snap.docs.map((d) => ({ id: d.id, ...d.data(), source: "entries" }));
      } catch {
        const snap = await getDocs(query(orgRefs.entriesCol, limit(10000)));
        docs = snap.docs.map((d) => ({ id: d.id, ...d.data(), source: "entries" }));
      }

      docs.sort(sortByDateDesc);
      setAllEntries(docs);
    } catch (e) {
      console.error("Events loadAllEntries error:", e);
      setAllEntries([]);
    } finally {
      setEntriesLoading(false);
    }
  }

  async function loadCategories() {
    if (!orgRefs) return;
    try {
      const snap = await getDocs(query(orgRefs.categoriesCol, orderBy("name")));
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setCategories(list);
      setBootstrapInfo((s) => ({ ...s, catCount: list.length }));
      if (!selectedCategoryId && list[0]?.id) setSelectedCategoryId(list[0].id);
    } catch (e) {
      console.error("Events loadCategories error:", e);
      setCategories([]);
    }
  }

  async function loadSubCategories(categoryId) {
    if (!orgRefs || !categoryId) {
      setSubCategories([]);
      return;
    }
    try {
      let snap;
      try {
        snap = await getDocs(query(orgRefs.subcategoriesCol(categoryId), orderBy("name")));
      } catch {
        snap = await getDocs(orgRefs.subcategoriesCol(categoryId));
      }
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setSubCategories(list);
      if (!selectedSubCategoryId && list[0]?.id) setSelectedSubCategoryId(list[0].id);
    } catch (e) {
      console.error("Events loadSubCategories error:", e);
      setSubCategories([]);
    }
  }

  async function loadConcepts(categoryId, subCategoryId) {
    if (!orgRefs || !categoryId || !subCategoryId) {
      setConcepts([]);
      return;
    }
    try {
      let snap;
      try {
        snap = await getDocs(query(orgRefs.conceptsCol(categoryId, subCategoryId), orderBy("name")));
      } catch {
        snap = await getDocs(orgRefs.conceptsCol(categoryId, subCategoryId));
      }
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setConcepts(list);
      if (!selectedConceptId && list[0]?.id) setSelectedConceptId(list[0].id);
    } catch (e) {
      console.error("Events loadConcepts error:", e);
      setConcepts([]);
    }
  }

  async function loadBankAccounts() {
    if (!orgRefs) return;
    try {
      const snap = await getDocs(query(orgRefs.bankAccountsCol, orderBy("name")));
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setBankAccounts(list);
      if (!selectedBankAccountId && list[0]?.id) setSelectedBankAccountId(list[0].id);
    } catch (e) {
      console.error("Events loadBankAccounts error:", e);
      setBankAccounts([]);
    }
  }

  function movsHaveCatalogFields(m) {
    const cat = pickStr(m, "categoria", "CATEGORIA");
    const sub = pickStr(m, "subcategoria", "SUBCATEGORIA");
    const con = pickStr(m, "concepto", "CONCEPTO");
    const bank =
      pickStr(m, "cuentaBancaria", "CUENTA_BANCARIA", "cuenta", "CUENTA") || pickStr(m, "sheetCuenta");
    return Boolean(cat || sub || con || bank);
  }

  async function syncFromMigratedIfNeeded() {
    if (!orgRefs) return;

    const meta = await getDoc(orgRefs.metaMigrationDoc);

    // ✅ SI meta dice done=true PERO no hay categorías, re-sincroniza (tu bug)
    if (meta.exists() && meta.data()?.done) {
      const catSnapCheck = await getDocs(query(orgRefs.categoriesCol, limit(1)));
      const hasAnyCategory = !catSnapCheck.empty;

      if (hasAnyCategory) {
        setBootstrapInfo((s) => ({
          ...s,
          done: true,
          note: "Meta migration ya estaba done=true (y sí hay categorías)",
        }));
        setCatalogMode("full");
        return "full";
      }

      setBootstrapInfo((s) => ({
        ...s,
        done: false,
        note: "Meta estaba done=true pero NO hay categorías → re-sincronizando…",
      }));
      // NO return → sigue a sync
    }

    const movs = await safeGetMigratedMovs(orgRefs.migratedMovsCol);
    setBootstrapInfo((s) => ({ ...s, migCount: movs.length }));

    // ✅ Si los movimientos NO traen campos de catálogo, NO bootstrap.
    // ✅ FIX: solo manda a recent-only si NO puede editar.
    const sample = movs.slice(0, 80);
    const canBootstrapCatalogs = sample.some(movsHaveCatalogFields);

    if (!canBootstrapCatalogs) {
      await setDoc(orgRefs.metaMigrationDoc, {
        done: true,
        mode: "skip",
        at: serverTimestamp(),
        moved: movs.length,
        note: "Skip bootstrap: movimientos sin categoria/subcategoria/concepto/cuenta.",
      });

      if (!canEdit) {
        setCatalogMode("recent-only");
        setBootstrapInfo((s) => ({
          ...s,
          done: true,
        note: "Modo solo-movimientos (lector): se muestran entradas recientes.",
        }));
        return "recent-only";
      }

      // admin/editor: NO bloquear catálogos
      setCatalogMode("full");
      setBootstrapInfo((s) => ({
        ...s,
        done: true,
        note: "Movimientos sin campos de catálogo, pero puedes crear catálogos (administrador/editor).",
      }));
      return "full";
    }

    if (movs.length === 0) {
      await setDoc(orgRefs.metaMigrationDoc, {
        done: true,
        at: serverTimestamp(),
        moved: 0,
        note: "No había movimientos en botellas/{bottleId}/movimientos",
      });
      setBootstrapInfo((s) => ({ ...s, done: true, note: "No había movimientos en esa botella" }));
      setCatalogMode("full");
      return "full";
    }

    // ✅ bootstrap normal (tipo Iglesia)
    const catSnap = await getDocs(query(orgRefs.categoriesCol, orderBy("name")));
    const cats = catSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const catByName = new Map(cats.map((c) => [normKey(c.name), c.id]));

    const bankSnap = await getDocs(query(orgRefs.bankAccountsCol, orderBy("name")));
    const banks = bankSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const bankByName = new Map(banks.map((b) => [normKey(b.name), b.id]));

    const subByCatName = new Map();
    const conBySubName = new Map();
    const loadedCatIds = new Set();

    async function ensureCachesForCat(catId) {
      if (loadedCatIds.has(catId)) return;
      loadedCatIds.add(catId);

      const subSnap = await getDocs(query(orgRefs.subcategoriesCol(catId), orderBy("name")));
      for (const sd of subSnap.docs) {
        subByCatName.set(`${catId}::${normKey(sd.data().name)}`, sd.id);

        const conSnap = await getDocs(query(orgRefs.conceptsCol(catId, sd.id), orderBy("name")));
        for (const cd of conSnap.docs) {
          conBySubName.set(`${catId}::${sd.id}::${normKey(cd.data().name)}`, cd.id);
        }
      }
    }

    let batch = writeBatch(db);
    let ops = 0;

    async function commitIfNeeded(force = false) {
      if (ops >= 450 || (force && ops > 0)) {
        await batch.commit();
        batch = writeBatch(db);
        ops = 0;
      }
    }

    for (const m of movs) {
      const catNameRaw = pickStr(m, "categoria", "CATEGORIA") || "Sin categoría";
      const subNameRaw = pickStr(m, "subcategoria", "SUBCATEGORIA") || "General";
      const conceptNameRaw = pickStr(m, "concepto", "CONCEPTO") || "General";

      const bankNameRaw =
        pickStr(m, "cuentaBancaria", "CUENTA_BANCARIA", "cuenta", "CUENTA") ||
        pickStr(m, "sheetCuenta") ||
        "Sin cuenta";

      let catId = catByName.get(normKey(catNameRaw));
      if (!catId) {
        const ref = doc(orgRefs.categoriesCol);
        batch.set(ref, { name: catNameRaw, createdAt: serverTimestamp(), source: "migration" });
        ops++;
        catId = ref.id;
        catByName.set(normKey(catNameRaw), catId);
      }

      await ensureCachesForCat(catId);

      const subKey = `${catId}::${normKey(subNameRaw)}`;
      let subId = subByCatName.get(subKey);
      if (!subId) {
        const ref = doc(orgRefs.subcategoriesCol(catId));
        batch.set(ref, { name: subNameRaw, createdAt: serverTimestamp(), source: "migration" });
        ops++;
        subId = ref.id;
        subByCatName.set(subKey, subId);
      }

      const conKey = `${catId}::${subId}::${normKey(conceptNameRaw)}`;
      let conId = conBySubName.get(conKey);
      if (!conId) {
        const ref = doc(orgRefs.conceptsCol(catId, subId));
        batch.set(ref, { name: conceptNameRaw, createdAt: serverTimestamp(), source: "migration" });
        ops++;
        conId = ref.id;
        conBySubName.set(conKey, conId);
      }

      let bankId = bankByName.get(normKey(bankNameRaw));
      if (!bankId) {
        const ref = doc(orgRefs.bankAccountsCol);
        batch.set(ref, { name: bankNameRaw, createdAt: serverTimestamp(), source: "migration" });
        ops++;
        bankId = ref.id;
        bankByName.set(normKey(bankNameRaw), bankId);
      }

      const dt = toDateFromMov(m);
      const amount = toAmount(m.monto ?? m.Monto ?? m.IMPORTE ?? m.importe ?? m.PAGADO ?? m.PRECIO ?? 0);
      const type = toEntryType(m.tipo ?? m.TIPO ?? "");

      const paymentMethod = pickStr(m, "formaPago", "FORMA_DE_PAGO", "forma_de_pago") || "";
      const beneficiary = pickStr(m, "beneficiario", "BENEFICIARIO_O_PROVEEDOR_DE_LA_COMPRA") || "";
      const reference = pickStr(m, "referencia", "REFER", "REFERENCIA") || "";

      const entryRef = doc(orgRefs.entriesCol);
      batch.set(entryRef, {
        type,
        amount,
        date: Timestamp.fromDate(dt),

        categoryId: catId,
        subCategoryId: subId,
        conceptId: conId,
        bankAccountId: bankId,

        paymentMethod,
        beneficiary,
        reference,

        source: "migration",
        createdAt: serverTimestamp(),
      });
      ops++;

      await commitIfNeeded(false);
    }

    await commitIfNeeded(true);

    await setDoc(orgRefs.metaMigrationDoc, {
      done: true,
      at: serverTimestamp(),
      moved: movs.length,
      note: "Bootstrap OK (movimientos -> entries + catálogos).",
    });

    setBootstrapInfo((s) => ({ ...s, done: true, note: `Bootstrap OK. moved=${movs.length}` }));
    setCatalogMode("full");
    return "full";
  }

  useEffect(() => {
    if (!orgRefs) return;

    syncFromMigratedIfNeeded()
      .then(async (mode) => {
        // ✅ FIX: solo recent-only para viewers
        if (!canEdit && mode === "recent-only") {
          setCategories([{ id: "__recent__", name: "Entradas recientes" }]);
          setSelectedCategoryId("__recent__");
          setSubCategories([]);
          setSelectedSubCategoryId("");
          setConcepts([]);
          setSelectedConceptId("");
          setBankAccounts([]);
          setSelectedBankAccountId("");
        } else {
          await loadCategories();
          await loadBankAccounts();
        }
        await loadAllEntries(); // ✅ importante: cache global
      })
      .catch((e) => showToast(e?.message || String(e), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgRefs, canEdit]);

  const categoriesForType = useMemo(() => {
    return categories.filter((c) => (c.tipo || "").toLowerCase() === catType);
  }, [categories, catType]);

  useEffect(() => {
    if (catalogMode === "recent-only") return;
    if (!categoriesForType.length) {
      setSelectedCategoryId("");
      return;
    }
    if (!categoriesForType.some((c) => c.id === selectedCategoryId)) {
      setSelectedCategoryId(categoriesForType[0]?.id || "");
    }
  }, [catType, categoriesForType, catalogMode, selectedCategoryId]);

  // ✅ derivar lists desde allEntries (sin query compuesta)
  useEffect(() => {
    if (!canEdit && (catalogMode === "recent-only" || selectedCategoryId === "__recent__")) {
      const copy = [...allEntries];
      copy.sort(sortByDateDesc);
      setEntriesForCategory(copy);
      return;
    }

    if (!selectedCategoryId || selectedCategoryId === "__recent__") {
      setEntriesForCategory([]);
      return;
    }

    const filtered = allEntries.filter((e) => e.categoryId === selectedCategoryId);
    filtered.sort(sortByDateDesc);
    setEntriesForCategory(filtered);
  }, [allEntries, selectedCategoryId, catalogMode, canEdit]);

  useEffect(() => {
    if (!canEdit && catalogMode === "recent-only") {
      setEntriesForSubCategory([]);
      return;
    }
    if (!selectedCategoryId || selectedCategoryId === "__recent__" || !selectedSubCategoryId) {
      setEntriesForSubCategory([]);
      return;
    }
    const filtered = allEntries.filter(
      (e) => e.categoryId === selectedCategoryId && e.subCategoryId === selectedSubCategoryId
    );
    filtered.sort(sortByDateDesc);
    setEntriesForSubCategory(filtered);
  }, [allEntries, selectedCategoryId, selectedSubCategoryId, catalogMode, canEdit]);

  useEffect(() => {
    if (!canEdit && catalogMode === "recent-only") {
      setEntriesForConcept([]);
      return;
    }
    if (!selectedCategoryId || selectedCategoryId === "__recent__" || !selectedSubCategoryId || !selectedConceptId) {
      setEntriesForConcept([]);
      return;
    }
    const filtered = allEntries.filter(
      (e) =>
        e.categoryId === selectedCategoryId &&
        e.subCategoryId === selectedSubCategoryId &&
        e.conceptId === selectedConceptId
    );
    filtered.sort(sortByDateDesc);
    setEntriesForConcept(filtered);
  }, [allEntries, selectedCategoryId, selectedSubCategoryId, selectedConceptId, catalogMode, canEdit]);

  useEffect(() => {
    if (!canEdit && catalogMode === "recent-only") {
      setEntriesForBank([]);
      return;
    }
    if (!selectedBankAccountId) {
      setEntriesForBank([]);
      return;
    }
    const filtered = allEntries.filter((e) => e.bankAccountId === selectedBankAccountId);
    filtered.sort(sortByDateDesc);
    setEntriesForBank(filtered);
  }, [allEntries, selectedBankAccountId, catalogMode, canEdit]);

  // Cascadas de selectors
  useEffect(() => {
    if (!canEdit && catalogMode === "recent-only") return;

    if (!orgRefs || !selectedCategoryId || selectedCategoryId === "__recent__") {
      setSubCategories([]);
      setSelectedSubCategoryId("");
      setConcepts([]);
      setSelectedConceptId("");
      setEntriesForSubCategory([]);
      setEntriesForConcept([]);
      return;
    }

    loadSubCategories(selectedCategoryId);

    setSelectedSubCategoryId("");
    setConcepts([]);
    setSelectedConceptId("");
    setEntriesForSubCategory([]);
    setEntriesForConcept([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategoryId, catalogMode, canEdit]);

  useEffect(() => {
    if (!canEdit && catalogMode === "recent-only") return;

    if (!orgRefs || !selectedCategoryId || selectedCategoryId === "__recent__" || !selectedSubCategoryId) {
      setConcepts([]);
      setSelectedConceptId("");
      setEntriesForConcept([]);
      return;
    }

    loadConcepts(selectedCategoryId, selectedSubCategoryId);

    setSelectedConceptId("");
    setEntriesForConcept([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSubCategoryId, catalogMode, canEdit]);

  // CRUD
  async function onCreateCategory(e) {
    e.preventDefault();

    if (!canEdit) {
      showToast("No tienes permisos para crear categorías (solo editor/administrador).", "error");
      return;
    }

    // ✅ FIX: no bloquear por recent-only si es admin/editor
    if (!orgRefs) return showToast("No hay organización / bottleId / auth lista aún.", "error");
    if (!name.trim()) return showToast("El nombre de la categoría es obligatorio.", "error");

    try {
      setSaving(true);
      const ref = await addDoc(orgRefs.categoriesCol, {
        name: name.trim(),
        tipo: catType,
        createdAt: serverTimestamp(),
      });
      setName("");
      await loadCategories();
      setSelectedCategoryId(ref.id);
    } catch (err) {
      showToast(err?.message || String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteCategory(cat) {
    if (!canEdit) {
      showToast("No tienes permisos para eliminar categorías (solo editor/administrador).", "error");
      return;
    }
    if (!orgRefs || !cat?.id) return;
    const ok = await confirm(`¿Eliminar la categoría "${cat.name}"? (No borra entradas automáticamente)`);
    if (!ok) return;

    try {
      setBusyCatId(cat.id);
      await deleteDoc(orgRefs.categoryDoc(cat.id));
      await loadCategories();
      if (selectedCategoryId === cat.id) setSelectedCategoryId("");
    } catch (err) {
      showToast(err?.message || String(err), "error");
    } finally {
      setBusyCatId("");
    }
  }

  async function onCreateSubCategory(e) {
    e.preventDefault();

    if (!canEdit) {
      showToast("No tienes permisos para crear sub-categorías (solo editor/administrador).", "error");
      return;
    }

    // ✅ FIX: no bloquear por recent-only si es admin/editor
    if (!orgRefs) return showToast("No hay organización / bottleId / auth lista aún.", "error");
    if (!selectedCategoryId || selectedCategoryId === "__recent__") return showToast("Selecciona primero una categoría.", "error");
    if (!subName.trim()) return showToast("El nombre de la sub-categoría es obligatorio.", "error");

    try {
      setSaving(true);
      await addDoc(orgRefs.subcategoriesCol(selectedCategoryId), { name: subName.trim(), createdAt: serverTimestamp() });
      setSubName("");
      await loadSubCategories(selectedCategoryId);
    } catch (err) {
      showToast(err?.message || String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteSubCategory(sc) {
    if (!canEdit) {
      showToast("No tienes permisos para eliminar sub-categorías (solo editor/administrador).", "error");
      return;
    }
    if (!orgRefs || !selectedCategoryId || selectedCategoryId === "__recent__" || !sc?.id) return;
    const ok = await confirm(`¿Eliminar la sub-categoría "${sc.name}"? (No borra entradas automáticamente)`);
    if (!ok) return;

    try {
      setBusySubId(sc.id);
      await deleteDoc(orgRefs.subcategoryDoc(selectedCategoryId, sc.id));
      await loadSubCategories(selectedCategoryId);
      if (selectedSubCategoryId === sc.id) setSelectedSubCategoryId("");
    } catch (err) {
      showToast(err?.message || String(err), "error");
    } finally {
      setBusySubId("");
    }
  }

  async function onCreateConcept(e) {
    e.preventDefault();

    if (!canEdit) {
      showToast("No tienes permisos para crear conceptos (solo editor/administrador).", "error");
      return;
    }

    // ✅ FIX: no bloquear por recent-only si es admin/editor
    if (!orgRefs) return showToast("No hay organización / bottleId / auth lista aún.", "error");
    if (!selectedCategoryId || selectedCategoryId === "__recent__") return showToast("Selecciona primero una categoría.", "error");
    if (!selectedSubCategoryId) return showToast("Selecciona primero una sub-categoría.", "error");
    if (!conceptName.trim()) return showToast("El nombre del concepto es obligatorio.", "error");

    try {
      setSaving(true);
      await addDoc(orgRefs.conceptsCol(selectedCategoryId, selectedSubCategoryId), {
        name: conceptName.trim(),
        createdAt: serverTimestamp(),
      });
      setConceptName("");
      await loadConcepts(selectedCategoryId, selectedSubCategoryId);
    } catch (err) {
      showToast(err?.message || String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteConcept(cn) {
    if (!canEdit) {
      showToast("No tienes permisos para eliminar conceptos (solo editor/administrador).", "error");
      return;
    }
    if (!orgRefs || !selectedCategoryId || selectedCategoryId === "__recent__" || !selectedSubCategoryId || !cn?.id) return;
    const ok = await confirm(`¿Eliminar el concepto "${cn.name}"? (No borra entradas automáticamente)`);
    if (!ok) return;

    try {
      setBusyConceptId(cn.id);
      await deleteDoc(orgRefs.conceptDoc(selectedCategoryId, selectedSubCategoryId, cn.id));
      await loadConcepts(selectedCategoryId, selectedSubCategoryId);
      if (selectedConceptId === cn.id) setSelectedConceptId("");
    } catch (err) {
      showToast(err?.message || String(err), "error");
    } finally {
      setBusyConceptId("");
    }
  }

  async function onDeleteBankAccount(b) {
    if (!canEdit) {
      showToast("No tienes permisos para eliminar cuentas bancarias (solo editor/administrador).", "error");
      return;
    }
    if (!orgRefs || !b?.id) return;
    const ok = await confirm(`¿Eliminar la cuenta "${b.name}"?`);
    if (!ok) return;

    try {
      setBusyBankId(b.id);
      await deleteDoc(orgRefs.bankAccountDoc(b.id));
      await loadBankAccounts();
      if (selectedBankAccountId === b.id) setSelectedBankAccountId("");
    } catch (err) {
      showToast(err?.message || String(err), "error");
    } finally {
      setBusyBankId("");
    }
  }

  // ✅ agrupados y totales
  const groupedCategory = useMemo(() => groupEntries(entriesForCategory, groupCatBy), [entriesForCategory, groupCatBy]);
  const groupedSub = useMemo(() => groupEntries(entriesForSubCategory, groupSubBy), [entriesForSubCategory, groupSubBy]);
  const groupedConcept = useMemo(
    () => groupEntries(entriesForConcept, groupConceptBy),
    [entriesForConcept, groupConceptBy]
  );
  const groupedBank = useMemo(() => groupEntries(entriesForBank, groupBankBy), [entriesForBank, groupBankBy]);

  const totalsCategory = useMemo(() => totals(entriesForCategory), [entriesForCategory]);
  const totalsSub = useMemo(() => totals(entriesForSubCategory), [entriesForSubCategory]);
  const totalsConcept = useMemo(() => totals(entriesForConcept), [entriesForConcept]);
  const totalsBank = useMemo(() => totals(entriesForBank), [entriesForBank]);

  const catNameSelected = categories.find((c) => c.id === selectedCategoryId)?.name || "—";
  const subNameSelected = subCategories.find((s) => s.id === selectedSubCategoryId)?.name || "—";
  const conceptNameSelected = concepts.find((c) => c.id === selectedConceptId)?.name || "—";
  const bankNameSelected = bankAccounts.find((b) => b.id === selectedBankAccountId)?.name || "—";

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl md:text-4xl font-bold" style={{ fontFamily: '"Cinzel", Georgia, serif', color: '#d3b187' }}>
          Categorías
        </h1>
        <BackToHome />
      </div>

      {/* ===================== FILA 1: CATEGORÍAS ===================== */}
      <div className="flex items-center gap-2 mb-2">
        <span className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: '#d3b187' }} />
        <span className="text-xs font-bold tracking-widest uppercase" style={{ color: 'rgba(211,177,135,0.5)' }}>Categorías</span>
      </div>
      <div className={"grid gap-6 " + (showAnalytics ? "md:grid-cols-2" : "md:grid-cols-1")}>
        <div className="rounded-2xl border bg-white p-4" style={{ border: '1px solid rgba(59,36,27,0.10)', boxShadow: '0 2px 16px rgba(59,36,27,0.07)' }}>
          <h2 className="text-lg font-semibold mb-3">Categorías</h2>

          <div className="flex gap-2 mb-3">
            <button
              type="button"
              className={
                "rounded-xl border px-3 py-1 text-sm " +
                (catType === "ingreso" ? "bg-slate-900 text-white" : "hover:bg-amber-50")
              }
              onClick={() => setCatType("ingreso")}
            >
              Ingresos
            </button>
            <button
              type="button"
              className={
                "rounded-xl border px-3 py-1 text-sm " +
                (catType === "egreso" ? "bg-slate-900 text-white" : "hover:bg-amber-50")
              }
              onClick={() => setCatType("egreso")}
            >
              Egresos
            </button>
          </div>

          <form onSubmit={onCreateCategory} className="flex gap-3 mb-4">
            <input
              className="flex-1 rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
              placeholder="Nombre de la nueva categoría (ej. Ingresos, Egresos...)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit}
            />
            <button
              className="rounded-xl px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 disabled:opacity-50" style={{ background: '#4b2d22', color: '#d3b187', border: '1px solid rgba(211,177,135,0.35)', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}
              disabled={saving || !orgId || !canEdit}
              title={!canEdit ? "Solo editor/administrador" : ""}
            >
              {saving ? "Creando…" : "Crear"}
            </button>
          </form>

          <ul className="space-y-2">
            {categoriesForType.map((cat) => (
              <li key={cat.id} className="rounded-xl border p-3 flex items-center justify-between">
                <button
                  className={"font-medium underline " + (selectedCategoryId === cat.id ? "text-black" : "text-slate-700")}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  type="button"
                >
                  {cat.name}
                </button>

                <button
                  onClick={() => onDeleteCategory(cat)}
                  className="rounded-lg border px-3 py-1 text-sm hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                  disabled={!canEdit || busyCatId === cat.id}
                  title={!canEdit ? "Solo editor/administrador" : ""}
                  type="button"
                >
                  {busyCatId === cat.id ? "Eliminando…" : "🗑️ Eliminar"}
                </button>
              </li>
            ))}
            {categoriesForType.length === 0 && <li className="text-sm text-slate-500">Aún no hay categorías.</li>}
          </ul>
        </div>

        {showAnalytics && (
        <div className="rounded-2xl border bg-white p-4" style={{ border: '1px solid rgba(59,36,27,0.10)', boxShadow: '0 2px 16px rgba(59,36,27,0.07)' }}>
          <h2 className="text-lg font-semibold mb-3">Análisis de categorías</h2>

          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Categoría</label>
              <select
                className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                disabled={!categoriesForType.length}
              >
                {categoriesForType.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Agrupar por</label>
              <select
                className="rounded-xl border px-3 py-2"
                value={groupCatBy}
                onChange={(e) => setGroupCatBy(e.target.value)}
              >
                <option value="day">Día</option>
                <option value="week">Semana</option>
                <option value="month">Mes</option>
                <option value="year">Año</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-sm mb-2">
            <div>
              <b>Ingreso total:</b>{" "}
              <span className="text-green-600">{totalsCategory.ingreso.toLocaleString("es-MX")}</span>
            </div>
            <div>
              <b>Gasto total:</b>{" "}
              <span className="text-red-600">{totalsCategory.gasto.toLocaleString("es-MX")}</span>
            </div>
            <div>
              <b>Neto:</b> <span className="font-semibold">{totalsCategory.neto.toLocaleString("es-MX")}</span>
            </div>
          </div>

          <EntriesList list={entriesForCategory} />

          <table className="w-full text-sm mt-4">
            <thead>
              <tr className="text-slate-600 border-b">
                <th className="text-left py-2">Categoría: {catNameSelected}</th>
                <th className="text-right">Ingreso</th>
                <th className="text-right">Gasto</th>
                <th className="text-right">Neto</th>
              </tr>
            </thead>
            <tbody>
              {groupedCategory.map((r) => (
                <tr key={r.bucket} className="border-b last:border-0">
                  <td className="py-2">{r.bucket}</td>
                  <td className="text-right text-green-600">{r.ingreso.toLocaleString("es-MX")}</td>
                  <td className="text-right text-red-600">{r.gasto.toLocaleString("es-MX")}</td>
                  <td className="text-right font-medium">{r.neto.toLocaleString("es-MX")}</td>
                </tr>
              ))}
              {groupedCategory.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-500">
                    Sin entradas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* ===================== FILA 2: SUB-CATEGORÍAS ===================== */}
      <div className="flex items-center gap-2 mt-6 mb-2">
        <span className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: '#d3b187' }} />
        <span className="text-xs font-bold tracking-widest uppercase" style={{ color: 'rgba(211,177,135,0.5)' }}>Sub-categorías</span>
      </div>
      <div className={"grid gap-6 " + (showAnalytics ? "md:grid-cols-2" : "md:grid-cols-1")}>
        <div className="rounded-2xl border bg-white p-4" style={{ border: '1px solid rgba(59,36,27,0.10)', boxShadow: '0 2px 16px rgba(59,36,27,0.07)' }}>
          <h2 className="text-lg font-semibold mb-3">Sub-categorías</h2>

          <form onSubmit={onCreateSubCategory} className="flex gap-3 mb-4">
            <input
              className="flex-1 rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
              placeholder="Nombre de la nueva sub-categoría (ej. Ofrendas, Luz, Agua...)"
              value={subName}
              onChange={(e) => setSubName(e.target.value)}
              disabled={!canEdit}
            />
            <button
              className="rounded-xl px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 disabled:opacity-50" style={{ background: '#4b2d22', color: '#d3b187', border: '1px solid rgba(211,177,135,0.35)', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}
              disabled={saving || !orgId || !canEdit}
              title={!canEdit ? "Solo editor/administrador" : ""}
            >
              {saving ? "Creando…" : "Crear"}
            </button>
          </form>

          <div className="mb-3">
            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Categoría</label>
            <select
              className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              disabled={!categoriesForType.length}
            >
              {categoriesForType.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <ul className="space-y-2">
            {subCategories.map((sc) => (
              <li key={sc.id} className="rounded-xl border p-3 flex items-center justify-between">
                <button
                  className={"font-medium underline " + (selectedSubCategoryId === sc.id ? "text-black" : "text-slate-700")}
                  onClick={() => setSelectedSubCategoryId(sc.id)}
                  type="button"
                >
                  {sc.name}
                </button>

                <button
                  onClick={() => onDeleteSubCategory(sc)}
                  className="rounded-lg border px-3 py-1 text-sm hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                  disabled={!canEdit || busySubId === sc.id}
                  title={!canEdit ? "Solo editor/administrador" : ""}
                  type="button"
                >
                  {busySubId === sc.id ? "Eliminando…" : "🗑️ Eliminar"}
                </button>
              </li>
            ))}
            {subCategories.length === 0 && <li className="text-sm text-slate-500">Aún no hay sub-categorías.</li>}
          </ul>
        </div>

        {showAnalytics && (
        <div className="rounded-2xl border bg-white p-4" style={{ border: '1px solid rgba(59,36,27,0.10)', boxShadow: '0 2px 16px rgba(59,36,27,0.07)' }}>
          <h2 className="text-lg font-semibold mb-3">Análisis de sub-categorías</h2>

          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Sub-categoría</label>
              <select
                className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
                value={selectedSubCategoryId}
                onChange={(e) => setSelectedSubCategoryId(e.target.value)}
                disabled={!subCategories.length}
              >
                {subCategories.map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Agrupar por</label>
              <select
                className="rounded-xl border px-3 py-2"
                value={groupSubBy}
                onChange={(e) => setGroupSubBy(e.target.value)}
              >
                <option value="day">Día</option>
                <option value="week">Semana</option>
                <option value="month">Mes</option>
                <option value="year">Año</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-sm mb-2">
            <div>
              <b>Ingreso total:</b> <span className="text-green-600">{totalsSub.ingreso.toLocaleString("es-MX")}</span>
            </div>
            <div>
              <b>Gasto total:</b> <span className="text-red-600">{totalsSub.gasto.toLocaleString("es-MX")}</span>
            </div>
            <div>
              <b>Neto:</b> <span className="font-semibold">{totalsSub.neto.toLocaleString("es-MX")}</span>
            </div>
          </div>

          <EntriesList list={entriesForSubCategory} />

          <table className="w-full text-sm mt-4">
            <thead>
              <tr className="text-slate-600 border-b">
                <th className="text-left py-2">Sub-categoría: {subNameSelected}</th>
                <th className="text-right">Ingreso</th>
                <th className="text-right">Gasto</th>
                <th className="text-right">Neto</th>
              </tr>
            </thead>
            <tbody>
              {groupedSub.map((r) => (
                <tr key={r.bucket} className="border-b last:border-0">
                  <td className="py-2">{r.bucket}</td>
                  <td className="text-right text-green-600">{r.ingreso.toLocaleString("es-MX")}</td>
                  <td className="text-right text-red-600">{r.gasto.toLocaleString("es-MX")}</td>
                  <td className="text-right font-medium">{r.neto.toLocaleString("es-MX")}</td>
                </tr>
              ))}
              {groupedSub.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-500">
                    Sin entradas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* ===================== FILA 3: CONCEPTOS ===================== */}
      <div className="flex items-center gap-2 mt-6 mb-2">
        <span className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: '#d3b187' }} />
        <span className="text-xs font-bold tracking-widest uppercase" style={{ color: 'rgba(211,177,135,0.5)' }}>Conceptos</span>
      </div>
      <div className={"grid gap-6 " + (showAnalytics ? "md:grid-cols-2" : "md:grid-cols-1")}>
        <div className="rounded-2xl border bg-white p-4" style={{ border: '1px solid rgba(59,36,27,0.10)', boxShadow: '0 2px 16px rgba(59,36,27,0.07)' }}>
          <h2 className="text-lg font-semibold mb-3">Conceptos</h2>

          <form onSubmit={onCreateConcept} className="flex gap-3 mb-4">
            <input
              className="flex-1 rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
              placeholder='Nombre del nuevo concepto (ej. Transferencia, Efectivo...)'
              value={conceptName}
              onChange={(e) => setConceptName(e.target.value)}
              disabled={!canEdit}
            />
            <button
              className="rounded-xl px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 disabled:opacity-50" style={{ background: '#4b2d22', color: '#d3b187', border: '1px solid rgba(211,177,135,0.35)', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}
              disabled={saving || !orgId || !canEdit}
              title={!canEdit ? "Solo editor/administrador" : ""}
            >
              {saving ? "Creando…" : "Crear"}
            </button>
          </form>

          <div className="grid md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Categoría</label>
              <select
                className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                disabled={!categoriesForType.length}
              >
                {categoriesForType.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Sub-categoría</label>
              <select
                className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
                value={selectedSubCategoryId}
                onChange={(e) => setSelectedSubCategoryId(e.target.value)}
                disabled={!subCategories.length}
              >
                {subCategories.map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <ul className="space-y-2">
            {concepts.map((cn) => (
              <li key={cn.id} className="rounded-xl border p-3 flex items-center justify-between">
                <button
                  className={"font-medium underline " + (selectedConceptId === cn.id ? "text-black" : "text-slate-700")}
                  onClick={() => setSelectedConceptId(cn.id)}
                  type="button"
                >
                  {cn.name}
                </button>

                <button
                  onClick={() => onDeleteConcept(cn)}
                  className="rounded-lg border px-3 py-1 text-sm hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                  disabled={!canEdit || busyConceptId === cn.id}
                  title={!canEdit ? "Solo editor/administrador" : ""}
                  type="button"
                >
                  {busyConceptId === cn.id ? "Eliminando…" : "🗑️ Eliminar"}
                </button>
              </li>
            ))}
            {concepts.length === 0 && <li className="text-sm text-slate-500">Aún no hay conceptos.</li>}
          </ul>
        </div>

        {showAnalytics && (
        <div className="rounded-2xl border bg-white p-4" style={{ border: '1px solid rgba(59,36,27,0.10)', boxShadow: '0 2px 16px rgba(59,36,27,0.07)' }}>
          <h2 className="text-lg font-semibold mb-3">Análisis de conceptos</h2>

          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Concepto</label>
              <select
                className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
                value={selectedConceptId}
                onChange={(e) => setSelectedConceptId(e.target.value)}
                disabled={!concepts.length}
              >
                {concepts.map((cn) => (
                  <option key={cn.id} value={cn.id}>
                    {cn.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Agrupar por</label>
              <select
                className="rounded-xl border px-3 py-2"
                value={groupConceptBy}
                onChange={(e) => setGroupConceptBy(e.target.value)}
              >
                <option value="day">Día</option>
                <option value="week">Semana</option>
                <option value="month">Mes</option>
                <option value="year">Año</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-sm mb-2">
            <div>
              <b>Ingreso total:</b>{" "}
              <span className="text-green-600">{totalsConcept.ingreso.toLocaleString("es-MX")}</span>
            </div>
            <div>
              <b>Gasto total:</b>{" "}
              <span className="text-red-600">{totalsConcept.gasto.toLocaleString("es-MX")}</span>
            </div>
            <div>
              <b>Neto:</b> <span className="font-semibold">{totalsConcept.neto.toLocaleString("es-MX")}</span>
            </div>
          </div>

          <EntriesList list={entriesForConcept} />

          <table className="w-full text-sm mt-4">
            <thead>
              <tr className="text-slate-600 border-b">
                <th className="text-left py-2">Concepto: {conceptNameSelected}</th>
                <th className="text-right">Ingreso</th>
                <th className="text-right">Gasto</th>
                <th className="text-right">Neto</th>
              </tr>
            </thead>
            <tbody>
              {groupedConcept.map((r) => (
                <tr key={r.bucket} className="border-b last:border-0">
                  <td className="py-2">{r.bucket}</td>
                  <td className="text-right text-green-600">{r.ingreso.toLocaleString("es-MX")}</td>
                  <td className="text-right text-red-600">{r.gasto.toLocaleString("es-MX")}</td>
                  <td className="text-right font-medium">{r.neto.toLocaleString("es-MX")}</td>
                </tr>
              ))}
              {groupedConcept.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-500">
                    Sin entradas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* ===================== FILA 4: CUENTAS BANCARIAS ===================== */}
      <div className="flex items-center gap-2 mt-6 mb-2">
        <span className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: '#d3b187' }} />
        <span className="text-xs font-bold tracking-widest uppercase" style={{ color: 'rgba(211,177,135,0.5)' }}>Cuentas bancarias</span>
      </div>
      <div className={"grid gap-6 " + (showAnalytics ? "md:grid-cols-2" : "md:grid-cols-1")}>
        <div className="rounded-2xl border bg-white p-4" style={{ border: '1px solid rgba(59,36,27,0.10)', boxShadow: '0 2px 16px rgba(59,36,27,0.07)' }}>
          <h2 className="text-lg font-semibold mb-3">Cuentas bancarias</h2>

          <form
            onSubmit={async (e) => {
              e.preventDefault();

              if (!canEdit) {
                showToast("No tienes permisos para crear cuentas bancarias (solo editor/administrador).", "error");
                return;
              }

              if (!orgRefs) return showToast("No hay organización / bottleId / auth lista aún.", "error");
              if (!bankName.trim()) return showToast("El nombre de la cuenta es obligatorio.", "error");

              try {
                setSaving(true);
                const ref = await addDoc(orgRefs.bankAccountsCol, {
                  name: bankName.trim(),
                  createdAt: serverTimestamp(),
                });
                setBankName("");
                await loadBankAccounts();
                setSelectedBankAccountId(ref.id);
              } catch (err) {
                showToast(err?.message || String(err), "error");
              } finally {
                setSaving(false);
              }
            }}
            className="flex gap-3 mb-4"
          >
            <input
              className="flex-1 rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
              placeholder='Nombre de la cuenta (ej. "BANORTE 8686")'
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              disabled={!canEdit}
            />
            <button
              className="rounded-xl px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 disabled:opacity-50" style={{ background: '#4b2d22', color: '#d3b187', border: '1px solid rgba(211,177,135,0.35)', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}
              disabled={saving || !orgId || !canEdit}
              title={!canEdit ? "Solo editor/administrador" : ""}
            >
              {saving ? "Creando…" : "Crear"}
            </button>
          </form>

          <ul className="space-y-2">
            {bankAccounts.map((b) => (
              <li key={b.id} className="rounded-xl border p-3 flex items-center justify-between">
                <button
                  className={"font-medium underline " + (selectedBankAccountId === b.id ? "text-black" : "text-slate-700")}
                  onClick={() => setSelectedBankAccountId(b.id)}
                  type="button"
                >
                  {b.name}
                </button>

                <button
                  onClick={() => onDeleteBankAccount(b)}
                  className="rounded-lg border px-3 py-1 text-sm hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                  disabled={!canEdit || busyBankId === b.id}
                  title={!canEdit ? "Solo editor/administrador" : ""}
                  type="button"
                >
                  {busyBankId === b.id ? "Eliminando…" : "🗑️ Eliminar"}
                </button>
              </li>
            ))}
            {bankAccounts.length === 0 && <li className="text-sm text-slate-500">Aún no hay cuentas bancarias.</li>}
          </ul>
        </div>

        {showAnalytics && (
        <div className="rounded-2xl border bg-white p-4" style={{ border: '1px solid rgba(59,36,27,0.10)', boxShadow: '0 2px 16px rgba(59,36,27,0.07)' }}>
          <h2 className="text-lg font-semibold mb-3">Análisis de cuentas bancarias</h2>

          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Cuenta bancaria</label>
              <select
                className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
                value={selectedBankAccountId}
                onChange={(e) => setSelectedBankAccountId(e.target.value)}
                disabled={!bankAccounts.length}
              >
                {bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Agrupar por</label>
              <select
                className="rounded-xl border px-3 py-2"
                value={groupBankBy}
                onChange={(e) => setGroupBankBy(e.target.value)}
              >
                <option value="day">Día</option>
                <option value="week">Semana</option>
                <option value="month">Mes</option>
                <option value="year">Año</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-sm mb-2">
            <div>
              <b>Ingreso total:</b>{" "}
              <span className="text-green-600">{totalsBank.ingreso.toLocaleString("es-MX")}</span>
            </div>
            <div>
              <b>Gasto total:</b>{" "}
              <span className="text-red-600">{totalsBank.gasto.toLocaleString("es-MX")}</span>
            </div>
            <div>
              <b>Neto:</b> <span className="font-semibold">{totalsBank.neto.toLocaleString("es-MX")}</span>
            </div>
          </div>

          <EntriesList list={entriesForBank} />

          <table className="w-full text-sm mt-4">
            <thead>
              <tr className="text-slate-600 border-b">
                <th className="text-left py-2">Cuenta: {bankNameSelected}</th>
                <th className="text-right">Ingreso</th>
                <th className="text-right">Gasto</th>
                <th className="text-right">Neto</th>
              </tr>
            </thead>
            <tbody>
              {groupedBank.map((r) => (
                <tr key={r.bucket} className="border-b last:border-0">
                  <td className="py-2">{r.bucket}</td>
                  <td className="text-right text-green-600">{r.ingreso.toLocaleString("es-MX")}</td>
                  <td className="text-right text-red-600">{r.gasto.toLocaleString("es-MX")}</td>
                  <td className="text-right font-medium">{r.neto.toLocaleString("es-MX")}</td>
                </tr>
              ))}
              {groupedBank.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-500">
                    Sin entradas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>

      <div className="h-10" />
    </div>
  );
}
