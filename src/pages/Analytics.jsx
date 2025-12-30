// src/pages/Analytics.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db, storage } from "../firebase";
import { useParams } from "react-router-dom";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import BackToHome from "../components/BackToHome";

import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { buildExcelMaestro } from "../utils/excelMaestro.js";

/* ===================== org -> bottleId ===================== */
const BOTTLE_BY_ORG = {
  iglesia: "de-la-iglesia",
  "construyendo-lazos": "construyendo-lazos",
};

/* ---------------- rangos de tiempo ---------------- */
const RANGE_OPTS = [
  { id: "minute", label: "Minuto a minuto" },
  { id: "hour", label: "Por hora" },
  { id: "day", label: "Diario" },
  { id: "week", label: "Semanal" },
  { id: "month", label: "Mensual" },
  { id: "year", label: "Anual" },
];

const WINDOW = { minute: 60, hour: 24, day: 30, week: 12, month: 12, year: 10 };

function pad2(n) {
  return String(n).padStart(2, "0");
}

function startOfMinute(d) {
  const x = new Date(d);
  x.setSeconds(0, 0);
  return x;
}
function addMinutes(d, n) {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() + n);
  return x;
}
function startOfHour(d) {
  const x = new Date(d);
  x.setMinutes(0, 0, 0);
  return x;
}
function addHours(d, n) {
  const x = new Date(d);
  x.setHours(x.getHours() + n);
  return x;
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
function addWeeks(d, n) {
  return addDays(d, n * 7);
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
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}
function fmtBucket(rangeId, d) {
  if (rangeId === "minute")
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
      d.getHours()
    )}:${pad2(d.getMinutes())}`;
  if (rangeId === "hour")
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
      d.getHours()
    )}:00`;
  if (rangeId === "day") return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  if (rangeId === "week") return `${d.getFullYear()}-W${pad2(isoWeekNum(d))}`;
  if (rangeId === "month") return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  if (rangeId === "year") return `${d.getFullYear()}`;
  return d.toISOString();
}

/* --------------- helpers ----------------- */
function normalizeDate(value, fallback) {
  if (!value && fallback) value = fallback;
  if (!value) return new Date();
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
  return new Date(value);
}

function bucketOf(rangeId, dateLike) {
  const d = normalizeDate(dateLike);
  if (rangeId === "minute") return fmtBucket("minute", startOfMinute(d));
  if (rangeId === "hour") return fmtBucket("hour", startOfHour(d));
  if (rangeId === "day") return fmtBucket("day", startOfDay(d));
  if (rangeId === "week") return fmtBucket("week", startOfWeek(d));
  if (rangeId === "month") return fmtBucket("month", startOfMonth(d));
  if (rangeId === "year") return fmtBucket("year", startOfYear(d));
  return fmtBucket("month", startOfMonth(d));
}

function makeBucketsForRange(rangeId, selectedYear, yearsSpan, now = new Date()) {
  const year = Number(selectedYear);

  if (rangeId === "minute" || rangeId === "hour" || rangeId === "day" || rangeId === "week") {
    const size = WINDOW[rangeId] ?? 12;

    let step, startFn;
    if (rangeId === "minute") {
      step = addMinutes;
      startFn = startOfMinute;
    } else if (rangeId === "hour") {
      step = addHours;
      startFn = startOfHour;
    } else if (rangeId === "day") {
      step = addDays;
      startFn = startOfDay;
    } else {
      step = addWeeks;
      startFn = startOfWeek;
    }

    const buckets = [];
    let cursor = startFn(now);
    for (let i = 0; i < size - 1; i++) cursor = step(cursor, -1);
    for (let i = 0; i < size; i++) {
      buckets.push(fmtBucket(rangeId, cursor));
      cursor = step(cursor, 1);
    }
    return buckets;
  }

  if (rangeId === "month") {
    const buckets = [];
    for (let m = 0; m < 12; m++) buckets.push(`${year}-${pad2(m + 1)}`);
    return buckets;
  }

  if (rangeId === "year") {
    const minY = yearsSpan?.min ?? year;
    const maxY = yearsSpan?.max ?? year;
    const buckets = [];
    for (let y = minY; y <= maxY; y++) buckets.push(String(y));
    return buckets;
  }

  return [];
}

