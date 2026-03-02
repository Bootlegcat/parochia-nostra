// src/pages/Entries.jsx
import { useEffect, useState, useMemo } from "react";
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
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { useParams } from "react-router-dom";
import BackToHome from "../components/BackToHome";

// ✅ Forma de pago (agregamos "Efectivo")
const PAYMENT_METHODS = [
  "Efectivo",
  "Transferencia",
  "Tarjeta Banorte parroquia",
  "Cheque",
  "Cargo bancario",
];

const BOTTLE_ID_BY_ORG = {
  iglesia: "de-la-iglesia",
  "construyendo-lazos": "construyendo-lazos",
};

function toDateKey(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateInputToTimestamp(dateStr) {
  const [y, m, d] = dateStr.split("-").map((x) => Number(x));
  // 12:00 para evitar shift por zona horaria al convertir
  const dt = new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
  return Timestamp.fromDate(dt);
}

/* ===================== helpers fechas seguras ===================== */
function asDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;

  if (typeof val === "string") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }

  if (typeof val?.toDate === "function") return val.toDate();

  // Firestore Timestamp-like {seconds, nanoseconds}
  if (typeof val?.seconds === "number") return new Date(val.seconds * 1000);

  return null;
}

function displayDate(val) {
  const d = asDate(val);
  return d ? d.toLocaleDateString("es-MX") : "";
}
/* ================================================================== */

/* ===================== NEW: normalize movimientos ===================== */
function normalizeMovToEntry(docSnap) {
  const m = docSnap?.data ? (docSnap.data() || {}) : (docSnap || {});
  const id = docSnap?.id || m._mid || m.id || "";

  // fecha robusta
  const v = m.Fecha ?? m.fecha ?? m.date ?? m.createdAt;
  let dt;
  if (v?.toDate) dt = v.toDate();
  else if (v instanceof Date) dt = v;
  else if (typeof v?.seconds === "number") dt = new Date(v.seconds * 1000);
  else dt = v ? new Date(v) : new Date();
  if (isNaN(dt.getTime())) dt = new Date();

  // tipo robusto
  const rawTipo = String(m.tipo ?? m.Tipo ?? m.TIPO ?? "").toLowerCase();
  const type = rawTipo.includes("ing") ? "income" : "expense";

  // monto robusto
  const rawMonto = m.Monto ?? m.monto ?? m.amount ?? 0;
  const amount =
    typeof rawMonto === "string"
      ? Number(rawMonto.replace(/,/g, "").trim()) || 0
      : Number(rawMonto) || 0;

  // Campos “humanos” para que tu UI no cambie (usa it.formaPago / it.beneficiario etc.)
  const formaPago = String(m["Forma de pago"] ?? m.formaPago ?? m.paymentMethod ?? "").trim();
  const beneficiario = String(
    m["Referencia/Beneficiario"] ?? m.beneficiario ?? m.beneficiary ?? ""
  ).trim();
  const referencia = String(m.referencia ?? m.reference ?? "").trim();

  // Campos de clasificación si existen en movimientos (si no, quedan vacíos)
  const categoria = String(m.categoria ?? m.category ?? "").trim();
  const subcategoria = String(m.subcategoria ?? m.subCategory ?? "").trim();
  const concepto = String(m.concepto ?? m.concept ?? "").trim();
  const cuentaBancaria = String(m.cuentaBancaria ?? m.bankAccount ?? m.cuenta ?? "").trim();

  const dateTs = Timestamp.fromDate(dt);

  return {
    id,
    source: "movimientos",

    type,
    amount,

    date: dateTs,
    dateKey: toDateKey(dt),

    // nombres (para UI/compat)
    categoria,
    subcategoria,
    concepto,
    cuentaBancaria,

    // misc para UI
    formaPago,
    beneficiario,
    referencia,
    note: String(m.note ?? m.nota ?? "").trim(),

    // ids (si existen)
    categoryId: String(m.categoryId ?? "").trim(),
    subCategoryId: String(m.subCategoryId ?? "").trim(),
    conceptId: String(m.conceptId ?? "").trim(),
    bankAccountId: String(m.bankAccountId ?? "").trim(),

    createdAt: m.createdAt ?? null,
  };
}
/* ===================================================================== */

