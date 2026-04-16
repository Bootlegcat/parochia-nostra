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
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useToast } from "../components/Toast.jsx";
import { useConfirm } from "../components/ConfirmModal.jsx";

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

  // Campos "humanos" para que tu UI no cambie (usa it.formaPago / it.beneficiario etc.)
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
  const { showToast } = useToast();
  const confirm = useConfirm();

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

  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo]     = useState("");
  const [filterCat, setFilterCat]   = useState("");
  const [filterMin, setFilterMin]   = useState("");
  const [filterMax, setFilterMax]   = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const [showImport, setShowImport] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const [importBusy, setImportBusy] = useState(false);

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

  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      const d = asDate(it.date || it.dateKey || it.createdAt);
      if (filterFrom) {
        const from = new Date(filterFrom + "T00:00:00");
        if (!d || d < from) return false;
      }
      if (filterTo) {
        const to = new Date(filterTo + "T23:59:59");
        if (!d || d > to) return false;
      }
      if (filterCat) {
        const haystack = (it.categoria || "").toLowerCase();
        if (!haystack.includes(filterCat.toLowerCase())) return false;
      }
      if (filterMin !== "") {
        if (it.amount < Number(filterMin)) return false;
      }
      if (filterMax !== "") {
        if (it.amount > Number(filterMax)) return false;
      }
      return true;
    });
  }, [items, filterFrom, filterTo, filterCat, filterMin, filterMax]);

  const activeFilterCount = [filterFrom, filterTo, filterCat, filterMin, filterMax].filter(Boolean).length;

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

    if (!canEdit) return showToast("No tienes permisos para agregar (solo editor/administrador).", "error");
    if (!entriesRefs || !orgId) return showToast("No hay organización seleccionada.", "error");

    const amt = Number(amount);
    if (!amt || amt <= 0) return showToast("El monto debe ser mayor que 0.", "error");
    if (!date) return showToast("La fecha es obligatoria.", "error");

    if (!hasCategoryCatalogs) {
      return showToast(`No hay categorías de ${categoryType}. Asigna el tipo a las categorías para poder registrar.`, "error");
    }

    const categoriaFinal = categoryNameById.get(categoryId) || "";
    const subcategoriaFinal = subCategoryNameById.get(subCategoryId) || "";
    const conceptoFinal = conceptNameById.get(conceptId) || "";
    const cuentaFinal = bankAccounts.length > 0
      ? bankNameById.get(bankAccountId) || ""
      : bankAccountText.trim();

    if (!cuentaFinal) return showToast("La cuenta bancaria es obligatoria.", "error");
    if (!categoriaFinal) return showToast("La categoría es obligatoria.", "error");
    if (!subcategoriaFinal) return showToast("La sub-categoría es obligatoria.", "error");
    if (!conceptoFinal) return showToast("El concepto es obligatorio.", "error");

    if (type === "expense" && !paymentMethod) {
      return showToast("La forma de pago es obligatoria en egresos.", "error");
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

        // ids (para que "General" no se mezcle con otros "General")
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

      showToast("Movimiento agregado correctamente.", "success");
      setAmount("");
      setNote("");
      setBeneficiary("");

      await loadUltimosMovimientosUnified();
    } catch (err) {
      showToast(err?.message || String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(item) {
    if (!entriesRefs || !item?.id) return;

    if (!canEdit) return showToast("No tienes permisos para eliminar (solo editor/administrador).", "error");

    const ok = await confirm(`¿Eliminar este ${item.type === "income" ? "ingreso" : "egreso"} de ${item.amount}?`);
    if (!ok) return;

    try {
      setBusyId(item.id);

      // ✅ BORRAR EN LA MISMA RUTA DE DONDE VIENE (entries o movimientos)
      if (item.source === "movimientos") {
        await deleteDoc(entriesRefs.movDoc(item.id));
      } else {
        await deleteDoc(entriesRefs.entryDoc(item.id));
      }

      showToast("Movimiento eliminado.", "success");
      await loadUltimosMovimientosUnified();
    } catch (err) {
      showToast(err?.message || String(err), "error");
    } finally {
      setBusyId("");
    }
  }

  // tip UX (no cambia UI, solo mensaje)
  const roleHint = useMemo(() => {
    if (!authReady) return "";
    if (!roleReady) return "Cargando permisos…";
    if (canEdit) return "";
    return "Tu rol es lector: solo puedes ver. Pide al administrador que te suba a editor.";
  }, [authReady, roleReady, canEdit]);

  function formatRowForExport(it) {
    return {
      Fecha: displayDate(it.date || it.dateKey || it.createdAt),
      Tipo: it.type === "income" ? "Ingreso" : "Egreso",
      Monto: it.amount,
      "Categoría": it.categoria || "",
      "Subcategoría": it.subcategoria || "",
      Concepto: it.concepto || "",
      Cuenta: it.cuentaBancaria || "",
      "Forma de pago": it.formaPago || "",
      Beneficiario: it.beneficiario || "",
      Nota: it.note || "",
    };
  }

  async function exportExcel() {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Movimientos");
    ws.columns = [
      { header: "Fecha", key: "Fecha", width: 14 },
      { header: "Tipo", key: "Tipo", width: 10 },
      { header: "Monto", key: "Monto", width: 14 },
      { header: "Categoría", key: "Categoría", width: 18 },
      { header: "Subcategoría", key: "Subcategoría", width: 18 },
      { header: "Concepto", key: "Concepto", width: 24 },
      { header: "Cuenta", key: "Cuenta", width: 14 },
      { header: "Forma de pago", key: "Forma de pago", width: 18 },
      { header: "Beneficiario", key: "Beneficiario", width: 18 },
      { header: "Nota", key: "Nota", width: 24 },
    ];
    ws.getRow(1).font = { bold: true };
    filteredItems.forEach((it) => ws.addRow(formatRowForExport(it)));
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `movimientos_${orgId}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Excel exportado correctamente.", "success");
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text(`Movimientos — ${orgId}`, 14, 15);
    const head = [["Fecha","Tipo","Monto","Categoría","Subcategoría","Concepto","Cuenta","Forma de pago","Beneficiario","Nota"]];
    const body = filteredItems.map((it) => [
      displayDate(it.date || it.dateKey || it.createdAt),
      it.type === "income" ? "Ingreso" : "Egreso",
      `$${Number(it.amount).toLocaleString("es-MX")}`,
      it.categoria || "", it.subcategoria || "", it.concepto || "",
      it.cuentaBancaria || "", it.formaPago || "", it.beneficiario || "", it.note || "",
    ]);
    autoTable(doc, { head, body, startY: 22, headStyles: { fillColor: [75,45,34], textColor: [211,177,135] }, styles: { fontSize: 8 } });
    doc.save(`movimientos_${orgId}_${new Date().toISOString().slice(0, 10)}.pdf`);
    showToast("PDF exportado correctamente.", "success");
  }

  async function onFileImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { defval: "" });
      function parseExcelDate(v) {
        if (!v) return "";
        if (typeof v === "number") {
          const d = new Date(Math.round((v - 25569) * 86400 * 1000));
          return d.toISOString().slice(0, 10);
        }
        return String(v).slice(0, 10);
      }
      const rows = raw.map((r) => ({
        date: parseExcelDate(r.Fecha ?? r.Date ?? r.fecha ?? r.date ?? ""),
        type: String(r.Tipo ?? r.Type ?? r.tipo ?? r.type ?? "Egreso").toLowerCase().includes("ing") ? "income" : "expense",
        amount: Number(String(r.Monto ?? r.Amount ?? r.monto ?? r.amount ?? 0).replace(/,/g, "")) || 0,
        categoria: String(r["Categoría"] ?? r.Category ?? r.categoria ?? r.category ?? ""),
        subcategoria: String(r["Subcategoría"] ?? r.subcategoria ?? r.subCategory ?? ""),
        concepto: String(r.Concepto ?? r.concepto ?? r.concept ?? ""),
        note: String(r.Nota ?? r.nota ?? r.Note ?? ""),
      }));
      setImportRows(rows.filter((r) => r.amount > 0));
      e.target.value = "";
    } catch (err) {
      showToast(`Error al leer el archivo: ${err?.message || String(err)}`, "error");
    }
  }

  async function onConfirmImport() {
    if (!importRows.length || !entriesRefs) return;
    if (!canEdit) return showToast("No tienes permisos para importar.", "error");
    try {
      setImportBusy(true);
      for (const row of importRows) {
        const dateTs = row.date
          ? parseDateInputToTimestamp(row.date)
          : parseDateInputToTimestamp(new Date().toISOString().slice(0, 10));
        await addDoc(entriesRefs.entriesCol, {
          type: row.type, amount: row.amount, date: dateTs,
          dateKey: row.date || toDateKey(new Date()),
          category: row.categoria, subCategory: row.subcategoria, concept: row.concepto,
          bankAccount: "", categoryId: "", subCategoryId: "", conceptId: "", bankAccountId: "",
          paymentMethod: "", beneficiary: "", reference: "", note: row.note,
          createdAt: serverTimestamp(), source: { origin: "import" },
        });
      }
      showToast(`${importRows.length} registros importados correctamente.`, "success");
      setImportRows([]);
      setShowImport(false);
      await loadUltimosMovimientosUnified();
    } catch (err) {
      showToast(err?.message || String(err), "error");
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl md:text-4xl font-bold" style={{ fontFamily: '"Cinzel", Georgia, serif', color: '#d3b187' }}>
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

      <div className="flex items-center gap-2 mb-2">
        <span className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: '#d3b187' }} />
        <span className="text-xs font-bold tracking-widest uppercase" style={{ color: 'rgba(211,177,135,0.5)' }}>Agregar movimiento</span>
      </div>
      <form onSubmit={onCreate} className="rounded-2xl border bg-white p-4 space-y-3 mb-6" style={{ border: '1px solid rgba(59,36,27,0.10)', boxShadow: '0 2px 16px rgba(59,36,27,0.07)' }}>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Tipo</label>
            <select
              className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
              value={type}
              onChange={(e) => setType(e.target.value)}
              disabled={!canEdit}
              title={!canEdit ? "Solo editor/administrador" : ""}
            >
              <option value="income">Ingreso</option>
              <option value="expense">Egreso</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Monto</label>
            <input
              type="number"
              step="any"
              className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              disabled={!canEdit}
              title={!canEdit ? "Solo editor/administrador" : ""}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Fecha</label>
            <input
              type="date"
              className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={!canEdit}
              title={!canEdit ? "Solo editor/administrador" : ""}
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Cuenta bancaria</label>

            {bankAccounts.length > 0 ? (
              <select
                className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                disabled={!canEdit}
                title={!canEdit ? "Solo editor/administrador" : ""}
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
                className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
                value={bankAccountText}
                onChange={(e) => setBankAccountText(e.target.value)}
                placeholder='Ej. "BANORTE 8686"'
                disabled={!canEdit}
                title={!canEdit ? "Solo editor/administrador" : ""}
              />
            )}
          </div>
        </div>

        {categoriesForType.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Categoría</label>
              <select
                className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={!canEdit}
                title={!canEdit ? "Solo editor/administrador" : ""}
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
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Sub-categoría</label>
              <select
                className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
                value={subCategoryId}
                onChange={(e) => setSubCategoryId(e.target.value)}
                disabled={!categoryId || !canEdit}
                title={!canEdit ? "Solo editor/administrador" : ""}
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
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Concepto</label>
              <select
                className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
                value={conceptId}
                onChange={(e) => setConceptId(e.target.value)}
                disabled={!subCategoryId || !canEdit}
                title={!canEdit ? "Solo editor/administrador" : ""}
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
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Categoría</label>
              <select className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition" disabled>
                <option>No hay categorías de {categoryType}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Sub-categoría</label>
              <select className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition" disabled>
                <option>Selecciona una categoría</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Concepto</label>
              <select className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition" disabled>
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
            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Forma de pago</label>
            <select
              className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              disabled={!canEdit}
              title={!canEdit ? "Solo editor/administrador" : ""}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Beneficiario / proveedor</label>
            <input
              className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
              value={beneficiary}
              onChange={(e) => setBeneficiary(e.target.value)}
              placeholder='Ej. "Banorte" o "Sistemas y Equipos Ejecutivos, S.A."'
              disabled={!canEdit}
              title={!canEdit ? "Solo editor/administrador" : ""}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Nota (opcional)</label>
          <input
            className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Añade una nota…"
            disabled={!canEdit}
            title={!canEdit ? "Solo editor/administrador" : ""}
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            className="rounded-xl px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 disabled:opacity-50"
            style={{ background: '#4b2d22', color: '#d3b187', border: '1px solid rgba(211,177,135,0.35)', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}
            disabled={saving || !orgId || !canEdit}
            title={!canEdit ? "Solo editor/administrador" : ""}
          >
            {saving ? "Guardando…" : "Agregar"}
          </button>
        </div>
      </form>

      {/* ── Filters ── */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-xl transition"
            style={{ background: 'rgba(211,177,135,0.08)', color: '#d3b187', border: '1px solid rgba(211,177,135,0.2)' }}
          >
            Filtros {showFilters ? "▴" : "▾"}
            {activeFilterCount > 0 && (
              <span className="rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold" style={{ background: '#d3b187', color: '#3b241b' }}>
                {activeFilterCount}
              </span>
            )}
          </button>
          {activeFilterCount > 0 && (
            <button type="button" onClick={() => { setFilterFrom(""); setFilterTo(""); setFilterCat(""); setFilterMin(""); setFilterMax(""); }} className="text-xs underline" style={{ color: 'rgba(211,177,135,0.6)' }}>
              Limpiar
            </button>
          )}
        </div>
        {showFilters && (
          <div className="rounded-2xl border bg-white p-4 grid grid-cols-2 md:grid-cols-5 gap-3" style={{ border: '1px solid rgba(59,36,27,0.10)' }}>
            <div>
              <label className="block text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-1">Desde</label>
              <input type="date" className="w-full rounded-xl border px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-300" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-1">Hasta</label>
              <input type="date" className="w-full rounded-xl border px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-300" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-1">Categoría</label>
              <input type="text" placeholder="buscar…" className="w-full rounded-xl border px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-300" value={filterCat} onChange={(e) => setFilterCat(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-1">Monto min</label>
              <input type="number" step="any" className="w-full rounded-xl border px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-300" value={filterMin} onChange={(e) => setFilterMin(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-1">Monto max</label>
              <input type="number" step="any" className="w-full rounded-xl border px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-300" value={filterMax} onChange={(e) => setFilterMax(e.target.value)} />
            </div>
          </div>
        )}
      </div>

      {/* ── Export + Import buttons ── */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button type="button" onClick={exportExcel} disabled={filteredItems.length === 0} className="rounded-xl px-3 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5 disabled:opacity-40" style={{ background: 'rgba(34,197,94,0.1)', color: '#16a34a', border: '1px solid rgba(34,197,94,0.2)' }}>
          ↓ Excel
        </button>
        <button type="button" onClick={exportPDF} disabled={filteredItems.length === 0} className="rounded-xl px-3 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5 disabled:opacity-40" style={{ background: 'rgba(239,68,68,0.1)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.2)' }}>
          ↓ PDF
        </button>
        {canEdit && (
          <button type="button" onClick={() => setShowImport((v) => !v)} className="rounded-xl px-3 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5" style={{ background: 'rgba(211,177,135,0.08)', color: '#d3b187', border: '1px solid rgba(211,177,135,0.2)' }}>
            ↑ Importar Excel
          </button>
        )}
      </div>

      {/* ── Import panel ── */}
      {showImport && canEdit && (
        <div className="rounded-2xl border bg-white p-4 mb-4" style={{ border: '1px solid rgba(59,36,27,0.10)' }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: '#d3b187' }} />
            <span className="text-xs font-bold tracking-widest uppercase" style={{ color: 'rgba(211,177,135,0.5)' }}>Importar desde Excel</span>
          </div>
          <p className="text-xs text-slate-500 mb-3">Columnas: Fecha, Tipo (Ingreso/Egreso), Monto, Categoría, Subcategoría, Concepto, Nota</p>
          <input type="file" accept=".xlsx" onChange={onFileImport} className="block text-sm text-slate-600 mb-3" />
          {importRows.length > 0 && (
            <>
              <div className="overflow-x-auto mb-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left border-b">
                      {["Fecha","Tipo","Monto","Categoría","Nota"].map((h) => (
                        <th key={h} className="py-1 pr-3 text-slate-400 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.slice(0, 10).map((r, i) => (
                      <tr key={i} className="border-b">
                        <td className="py-1 pr-3">{r.date}</td>
                        <td className="py-1 pr-3" style={{ color: r.type === "income" ? "#16a34a" : "#dc2626" }}>{r.type === "income" ? "Ingreso" : "Egreso"}</td>
                        <td className="py-1 pr-3">{Number(r.amount).toLocaleString("es-MX")}</td>
                        <td className="py-1 pr-3">{r.categoria}</td>
                        <td className="py-1">{r.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {importRows.length > 10 && <p className="text-xs text-slate-400 mt-1">+ {importRows.length - 10} más filas</p>}
              </div>
              <button type="button" onClick={onConfirmImport} disabled={importBusy} className="rounded-xl px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 disabled:opacity-50" style={{ background: '#4b2d22', color: '#d3b187', border: '1px solid rgba(211,177,135,0.35)' }}>
                {importBusy ? "Importando…" : `Importar ${importRows.length} registros`}
              </button>
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 mb-2">
        <span className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: '#d3b187' }} />
        <span className="text-xs font-bold tracking-widest uppercase" style={{ color: 'rgba(211,177,135,0.5)' }}>Últimos movimientos</span>
      </div>
      <div className="text-xs text-slate-500 mb-2">
        Mostrando {filteredItems.length} de {items.length} movimientos
      </div>
      <div className="rounded-2xl border bg-white" style={{ border: '1px solid rgba(59,36,27,0.10)', boxShadow: '0 2px 16px rgba(59,36,27,0.07)' }}>

        <ul className="divide-y">
          {filteredItems.map((it) => {
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
                  title={!canEdit ? "Solo editor/administrador" : "Eliminar"}
                >
                  {busyId === it.id ? "Eliminando…" : "🗑️ Eliminar"}
                </button>
              </li>
            );
          })}

          {filteredItems.length === 0 && items.length === 0 && (
            <li className="px-4 py-6 text-sm text-slate-500">Aún no hay movimientos.</li>
          )}
          {filteredItems.length === 0 && items.length > 0 && (
            <li className="px-4 py-6 text-sm text-slate-500">Ningún movimiento coincide con los filtros.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