function construirSeries(entries, rangeId, buckets) {
  const ingresoPor = new Map(buckets.map((b) => [b, 0]));
  const gastoPor = new Map(buckets.map((b) => [b, 0]));

  for (const en of entries) {
    const bucket = bucketOf(rangeId, en.date || en.createdAt);
    if (!ingresoPor.has(bucket) && !gastoPor.has(bucket)) continue;

    const monto = Number(en.amount || 0);
    if (en.type === "income") ingresoPor.set(bucket, (ingresoPor.get(bucket) || 0) + monto);
    else gastoPor.set(bucket, (gastoPor.get(bucket) || 0) + monto);
  }

  const ig = buckets.map((b) => ({
    bucket: b,
    ingreso: ingresoPor.get(b) || 0,
    gasto: gastoPor.get(b) || 0,
  }));

  const combinado = buckets.map((b) => ({
    bucket: b,
    neto: (ingresoPor.get(b) || 0) - (gastoPor.get(b) || 0),
  }));

  const porEvento = buckets.map((b) => ({
    bucket: b,
    netoTotal: (ingresoPor.get(b) || 0) - (gastoPor.get(b) || 0),
  }));
  const clavesEvento = ["netoTotal"];

  return { ig, combinado, porEvento, clavesEvento };
}

function groupEntriesByTimeAll(entries, rangeId) {
  const ingresoPor = new Map();
  const gastoPor = new Map();

  for (const en of entries) {
    const b = bucketOf(rangeId, en.date || en.createdAt);
    const amt = Number(en.amount || 0);
    if (en.type === "income") ingresoPor.set(b, (ingresoPor.get(b) || 0) + amt);
    else gastoPor.set(b, (gastoPor.get(b) || 0) + amt);
  }

  const keys = Array.from(new Set([...ingresoPor.keys(), ...gastoPor.keys()]));
  keys.sort((a, b) => {
    if (rangeId === "year") return Number(b) - Number(a);
    return b.localeCompare(a);
  });

  return keys.map((k) => ({
    bucket: k,
    ingreso: ingresoPor.get(k) || 0,
    gasto: gastoPor.get(k) || 0,
    neto: (ingresoPor.get(k) || 0) - (gastoPor.get(k) || 0),
  }));
}

function ChartCard({ title, children }) {
  return (
    <div className="rounded-2xl border bg-white p-5 mb-6">
      <div className="text-sm font-medium mb-3">{title}</div>
      <div className="h-72">{children}</div>
    </div>
  );
}