export default function Entries() {
  const { orgId } = useParams();

  // ✅ auth estable (evita uid undefined al montar)
  const [uid, setUid] = useState("");
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, (u) => {
      setUid(u?.uid || "");
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const bottleId = useMemo(() => {
    if (!orgId) return "";
    return BOTTLE_ID_BY_ORG[orgId] || orgId;
  }, [orgId]);

  // ✅ Role
  const [role, setRole] = useState("viewer");
  const [roleReady, setRoleReady] = useState(false);
  const canEdit = role === "admin" || role === "editor";

  // refs base
  const memberDocRef = useMemo(() => {
    if (!uid || !bottleId) return null;
    return doc(db, "botellas", bottleId, "members", uid);
  }, [uid, bottleId]);

  useEffect(() => {
    if (!memberDocRef) return;
    (async () => {
      try {
        setRoleReady(false);
        const snap = await getDoc(memberDocRef);
        const r = snap.exists() ? String(snap.data()?.role || "viewer") : "viewer";
        setRole(r === "admin" || r === "editor" || r === "viewer" ? r : "viewer");
      } catch {
        setRole("viewer");
      } finally {
        setRoleReady(true);
      }
    })();
  }, [memberDocRef?.path]);

  const entriesRefs = useMemo(() => {
    if (!uid || !bottleId) return null;
    return {
      entriesCol: collection(db, "botellas", bottleId, "entries"),
      entryDoc: (id) => doc(db, "botellas", bottleId, "entries", id),

      // ✅ NEW: para que el delete también funcione si el item viene de movimientos
      movsCol: collection(db, "botellas", bottleId, "movimientos"),
      movDoc: (id) => doc(db, "botellas", bottleId, "movimientos", id),
    };
  }, [uid, bottleId]);

  // Catálogos (como ya lo tienes)
  const orgRefs = useMemo(() => {
    if (!uid || !bottleId) return null;
    return {
      categoriesCol: collection(db, "botellas", bottleId, "categories"),
      subcategoriesCol: (categoryId) =>
        collection(db, "botellas", bottleId, "categories", categoryId, "subcategories"),
      conceptsCol: (categoryId, subCategoryId) =>
        collection(
          db,
          "botellas",
          bottleId,
          "categories",
          categoryId,
          "subcategories",
          subCategoryId,
          "concepts"
        ),
      bankAccountsCol: collection(db, "botellas", bottleId, "bankAccounts"),
    };
  }, [uid, bottleId]);

  // formulario
  const [type, setType] = useState("expense");
  const [amount, setAmount] = useState("");

  // ids
  const [categoryId, setCategoryId] = useState("");
  const [subCategoryId, setSubCategoryId] = useState("");
  const [conceptId, setConceptId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");

  // modo texto (fallback solo para cuenta bancaria)
  const [bankAccountText, setBankAccountText] = useState("");

  const [paymentMethod, setPaymentMethod] = useState("Efectivo");
  const [beneficiary, setBeneficiary] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  // catálogos
  const [categories, setCategories] = useState([]);
  const [subCategories, setSubCategories] = useState([]);
  const [concepts, setConcepts] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);

  // lista (ahora: entries o movimientos, dependiendo de lo que exista)
  const [items, setItems] = useState([]);

  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  // maps para nombres
  const categoryNameById = useMemo(() => {
    const m = new Map();
    categories.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [categories]);

  const subCategoryNameById = useMemo(() => {
    const m = new Map();
    subCategories.forEach((s) => m.set(s.id, s.name));
    return m;
  }, [subCategories]);

  const conceptNameById = useMemo(() => {
    const m = new Map();
    concepts.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [concepts]);

  const bankNameById = useMemo(() => {
    const m = new Map();
    bankAccounts.forEach((b) => m.set(b.id, b.name));
    return m;
  }, [bankAccounts]);

  const categoryType = type === "income" ? "ingreso" : "egreso";

  const categoriesForType = useMemo(() => {
    return categories.filter((c) => (c.tipo || "").toLowerCase() === categoryType);
  }, [categories, categoryType]);

  const hasCategoryCatalogs = useMemo(() => {
    return categoriesForType.length > 0;
  }, [categoriesForType.length]);

  async function loadCatalogs() {
    if (!orgRefs) return;
    try {
      const catSnap = await getDocs(query(orgRefs.categoriesCol, orderBy("name")));
      const cats = catSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setCategories(cats);
    if (!categoryId && cats[0]?.id) setCategoryId(cats[0].id);

      const bankSnap = await getDocs(query(orgRefs.bankAccountsCol, orderBy("name")));
      const banks = bankSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setBankAccounts(banks);
      if (!bankAccountId && banks[0]?.id) setBankAccountId(banks[0].id);
    } catch (e) {
      console.error("Entries loadCatalogs error:", e);
      setCategories([]);
      setBankAccounts([]);
    }
  }

  useEffect(() => {
    loadCatalogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgRefs]);

  useEffect(() => {
    if (!categoriesForType.length) {
      setCategoryId("");
      setSubCategoryId("");
      setConceptId("");
      return;
    }
    if (!categoriesForType.some((c) => c.id === categoryId)) {
      setCategoryId(categoriesForType[0]?.id || "");
      setSubCategoryId("");
      setConceptId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryType, categoriesForType.length]);

  // sub-categorías
  useEffect(() => {
    (async () => {
      if (!orgRefs || !categoryId) {
        setSubCategories([]);
        setSubCategoryId("");
        setConcepts([]);
        setConceptId("");
        return;
      }
      try {
        let seSnap;
      try {
        seSnap = await getDocs(query(orgRefs.subcategoriesCol(categoryId), orderBy("name")));
        } catch {
          seSnap = await getDocs(orgRefs.subcategoriesCol(categoryId));
        }
        const subs = seSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setSubCategories(subs);
        setSubCategoryId(subs[0]?.id ?? "");
        setConcepts([]);
        setConceptId("");
      } catch (e) {
        console.error("Entries loadSubCategories error:", e);
        setSubCategories([]);
        setSubCategoryId("");
        setConcepts([]);
        setConceptId("");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, orgRefs]);

  // conceptos
  useEffect(() => {
    (async () => {
      if (!orgRefs || !categoryId || !subCategoryId) {
        setConcepts([]);
        setConceptId("");
        return;
      }
      try {
        let cSnap;
        try {
          cSnap = await getDocs(
            query(orgRefs.conceptsCol(categoryId, subCategoryId), orderBy("name"))
          );
        } catch {
          cSnap = await getDocs(orgRefs.conceptsCol(categoryId, subCategoryId));
        }
        const cons = cSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setConcepts(cons);
        setConceptId(cons[0]?.id ?? "");
      } catch (e) {
        console.error("Entries loadConcepts error:", e);
        setConcepts([]);
        setConceptId("");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subCategoryId, categoryId, orgRefs]);

  function normalizeEntryDoc(d) {
    const data = d.data() || {};

    const tipoRaw = (data.type || data.tipo || "").toString().toLowerCase();
    const tipo = tipoRaw.includes("ing") || tipoRaw === "income" ? "income" : "expense";

    // ✅ fecha principal: date (Timestamp)
    const dateObj = asDate(data.date || data.fecha || data.dateStr || data.dateKey);

    return {
      id: d.id,
      source: "entries",

      type: tipo,
      amount:
        typeof data.amount === "number"
          ? data.amount
          : typeof data.monto === "number"
          ? data.monto
          : Number(data.amount || data.monto || 0),

      // guardamos ambos por compatibilidad
      date: data.date || data.fecha || (dateObj ? Timestamp.fromDate(dateObj) : null),
      dateKey:
        data.dateKey ||
        data.dateStr ||
        (dateObj ? toDateKey(dateObj) : typeof data.date === "string" ? data.date : ""),

      // nombres (para UI/compat)
      categoria: data.category || data.categoria || "",
      subcategoria: data.subCategory || data.subcategoria || "",
      concepto: data.concept || data.concepto || "",
      cuentaBancaria: data.bankAccount || data.cuentaBancaria || data.cuenta || "",

      formaPago:
        data.paymentMethod || data.formaPago || data.forma_de_pago || data.payment_method || "",
      beneficiario: data.beneficiary || data.beneficiario || data.beneficiario_o_proveedor || "",
      referencia: data.reference || data.referencia || "",
      note: data.note || data.nota || "",

      // ids (para filtros limpios)
      categoryId: data.categoryId || "",
      subCategoryId: data.subCategoryId || "",
      conceptId: data.conceptId || "",
      bankAccountId: data.bankAccountId || "",

      createdAt: data.createdAt || null,
    };
  }

  /* ===================== NEW: loader genérico (entries -> movimientos) ===================== */
  async function loadUltimosMovimientosUnified() {
    if (!entriesRefs) return;

    // 1) Si hay entries, usamos entries
    try {
      const snapE1 = await getDocs(query(entriesRefs.entriesCol, limit(1)));
      if (!snapE1.empty) {
        let snap;
        try {
          snap = await getDocs(query(entriesRefs.entriesCol, orderBy("date", "desc"), limit(200)));
        } catch {
          snap = await getDocs(
            query(entriesRefs.entriesCol, orderBy("createdAt", "desc"), limit(200))
          );
        }

        const rows = snap.docs.map(normalizeEntryDoc);

        rows.sort((a, b) => {
          const da = asDate(a.date) || asDate(a.createdAt);
          const dbb = asDate(b.date) || asDate(b.createdAt);
          const ta = da ? da.getTime() : 0;
          const tb = dbb ? dbb.getTime() : 0;
          return tb - ta;
        });

        setItems(rows);
        return;
      }
    } catch {
      // ignore y probamos movimientos
    }

    // 2) Fallback: movimientos (si existen)
    let snapM = null;
    const tries = [
      ["Fecha", "desc"],
      ["fecha", "desc"],
      ["createdAt", "desc"],
    ];

    for (const [field, dir] of tries) {
      try {
        snapM = await getDocs(query(entriesRefs.movsCol, orderBy(field, dir), limit(200)));
        if (!snapM.empty) break;
      } catch {}
    }
    if (!snapM) snapM = await getDocs(query(entriesRefs.movsCol, limit(200)));

    const rows = snapM.docs.map((d) => normalizeMovToEntry(d));

    // orden final robusto
    rows.sort((a, b) => {
      const da = asDate(a.date) || asDate(a.createdAt);
      const dbb = asDate(b.date) || asDate(b.createdAt);
      const ta = da ? da.getTime() : 0;
      const tb = dbb ? dbb.getTime() : 0;
      return tb - ta;
    });

    setItems(rows);
  }
  /* ================================================================== */

  useEffect(() => {
    loadUltimosMovimientosUnified();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entriesRefs]);

  async function onCreate(e) {
    e.preventDefault();
    setError("");

    if (!canEdit) return setError("No tienes permisos para agregar (solo editor/admin).");
    if (!entriesRefs || !orgId) return setError("No hay organización seleccionada.");

    const amt = Number(amount);
    if (!amt || amt <= 0) return setError("El monto debe ser mayor que 0.");
    if (!date) return setError("La fecha es obligatoria.");

    if (!hasCategoryCatalogs) {
      return setError(
        `No hay categorías de ${categoryType}. Asigna el tipo a las categorías para poder registrar.`
      );
    }

    const categoriaFinal = categoryNameById.get(categoryId) || "";
    const subcategoriaFinal = subCategoryNameById.get(subCategoryId) || "";
    const conceptoFinal = conceptNameById.get(conceptId) || "";
    const cuentaFinal = bankAccounts.length > 0
      ? bankNameById.get(bankAccountId) || ""
      : bankAccountText.trim();

    if (!cuentaFinal) return setError("La cuenta bancaria es obligatoria.");
    if (!categoriaFinal) return setError("La categoría es obligatoria.");
    if (!subcategoriaFinal) return setError("La sub-categoría es obligatoria.");
    if (!conceptoFinal) return setError("El concepto es obligatorio.");

    if (type === "expense" && !paymentMethod) {
      return setError("La forma de pago es obligatoria en egresos.");
    }

    try {
      setSaving(true);

      const dateTs = parseDateInputToTimestamp(date);

      // ✅ ESCRIBIR EN LA RUTA UNICA (entries)
      await addDoc(entriesRefs.entriesCol, {
        // normalizado
        type: type === "income" ? "income" : "expense",
        amount: amt,
        date: dateTs,
        dateKey: toDateKey(dateTs.toDate()),

        // nombres (compat / lectura humana)
        category: categoriaFinal,
        subCategory: subcategoriaFinal,
        concept: conceptoFinal,
        bankAccount: cuentaFinal,

        // ids (para que “General” no se mezcle con otros “General”)
        categoryId: hasCategoryCatalogs ? (categoryId || "") : "",
        subCategoryId: hasCategoryCatalogs ? (subCategoryId || "") : "",
        conceptId: hasCategoryCatalogs ? (conceptId || "") : "",
        bankAccountId: bankAccounts.length > 0 ? (bankAccountId || "") : "",

        paymentMethod: paymentMethod || "",
        beneficiary: beneficiary.trim() || "",
        reference: "",
        note: note.trim() || "",

        createdAt: serverTimestamp(),
        source: { origin: "app" },
      });

      setAmount("");
      setNote("");
      setBeneficiary("");

      await loadUltimosMovimientosUnified();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(item) {
    if (!entriesRefs || !item?.id) return;

    if (!canEdit) return setError("No tienes permisos para eliminar (solo editor/admin).");

    const ok = window.confirm(
      `¿Eliminar este ${item.type === "income" ? "ingreso" : "egreso"} de ${item.amount}?`
    );
    if (!ok) return;

    try {
      setBusyId(item.id);

      // ✅ BORRAR EN LA MISMA RUTA DE DONDE VIENE (entries o movimientos)
      if (item.source === "movimientos") {
        await deleteDoc(entriesRefs.movDoc(item.id));
      } else {
        await deleteDoc(entriesRefs.entryDoc(item.id));
      }

      await loadUltimosMovimientosUnified();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusyId("");
    }
  }

  // tip UX (no cambia UI, solo mensaje)
  const roleHint = useMemo(() => {
    if (!authReady) return "";
    if (!roleReady) return "Cargando permisos…";
    if (canEdit) return "";
    return "Tu rol es viewer: solo puedes ver. Pide al admin que te suba a editor.";
  }, [authReady, roleReady, canEdit]);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl md:text-3xl font-semibold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]">
          Ingresos y Gastos
        </h1>
        <BackToHome />
      </div>

      {!orgId && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-amber-800 mb-4">
          No hay organización en la URL. Vuelve al inicio y elige una.
        </div>
      )}

      {roleHint && (
        <div className="rounded-xl bg-white/90 border p-3 text-sm text-slate-700 mb-4">
          {roleHint}
        </div>
      )}

      <form onSubmit={onCreate} className="rounded-2xl border bg-white p-4 space-y-3 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Tipo</label>
            <select
              className="w-full rounded-xl border px-3 py-2"
              value={type}
              onChange={(e) => setType(e.target.value)}
              disabled={!canEdit}
              title={!canEdit ? "Solo editor/admin" : ""}
            >
              <option value="income">Ingreso</option>
              <option value="expense">Egreso</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">Monto</label>
            <input
              type="number"
              step="any"
              className="w-full rounded-xl border px-3 py-2"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              disabled={!canEdit}
              title={!canEdit ? "Solo editor/admin" : ""}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">Fecha</label>
            <input
              type="date"
              className="w-full rounded-xl border px-3 py-2"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={!canEdit}
              title={!canEdit ? "Solo editor/admin" : ""}
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-xs text-slate-500 mb-1">Cuenta bancaria</label>

            {bankAccounts.length > 0 ? (
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                disabled={!canEdit}
                title={!canEdit ? "Solo editor/admin" : ""}
              >
                <option value="">Selecciona una cuenta…</option>
                {bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="w-full rounded-xl border px-3 py-2"
                value={bankAccountText}
                onChange={(e) => setBankAccountText(e.target.value)}
                placeholder='Ej. "BANORTE 8686"'
                disabled={!canEdit}
                title={!canEdit ? "Solo editor/admin" : ""}
              />
            )}
          </div>
        </div>

        {categoriesForType.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Categoría</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={!canEdit}
                title={!canEdit ? "Solo editor/admin" : ""}
              >
                <option value="">Selecciona…</option>
                {categoriesForType.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">Sub-categoría</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={subCategoryId}
                onChange={(e) => setSubCategoryId(e.target.value)}
                disabled={!categoryId || !canEdit}
                title={!canEdit ? "Solo editor/admin" : ""}
              >
                <option value="">Selecciona…</option>
                {subCategories.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">Concepto</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={conceptId}
                onChange={(e) => setConceptId(e.target.value)}
                disabled={!subCategoryId || !canEdit}
                title={!canEdit ? "Solo editor/admin" : ""}
              >
                <option value="">Selecciona…</option>
                {concepts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Categoría</label>
              <select className="w-full rounded-xl border px-3 py-2" disabled>
                <option>No hay categorías de {categoryType}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Sub-categoría</label>
              <select className="w-full rounded-xl border px-3 py-2" disabled>
                <option>Selecciona una categoría</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Concepto</label>
              <select className="w-full rounded-xl border px-3 py-2" disabled>
                <option>Selecciona una sub-categoría</option>
              </select>
            </div>
            <div className="md:col-span-3 text-xs text-slate-500">
              No hay categorías de {categoryType}. Usa el script de backfill para asignar el tipo.
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Forma de pago</label>
            <select
              className="w-full rounded-xl border px-3 py-2"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              disabled={!canEdit}
              title={!canEdit ? "Solo editor/admin" : ""}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs text-slate-500 mb-1">Beneficiario / proveedor</label>
            <input
              className="w-full rounded-xl border px-3 py-2"
              value={beneficiary}
              onChange={(e) => setBeneficiary(e.target.value)}
              placeholder='Ej. "Banorte" o "Sistemas y Equipos Ejecutivos, S.A."'
              disabled={!canEdit}
              title={!canEdit ? "Solo editor/admin" : ""}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-500 mb-1">Nota (opcional)</label>
          <input
            className="w-full rounded-xl border px-3 py-2"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Añade una nota…"
            disabled={!canEdit}
            title={!canEdit ? "Solo editor/admin" : ""}
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            className="rounded-xl bg-black text-white px-4 py-2 disabled:opacity-50"
            disabled={saving || !orgId || !canEdit}
            title={!canEdit ? "Solo editor/admin" : ""}
          >
            {saving ? "Guardando…" : "Agregar"}
          </button>
          {error && <span className="text-red-600 text-sm">{error}</span>}
        </div>
      </form>

      <div className="rounded-2xl border bg-white">
        <div className="px-4 py-3 border-b text-sm text-slate-500">Últimos movimientos</div>

        <ul className="divide-y">
          {items.map((it) => {
            const cat = it.categoria || "(sin categoría)";
            const sub = it.subcategoria || "";
            const con = it.concepto || "";
            const bank = it.cuentaBancaria || "";

            // ✅ fecha segura: Timestamp/string/Date
            const fechaParaMostrar = it.date || it.dateKey || it.createdAt;

            return (
              <li
                key={`${it.source}-${it.id}`}
                className="px-4 py-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm">
                    <span className={it.type === "income" ? "text-green-600" : "text-red-600"}>
                      {it.type === "income" ? "+" : "-"}
                      {Number(it.amount).toLocaleString("es-MX")}
                    </span>{" "}
                    <span className="text-slate-500">
                      — {cat}
                      {sub ? ` · ${sub}` : ""}
                      {con ? ` · ${con}` : ""}
                    </span>
                  </div>

                  <div className="text-xs text-slate-500">
                    {displayDate(fechaParaMostrar)}
                    {bank ? ` • ${bank}` : ""}
                    {it.formaPago ? ` • ${it.formaPago}` : ""}
                    {it.beneficiario ? ` • ${it.beneficiario}` : ""}
                    {it.note ? ` • ${it.note}` : ""}
                  </div>
                </div>

                <button
                  onClick={() => onDelete(it)}
                  className="shrink-0 rounded-lg border px-3 py-1 text-sm hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                  disabled={busyId === it.id || !canEdit}
                  title={!canEdit ? "Solo editor/admin" : "Eliminar"}
                >
                  {busyId === it.id ? "Eliminando…" : "🗑️ Eliminar"}
                </button>
              </li>
            );
          })}

          {items.length === 0 && (
            <li className="px-4 py-6 text-sm text-slate-500">Aún no hay movimientos.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