function TimeSeriesChart({ data, lines, colorByKey = {} }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ left: 8, right: 16, top: 10, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend />
        {lines.map((k) => (
          <Line
            key={k}
            type="monotone"
            dataKey={k}
            strokeWidth={2}
            dot={false}
            connectNulls
            stroke={colorByKey[k]}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ------------------ MultiSelect dropdown limpio ------------------ */
function useOutsideClose(ref, onClose) {
  useEffect(() => {
    function onDown(e) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target)) onClose?.();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ref, onClose]);
}

function DropdownMultiSelect({
  title,
  options,
  values,
  onChange,
  placeholder = "Seleccionar…",
  maxHeight = 320,
  onSelectAll,
  onClear,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef(null);

  useOutsideClose(boxRef, () => setOpen(false));

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return options;
    return options.filter((o) => (o.label || "").toLowerCase().includes(qq));
  }, [options, q]);

  const toggle = (id) => {
    const s = new Set(values);
    s.has(id) ? s.delete(id) : s.add(id);
    onChange(Array.from(s));
  };

  return (
    <div className="relative" ref={boxRef}>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm text-slate-600">{title}</label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSelectAll?.()}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
            disabled={!options.length}
          >
            Seleccionar todo
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded-2xl border px-4 py-3 text-left flex items-center justify-between hover:bg-slate-50"
      >
        <span className="text-slate-700">
          {values.length ? `${values.length} seleccionadas` : placeholder}
        </span>
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-2 w-full rounded-2xl border bg-white shadow-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <input
              className="w-full rounded-xl border px-3 py-2 text-sm"
              placeholder="Buscar…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button
              type="button"
              onClick={() => onClear?.()}
              className="rounded-xl border px-3 py-2 text-sm hover:bg-slate-50"
            >
              Limpiar
            </button>
          </div>

          <div className="overflow-auto" style={{ maxHeight }}>
            {filtered.map((o) => (
              <label
                key={o.id}
                className="flex items-center gap-2 px-2 py-2 rounded-xl hover:bg-slate-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={values.includes(o.id)}
                  onChange={() => toggle(o.id)}
                />
                <span className="text-sm text-slate-700">{o.label}</span>
              </label>
            ))}

            {!filtered.length && (
              <div className="text-sm text-slate-500 px-2 py-3">Sin resultados.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================== normalizador movimientos ===================== */
function normalizeMovimiento(docSnap) {
  const data = docSnap.data() || {};

  const raw = String(data.tipo || data.type || "").toLowerCase();
  const type = raw.includes("ing") ? "income" : raw.includes("inc") ? "income" : "expense";

  const date = normalizeDate(data.Fecha || data.fecha || data.date, data.createdAt);

  const amount =
    typeof data.Monto === "number"
      ? data.Monto
      : typeof data.monto === "number"
      ? data.monto
      : typeof data.amount === "number"
      ? data.amount
      : Number(data.Monto || data.monto || data.amount || 0);

  return {
    id: docSnap.id,
    type,
    amount,
    date,
    createdAt: data.createdAt || null,

    categoria: data.Categoría || data.categoria || "",
    subcategoria: data.Subcategoría || data.subcategoria || "",
    concepto: data.Concepto || data.concepto || "",
    cuentaBancaria: data["Cuenta bancaria"] || data.cuentaBancaria || "",

    categoryId: data.categoryId || "",
    subCategoryId: data.subCategoryId || "",
    conceptId: data.conceptId || "",
    bankAccountId: data.bankAccountId || "",

    beneficiario: data["Referencia/Beneficiario"] || data.beneficiario || "",
    referencia: data.referencia || "",
    formaPago: data["Forma de pago"] || data.formaPago || data.formaDePago || "",
  };
}

/* ---------------- componente ---------------- */
export default function Analytics() {
  const { orgId } = useParams();
  const [uid, setUid] = useState(null);

  const bottleId = useMemo(() => {
    if (!orgId) return null;
    const resolved = BOTTLE_BY_ORG[orgId];
    if (!resolved) throw new Error(`Org desconocida: ${orgId}`);
    return resolved;
  }, [orgId]);

  const [entries, setEntries] = useState([]);

  const [categories, setCategories] = useState([]);
  const [subCategories, setSubCategories] = useState([]);
  const [concepts, setConcepts] = useState([]);

  const [selectedCats, setSelectedCats] = useState([]);
  const [selectedSubs, setSelectedSubs] = useState([]);
  const [selectedConcepts, setSelectedConcepts] = useState([]);

  const [range, setRange] = useState("month");
  const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()));

  const [excelBusy, setExcelBusy] = useState(false);
  const [excelMsg, setExcelMsg] = useState("");
  const [excelLinks, setExcelLinks] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(getAuth(), (user) => setUid(user?.uid || null));
    return () => unsub();
  }, []);

  // ✅ IMPORTANTE: limpiar state al cambiar de bottleId (evita “mezcla visual”)
  useEffect(() => {
    setEntries([]);
    setCategories([]);
    setSubCategories([]);
    setConcepts([]);
    setSelectedCats([]);
    setSelectedSubs([]);
    setSelectedConcepts([]);
  }, [bottleId]);

  useEffect(() => {
    async function load() {
      if (!uid || !orgId || !bottleId) return;

      /* ======= movimientos: SIN orderBy("Fecha") (Iglesia puede no tenerlo) ======= */
      const movSnap = await getDocs(collection(db, "botellas", bottleId, "movimientos"));
      const movs = movSnap.docs
        .map(normalizeMovimiento)
        .filter((m) => m && m.date && !isNaN(new Date(m.date).getTime()))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      setEntries(movs);

      /* ======= catálogos: leer desde botellas/{bottleId} (NO desde users/orgs) ======= */
      const catsSnap = await getDocs(
        query(collection(db, "botellas", bottleId, "categories"), orderBy("name"))
      );
      const cats = catsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setCategories(cats);

      const subs = [];
      const cons = [];

      for (const c of cats) {
        const subsSnap = await getDocs(
          query(
            collection(db, "botellas", bottleId, "categories", c.id, "subcategories"),
            orderBy("name")
          )
        );

        const subsHere = subsSnap.docs.map((d) => ({ id: d.id, categoryId: c.id, ...d.data() }));
        subs.push(...subsHere);

        for (const s of subsHere) {
          const consSnap = await getDocs(
            query(
              collection(
                db,
                "botellas",
                bottleId,
                "categories",
                c.id,
                "subcategories",
                s.id,
                "concepts"
              ),
              orderBy("name")
            )
          );

          cons.push(
            ...consSnap.docs.map((d) => ({
              id: d.id,
              categoryId: c.id,
              subCategoryId: s.id,
              ...d.data(),
            }))
          );
        }
      }

      setSubCategories(subs);
      setConcepts(cons);
    }

    load();
  }, [uid, orgId, bottleId]);

  const categoryNameById = useMemo(() => {
    const m = new Map();
    categories.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [categories]);

  const subNameById = useMemo(() => {
    const m = new Map();
    subCategories.forEach((s) => m.set(s.id, s.name));
    return m;
  }, [subCategories]);

  const categoryIdByName = useMemo(() => {
    const m = new Map();
    categories.forEach((c) => m.set((c.name || "").trim().toLowerCase(), c.id));
    return m;
  }, [categories]);

  const subIdByCatIdAndName = useMemo(() => {
    const m = new Map();
    subCategories.forEach((s) => {
      const key = `${s.categoryId}::${(s.name || "").trim().toLowerCase()}`;
      m.set(key, s.id);
    });
    return m;
  }, [subCategories]);

  const conceptIdBySubIdAndName = useMemo(() => {
    const m = new Map();
    concepts.forEach((c) => {
      const key = `${c.subCategoryId}::${(c.name || "").trim().toLowerCase()}`;
      m.set(key, c.id);
    });
    return m;
  }, [concepts]);

  function resolveIds(en) {
    let categoryId = en.categoryId || "";
    if (!categoryId && en.categoria) {
      categoryId = categoryIdByName.get(en.categoria.trim().toLowerCase()) || "";
    }

    let subCategoryId = en.subCategoryId || "";
    if (!subCategoryId && categoryId && en.subcategoria) {
      const key = `${categoryId}::${en.subcategoria.trim().toLowerCase()}`;
      subCategoryId = subIdByCatIdAndName.get(key) || "";
    }

    let conceptId = en.conceptId || "";
    if (!conceptId && subCategoryId && en.concepto) {
      const key = `${subCategoryId}::${en.concepto.trim().toLowerCase()}`;
      conceptId = conceptIdBySubIdAndName.get(key) || "";
    }

    return { ...en, categoryId, subCategoryId, conceptId };
  }

  const availableSubs = useMemo(() => {
    if (!selectedCats.length) return subCategories;
    const set = new Set(selectedCats);
    return subCategories.filter((s) => set.has(s.categoryId));
  }, [subCategories, selectedCats]);

  const availableConcepts = useMemo(() => {
    if (selectedSubs.length) {
      const set = new Set(selectedSubs);
      return concepts.filter((c) => set.has(c.subCategoryId));
    }
    if (selectedCats.length) {
      const set = new Set(selectedCats);
      return concepts.filter((c) => set.has(c.categoryId));
    }
    return concepts;
  }, [concepts, selectedSubs, selectedCats]);

  useEffect(() => {
    const subSet = new Set(availableSubs.map((s) => s.id));
    setSelectedSubs((prev) => prev.filter((id) => subSet.has(id)));

    const conSet = new Set(availableConcepts.map((c) => c.id));
    setSelectedConcepts((prev) => prev.filter((id) => conSet.has(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCats, subCategories, concepts]);

  const filteredEntriesBase = useMemo(() => {
    const catSet = new Set(selectedCats);
    const subSet = new Set(selectedSubs);
    const conSet = new Set(selectedConcepts);

    return entries
      .map(resolveIds)
      .filter((en) => {
        if (catSet.size && !catSet.has(en.categoryId)) return false;
        if (subSet.size && !subSet.has(en.subCategoryId)) return false;
        if (conSet.size && !conSet.has(en.conceptId)) return false;
        return true;
      });
  }, [entries, selectedCats, selectedSubs, selectedConcepts, categories, subCategories, concepts]);

  const availableYears = useMemo(() => {
    const ys = new Set();
    for (const en of entries) {
      const d = normalizeDate(en.date || en.createdAt);
      if (!isNaN(d.getTime())) ys.add(String(d.getFullYear()));
    }
    const arr = Array.from(ys).sort((a, b) => Number(b) - Number(a));
    return arr.length ? arr : [String(new Date().getFullYear())];
  }, [entries]);

  useEffect(() => {
    if (!availableYears.length) return;
    if (!availableYears.includes(selectedYear)) setSelectedYear(availableYears[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableYears.join("|")]);

  const yearsSpan = useMemo(() => {
    const ys = availableYears.map((y) => Number(y)).filter((n) => !isNaN(n));
    if (!ys.length) return { min: Number(selectedYear), max: Number(selectedYear) };
    return { min: Math.min(...ys), max: Math.max(...ys) };
  }, [availableYears, selectedYear]);

  const filteredEntries = useMemo(() => {
    if (range === "month") {
      const y = Number(selectedYear);
      return filteredEntriesBase.filter(
        (en) => normalizeDate(en.date || en.createdAt).getFullYear() === y
      );
    }
    if (range === "year") return filteredEntriesBase;
    return filteredEntriesBase;
  }, [filteredEntriesBase, range, selectedYear]);

  const chartBuckets = useMemo(() => {
    return makeBucketsForRange(range, selectedYear, yearsSpan);
  }, [range, selectedYear, yearsSpan]);

  const { porEvento, clavesEvento, combinado, ig } = useMemo(() => {
    return construirSeries(filteredEntries, range, chartBuckets);
  }, [filteredEntries, range, chartBuckets]);

  const tableRows = useMemo(() => {
    const rows = groupEntriesByTimeAll(filteredEntries, range);

    if (range === "month") {
      const map = new Map(rows.map((r) => [r.bucket, r]));
      return chartBuckets.map((b) => map.get(b) || { bucket: b, ingreso: 0, gasto: 0, neto: 0 });
    }

    if (range === "year") {
      const map = new Map(rows.map((r) => [r.bucket, r]));
      const ys = [];
      for (let y = yearsSpan.min; y <= yearsSpan.max; y++) ys.push(String(y));
      ys.sort((a, b) => Number(b) - Number(a));
      return ys.map((y) => map.get(y) || { bucket: y, ingreso: 0, gasto: 0, neto: 0 });
    }

    return rows;
  }, [filteredEntries, range, chartBuckets, yearsSpan]);

  const onSelectAllCats = () => setSelectedCats(categories.map((c) => c.id));
  const onSelectAllSubs = () => setSelectedSubs(availableSubs.map((s) => s.id));
  const onSelectAllConcepts = () => setSelectedConcepts(availableConcepts.map((c) => c.id));

  const onClearCats = () => setSelectedCats([]);
  const onClearSubs = () => setSelectedSubs([]);
  const onClearConcepts = () => setSelectedConcepts([]);

  const onSelectAllGlobal = () => {
    setSelectedCats(categories.map((c) => c.id));
    setSelectedSubs(availableSubs.map((s) => s.id));
    setSelectedConcepts(availableConcepts.map((c) => c.id));
  };

  const onClearAll = () => {
    setSelectedCats([]);
    setSelectedSubs([]);
    setSelectedConcepts([]);
  };

  async function onGenerateExcelMaster() {
    if (!orgId || !bottleId) return;

    const auth = getAuth();
    const user = auth.currentUser;

    if (!user?.uid) {
      setExcelMsg("❌ No hay sesión activa. Cierra sesión y vuelve a iniciar.");
      return;
    }

    try {
      setExcelBusy(true);
      setExcelMsg("");
      setExcelLinks(null);

      await user.getIdToken(true);

      const buffer = await buildExcelMaestro({
        entries,
        lookups: {
          categoryNameById,
          subNameById,
          conceptNameById: new Map(concepts.map((c) => [c.id, c.name])),
          bankNameById: new Map(),
        },
      });

      const fileRef = storageRef(storage, `exports/${bottleId}/excel/maestro.xlsx`);

      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      await uploadBytes(fileRef, blob, {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        cacheControl: "no-cache",
      });

      const url = await getDownloadURL(fileRef);

      setExcelLinks({ masterUrl: url, incomeUrl: "", expenseUrl: "" });
      setExcelMsg("✅ Excel maestro actualizado. Ya puedes descargarlo.");
    } catch (err) {
      setExcelMsg(`❌ Error al generar Excel: ${err?.message || String(err)}`);
    } finally {
      setExcelBusy(false);
    }
  }

  const categoryOptions = useMemo(() => {
    return categories.map((c) => ({ id: c.id, label: c.name }));
  }, [categories]);

  const subOptions = useMemo(() => {
    return availableSubs.map((s) => {
      const catName = categoryNameById.get(s.categoryId) || "—";
      const base = s.name || "—";
      const label = base.toLowerCase() === "general" ? `${base} (${catName})` : base;
      return { id: s.id, label };
    });
  }, [availableSubs, categoryNameById]);

  const conceptOptions = useMemo(() => {
    return availableConcepts.map((c) => {
      const catName = categoryNameById.get(c.categoryId) || "—";
      const subName = subNameById.get(c.subCategoryId) || "—";
      const base = c.name || "—";
      const label =
        base.toLowerCase() === "general" ? `${base} (${catName} > ${subName})` : base;
      return { id: c.id, label };
    });
  }, [availableConcepts, categoryNameById, subNameById]);

  const showYearPicker = range === "month" || range === "year";

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl md:text-3xl font-semibold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]">
          Análisis
        </h1>
        <BackToHome className="mb-0" />
      </div>

      <div className="rounded-2xl border bg-white p-5 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
          <div className={showYearPicker ? "md:col-span-6" : "md:col-span-5"}>
            <label className="block text-sm text-slate-600 mb-2">Escala de tiempo</label>
            <select
              className="w-full rounded-2xl border px-4 py-3 text-lg"
              value={range}
              onChange={(e) => setRange(e.target.value)}
            >
              {RANGE_OPTS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {showYearPicker && (
            <div className="md:col-span-6">
              <label className="block text-sm text-slate-600 mb-2">Año</label>
              <select
                className="w-full rounded-2xl border px-4 py-3 text-lg"
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
              >
                {availableYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>

              {range === "year" && (
                <div className="text-xs text-slate-500 mt-2">
                  En “Anual” se muestran todos los años del dataset.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
          <div className="md:col-span-4">
            <DropdownMultiSelect
              title="Categorías (multi)"
              options={categoryOptions}
              values={selectedCats}
              onChange={setSelectedCats}
              onSelectAll={onSelectAllCats}
              onClear={onClearCats}
              placeholder="Seleccionar categorías…"
            />
          </div>

          <div className="md:col-span-4">
            <DropdownMultiSelect
              title="Sub-categorías (multi)"
              options={subOptions}
              values={selectedSubs}
              onChange={setSelectedSubs}
              onSelectAll={onSelectAllSubs}
              onClear={onClearSubs}
              placeholder="Seleccionar sub-categorías…"
            />
          </div>

          <div className="md:col-span-4">
            <DropdownMultiSelect
              title="Conceptos (multi)"
              options={conceptOptions}
              values={selectedConcepts}
              onChange={setSelectedConcepts}
              onSelectAll={onSelectAllConcepts}
              onClear={onClearConcepts}
              placeholder="Seleccionar conceptos…"
            />
          </div>
        </div>

        <div className="mt-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="text-slate-500">
            Lo que no selecciones se toma como “todo”. “General” muestra contexto para no confundirse.
          </div>

          <div className="flex items-center gap-3 justify-end">
            <button
              type="button"
              onClick={onSelectAllGlobal}
              className="rounded-2xl border px-5 py-3 text-lg hover:bg-slate-50"
              disabled={!categories.length && !availableSubs.length && !availableConcepts.length}
            >
              Seleccionar todo
            </button>

            <button
              type="button"
              onClick={onClearAll}
              className="rounded-2xl border px-5 py-3 text-lg hover:bg-slate-50"
            >
              Limpiar selección
            </button>
          </div>
        </div>
      </div>

      <ChartCard title="Seleccionados — Ingreso vs Gasto">
        <TimeSeriesChart
          data={ig}
          lines={["ingreso", "gasto"]}
          colorByKey={{ ingreso: "#16a34a", gasto: "#dc2626" }}
        />
      </ChartCard>

      <ChartCard title="Combinado — Neto (todos los seleccionados)">
        <TimeSeriesChart data={combinado} lines={["neto"]} />
      </ChartCard>

      <ChartCard title="Neto total (según selección)">
        <TimeSeriesChart data={porEvento} lines={clavesEvento} />
      </ChartCard>

      <div className="rounded-2xl border bg-white p-5 mb-6">
        <div className="text-sm font-medium mb-3">Tabla (Ingreso / Gasto / Neto)</div>

        <div className="overflow-auto rounded-xl border" style={{ maxHeight: 420 }}>
          <table className="min-w-[760px] w-full text-sm">
            <thead className="bg-slate-50 sticky top-0">
              <tr className="text-slate-600 border-b">
                <th className="text-left py-2 px-3">Periodo</th>
                <th className="text-right py-2 px-3">Ingreso</th>
                <th className="text-right py-2 px-3">Gasto</th>
                <th className="text-right py-2 px-3">Neto</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr key={r.bucket} className="border-b last:border-0">
                  <td className="py-2 px-3 whitespace-nowrap">{r.bucket}</td>
                  <td className="py-2 px-3 text-right text-green-600">
                    {Number(r.ingreso || 0).toLocaleString("es-MX")}
                  </td>
                  <td className="py-2 px-3 text-right text-red-600">
                    {Number(r.gasto || 0).toLocaleString("es-MX")}
                  </td>
                  <td className="py-2 px-3 text-right font-medium">
                    {Number(r.neto || 0).toLocaleString("es-MX")}
                  </td>
                </tr>
              ))}

              {tableRows.length === 0 && (
                <tr>
                  <td className="py-6 text-center text-slate-500" colSpan={4}>
                    Sin entradas para esta selección.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-slate-500 mt-2">
          Puedes hacer scroll para ver más periodos (años/meses) según el rango seleccionado.
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-5 mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Exportación Excel (Maestro)</div>
            <div className="text-xs text-slate-500">
              Genera/actualiza el Excel maestro en la nube (con pestañas por mes) y lo deja listo para descargar.
            </div>
          </div>

          <button
            type="button"
            onClick={onGenerateExcelMaster}
            disabled={excelBusy || !orgId}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {excelBusy ? "Actualizando…" : "Actualizar Excel Maestro"}
          </button>
        </div>

        {(excelMsg || excelLinks) && (
          <div className="mt-3 text-sm">
            {excelMsg && <div className="mb-2">{excelMsg}</div>}

            {excelLinks && (
              <div className="flex flex-col md:flex-row gap-2">
                {excelLinks.masterUrl ? (
                  <a
                    href={excelLinks.masterUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center rounded-xl border px-3 py-2 text-sm hover:bg-slate-50"
                  >
                    Descargar Maestro
                  </a>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
