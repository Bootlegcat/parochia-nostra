// src/pages/EntryAnalytics.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { Link, useParams } from "react-router-dom";
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

/* ─── paleta del sitio ─── */
const C = {
  page:     "#3b241b",
  tile:     "#4b2d22",
  tileText: "#d3b187",
  border:   "rgba(211,177,135,0.25)",
  borderMd: "rgba(211,177,135,0.45)",
};

const SPECIAL_ENTRY_ID = "parroquia-nuestra-senora-de-guadalupe";
const SPECIAL_BOTTLES  = ["de-la-iglesia", "construyendo-lazos"];

const RANGE_OPTS = [
  { id: "hour",  label: "Por hora"  },
  { id: "week",  label: "Semanal"   },
  { id: "month", label: "Mensual"   },
  { id: "year",  label: "Anual"     },
];

const MESES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

/* ─── helpers de fecha ─── */
function pad2(n) { return String(n).padStart(2, "0"); }
function startOfHour(d)  { const x=new Date(d); x.setMinutes(0,0,0); return x; }
function startOfDay(d)   { const x=new Date(d); x.setHours(0,0,0,0); return x; }
function startOfWeek(d)  { const x=startOfDay(d); let dw=x.getDay(); dw=dw===0?7:dw; x.setDate(x.getDate()-(dw-1)); return x; }
function startOfMonth(d) { return new Date(d.getFullYear(),d.getMonth(),1); }
function startOfYear(d)  { return new Date(d.getFullYear(),0,1); }
function addHours(d,n)   { const x=new Date(d); x.setHours(x.getHours()+n); return x; }
function addDays(d,n)    { const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function isoWeekNum(date) {
  const d=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
  const day=d.getUTCDay()||7; d.setUTCDate(d.getUTCDate()+4-day);
  const ys=new Date(Date.UTC(d.getUTCFullYear(),0,1));
  return Math.ceil(((d-ys)/86400000+1)/7);
}
function normalizeDate(value, fallback) {
  if (!value && fallback) value = fallback;
  if (!value) return new Date();
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
  return new Date(value);
}
function fmtBucket(rangeId, d) {
  if (rangeId==="hour")  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:00`;
  if (rangeId==="week")  return `${d.getFullYear()}-W${pad2(isoWeekNum(d))}`;
  if (rangeId==="month") return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`;
  if (rangeId==="year")  return `${d.getFullYear()}`;
  return d.toISOString();
}
function bucketOf(rangeId, dateLike) {
  const d=normalizeDate(dateLike);
  if (rangeId==="hour")  return fmtBucket("hour",  startOfHour(d));
  if (rangeId==="week")  return fmtBucket("week",  startOfWeek(d));
  if (rangeId==="month") return fmtBucket("month", startOfMonth(d));
  if (rangeId==="year")  return fmtBucket("year",  startOfYear(d));
  return fmtBucket("month", startOfMonth(d));
}
function makeBuckets(rangeId, selectedYear, yearsSpan, now=new Date(), selectedMonth) {
  const year=Number(selectedYear);
  if (rangeId==="hour") {
    const buckets=[]; let cursor=startOfHour(now);
    for (let i=0;i<23;i++) cursor=addHours(cursor,-1);
    for (let i=0;i<24;i++) { buckets.push(fmtBucket("hour",cursor)); cursor=addHours(cursor,1); }
    return buckets;
  }
  if (rangeId==="week") {
    const m=Math.max(1,Math.min(12,Number(selectedMonth||1)));
    const first=new Date(year,m-1,1), last=new Date(year,m,0);
    const seen=new Set(); const buckets=[];
    let cursor=new Date(first);
    while (cursor<=last) {
      const b=fmtBucket("week",startOfWeek(cursor));
      if (!seen.has(b)) { seen.add(b); buckets.push(b); }
      cursor=addDays(cursor,1);
    }
    return buckets;
  }
  if (rangeId==="month") return Array.from({length:12},(_,i)=>`${year}-${pad2(i+1)}`);
  if (rangeId==="year") {
    const minY=yearsSpan?.min??year, maxY=yearsSpan?.max??year;
    const buckets=[]; for (let y=minY;y<=maxY;y++) buckets.push(String(y)); return buckets;
  }
  return [];
}
function construirSeries(entries, rangeId, buckets) {
  const inc=new Map(buckets.map(b=>[b,0]));
  const exp=new Map(buckets.map(b=>[b,0]));
  for (const en of entries) {
    const b=bucketOf(rangeId,en.date||en.createdAt);
    const amt=Number(en.amount||0);
    if (inc.has(b)||exp.has(b)) {
      if (en.type==="income") inc.set(b,(inc.get(b)||0)+amt);
      else exp.set(b,(exp.get(b)||0)+amt);
    }
  }
  const ig       = buckets.map(b=>({bucket:b,ingreso:inc.get(b)||0,gasto:exp.get(b)||0}));
  const combinado= buckets.map(b=>({bucket:b,neto:(inc.get(b)||0)-(exp.get(b)||0)}));
  return { ig, combinado };
}
function groupByTime(entries, rangeId) {
  const map=new Map();
  for (const en of entries) {
    const b=bucketOf(rangeId,en.date||en.createdAt);
    const obj=map.get(b)||{ingreso:0,gasto:0};
    const amt=Number(en.amount||0);
    if (en.type==="income") obj.ingreso+=amt; else obj.gasto+=amt;
    map.set(b,obj);
  }
  return Array.from(map.entries())
    .map(([bucket,v])=>({bucket,ingreso:v.ingreso,gasto:v.gasto,neto:v.ingreso-v.gasto}))
    .sort((a,b)=>a.bucket.localeCompare(b.bucket));
}
function totals(list) {
  let ingreso=0, gasto=0;
  for (const en of list) { const amt=Number(en.amount||0); if (en.type==="income") ingreso+=amt; else gasto+=amt; }
  return { ingreso, gasto, neto: ingreso-gasto };
}
function fmtMoney(n) {
  return Number(n||0).toLocaleString("es-MX",{minimumFractionDigits:2,maximumFractionDigits:2});
}
function normKey(s) {
  return String(s||"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
}
function normalizeMovimiento(docSnap, bottleId) {
  const data=docSnap.data()||{};
  const raw=String(data.tipo||data.type||"").toLowerCase();
  const type=raw.includes("ing")||raw.includes("inc")?"income":"expense";
  const date=normalizeDate(data.Fecha||data.fecha||data.date,data.createdAt);
  const amount=
    typeof data.Monto==="number"?data.Monto:
    typeof data.monto==="number"?data.monto:
    typeof data.amount==="number"?data.amount:
    Number(data.Monto||data.monto||data.amount||0);
  return {
    id:`${bottleId}:${docSnap.id}`, bottleId, type, amount, date,
    createdAt:data.createdAt||null,
    categoria:data.Categoría||data.categoria||"",
    categoryId:data.categoryId||"",
  };
}

/* ─── sub-componentes visuales ─── */

function PageCard({ children, className="" }) {
  return (
    <div
      className={`rounded-2xl p-5 mb-5 ${className}`}
      style={{ background:"#fff", border:`1px solid rgba(59,36,27,0.10)`, boxShadow:"0 2px 16px rgba(59,36,27,0.07)" }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="w-1 h-5 rounded-full inline-block" style={{ background: C.tileText }} />
      <span className="text-sm font-semibold text-slate-700 tracking-wide uppercase">{children}</span>
    </div>
  );
}

function StatCard({ label, value, color, icon }) {
  return (
    <div
      className="rounded-2xl p-5 flex flex-col items-center justify-center text-center"
      style={{ background: C.tile, border: `1px solid ${C.borderMd}`, boxShadow:"0 4px 20px rgba(0,0,0,0.18)" }}
    >
      <div className="text-2xl mb-1" style={{ color: C.tileText, opacity: 0.7 }}>{icon}</div>
      <div className="text-xs font-medium mb-2" style={{ color: C.tileText, opacity: 0.7, letterSpacing:"0.08em", textTransform:"uppercase" }}>
        {label}
      </div>
      <div className="text-2xl md:text-3xl font-bold" style={{ color }}>
        ${fmtMoney(value)}
      </div>
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <PageCard>
      <SectionTitle>{title}</SectionTitle>
      <div className="h-64">{children}</div>
    </PageCard>
  );
}

function TimeSeriesChart({ data, lines, colorByKey={} }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{left:8,right:16,top:8,bottom:8}}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
        <XAxis dataKey="bucket" tick={{fontSize:11}} tickLine={false} />
        <YAxis tick={{fontSize:11}} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ borderRadius:12, border:"1px solid #e2e8f0", fontSize:13 }}
          formatter={(v)=>(typeof v==="number"?`$${fmtMoney(v)}`:v)}
        />
        <Legend wrapperStyle={{fontSize:13}} />
        {lines.map(k=>(
          <Line key={k} type="monotone" dataKey={k} strokeWidth={2.5} dot={false} connectNulls stroke={colorByKey[k]||"#64748b"} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function useOutsideClose(ref, onClose) {
  useEffect(()=>{
    function onDown(e){if(ref.current&&!ref.current.contains(e.target))onClose?.();}
    document.addEventListener("mousedown",onDown);
    return ()=>document.removeEventListener("mousedown",onDown);
  },[ref,onClose]);
}

function MultiSelect({ title, options, values, onChange, placeholder="Seleccionar…" }) {
  const [open,setOpen]=useState(false);
  const [q,setQ]=useState("");
  const boxRef=useRef(null);
  useOutsideClose(boxRef,()=>setOpen(false));
  const filtered=useMemo(()=>{
    const qq=q.trim().toLowerCase();
    return qq?options.filter(o=>(o.label||"").toLowerCase().includes(qq)):options;
  },[options,q]);
  const toggle=id=>{const s=new Set(values);s.has(id)?s.delete(id):s.add(id);onChange(Array.from(s));};
  return (
    <div className="relative" ref={boxRef}>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">{title}</label>
        <div className="flex gap-1.5">
          <button type="button" onClick={()=>onChange(options.map(o=>o.id))}
            className="rounded-lg border px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-50 transition">Todo</button>
          <button type="button" onClick={()=>onChange([])}
            className="rounded-lg border px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-50 transition">Limpiar</button>
        </div>
      </div>
      <button type="button" onClick={()=>setOpen(v=>!v)}
        className="w-full rounded-xl border px-3 py-2.5 text-left flex items-center justify-between hover:bg-slate-50 transition text-sm">
        <span className="text-slate-600">{values.length?`${values.length} seleccionadas`:placeholder}</span>
        <span className="text-slate-400 text-xs">{open?"▲":"▼"}</span>
      </button>
      {open&&(
        <div className="absolute z-20 mt-1.5 w-full rounded-xl border bg-white shadow-xl p-2.5" style={{boxShadow:"0 8px 32px rgba(0,0,0,0.12)"}}>
          <input className="w-full rounded-lg border px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-1 focus:ring-amber-300"
            placeholder="Buscar…" value={q} onChange={e=>setQ(e.target.value)} />
          <div className="overflow-auto" style={{maxHeight:260}}>
            {filtered.map(o=>(
              <label key={o.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-amber-50 cursor-pointer transition">
                <input type="checkbox" className="accent-amber-700" checked={values.includes(o.id)} onChange={()=>toggle(o.id)} />
                <span className="text-sm text-slate-700">{o.label}</span>
              </label>
            ))}
            {!filtered.length&&<div className="text-sm text-slate-400 px-2 py-3 text-center">Sin resultados.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function DataTable({ columns, rows, emptyMsg="Sin datos." }) {
  return (
    <div className="overflow-auto rounded-xl border" style={{borderColor:"rgba(0,0,0,0.08)"}}>
      <table className="w-full text-sm min-w-max">
        <thead>
          <tr style={{background:"rgba(59,36,27,0.05)"}}>
            {columns.map(col=>(
              <th key={col.key}
                className={`py-2.5 px-3 text-xs font-semibold tracking-wide text-slate-500 uppercase ${col.align==="right"?"text-right":"text-left"}`}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length===0?(
            <tr><td colSpan={columns.length} className="py-8 text-center text-slate-400 text-sm">{emptyMsg}</td></tr>
          ):rows.map((row,i)=>(
            <tr key={row._key??i} className="border-t transition hover:bg-amber-50/40" style={{borderColor:"rgba(0,0,0,0.05)"}}>
              {columns.map(col=>(
                <td key={col.key} className={`py-2.5 px-3 ${col.align==="right"?"text-right":""} ${col.className??""}`}>
                  {row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── componente principal ─── */
export default function EntryAnalytics() {
  const { entryId } = useParams();
  const [uid, setUid] = useState(null);

  const [bottleIds,    setBottleIds]    = useState([]);
  const [bottleNames,  setBottleNames]  = useState({});
  const [entryName,    setEntryName]    = useState("");
  const [loadingBottles, setLoadingBottles] = useState(true);

  const [allEntries,   setAllEntries]   = useState([]);
  const [loadingMovs,  setLoadingMovs]  = useState(false);
  const [mergedCats,   setMergedCats]   = useState([]);

  const [selectedCats, setSelectedCats] = useState([]);
  const [range,        setRange]        = useState("month");
  const [selectedYear, setSelectedYear] = useState(()=>String(new Date().getFullYear()));
  const [selectedMonth,setSelectedMonth]= useState(()=>String(new Date().getMonth()+1));
  const [viewByBottle, setViewByBottle] = useState(false);
  const [error,        setError]        = useState("");

  useEffect(()=>{
    const unsub=onAuthStateChanged(getAuth(),u=>setUid(u?.uid||null));
    return ()=>unsub();
  },[]);

  /* ─── cargar botellas ─── */
  useEffect(()=>{
    if (!uid||!entryId) return;
    let alive=true;
    (async()=>{
      setLoadingBottles(true);
      try {
        let ids=[];
        if (entryId===SPECIAL_ENTRY_ID) {
          ids=[...SPECIAL_BOTTLES];
        } else {
          const uSnap=await getDoc(doc(db,"users",uid));
          const userBottleIds=uSnap.exists()?(uSnap.data()?.bottleIds||[]):[];
          for (const bid of userBottleIds) {
            try {
              const bSnap=await getDoc(doc(db,"botellas",bid));
              if (bSnap.exists()&&bSnap.data()?.entryId===entryId) ids.push(bid);
            } catch { /* ignorar */ }
          }
        }
        const names={};
        let eName="";
        for (const bid of ids) {
          try {
            const bSnap=await getDoc(doc(db,"botellas",bid));
            if (bSnap.exists()) {
              names[bid]=bSnap.data()?.name||bid;
              if (!eName) eName=bSnap.data()?.entryName||"";
            }
          } catch { names[bid]=bid; }
        }
        if (!alive) return;
        setBottleIds(ids); setBottleNames(names); setEntryName(eName);
      } catch(e) { if (alive) setError(e?.message||String(e)); }
      finally    { if (alive) setLoadingBottles(false); }
    })();
    return ()=>{alive=false;};
  },[uid,entryId]);

  /* ─── cargar movimientos + catálogos ─── */
  useEffect(()=>{
    if (!uid||!bottleIds.length) return;
    let alive=true;
    (async()=>{
      setLoadingMovs(true); setError("");
      try {
        const movsArrays=await Promise.all(
          bottleIds.map(async bid=>{
            try {
              const snap=await getDocs(collection(db,"botellas",bid,"movimientos"));
              return snap.docs
                .map(d=>normalizeMovimiento(d,bid))
                .filter(m=>m.date&&!isNaN(new Date(m.date).getTime()));
            } catch { return []; }
          })
        );
        const allMovs=movsArrays.flat().sort((a,b)=>new Date(a.date)-new Date(b.date));

        const catMap=new Map();
        await Promise.all(bottleIds.map(async bid=>{
          try {
            const snap=await getDocs(collection(db,"botellas",bid,"categories"));
            for (const d of snap.docs) {
              const name=d.data()?.name||d.id;
              const key=normKey(name);
              if (!catMap.has(key)) catMap.set(key,{name,bottleCatIds:[]});
              catMap.get(key).bottleCatIds.push({bottleId:bid,catId:d.id});
            }
          } catch { /* ignorar */ }
        }));

        const merged=Array.from(catMap.entries())
          .map(([key,v])=>({id:key,name:v.name,bottleCatIds:v.bottleCatIds}))
          .sort((a,b)=>a.name.localeCompare(b.name));

        if (!alive) return;
        setAllEntries(allMovs); setMergedCats(merged);
      } catch(e) { if (alive) setError(e?.message||String(e)); }
      finally    { if (alive) setLoadingMovs(false); }
    })();
    return ()=>{alive=false;};
  },[uid,bottleIds.join(",")]);

  /* ─── resolver categoryId ─── */
  const catIdToMergedKey=useMemo(()=>{
    const map=new Map();
    for (const mc of mergedCats)
      for (const {bottleId,catId} of mc.bottleCatIds)
        map.set(`${bottleId}:${catId}`,mc.id);
    return map;
  },[mergedCats]);

  const resolvedEntries=useMemo(()=>{
    return allEntries.map(en=>{
      let mk=en.categoryId?catIdToMergedKey.get(`${en.bottleId}:${en.categoryId}`)||"":"";
      if (!mk&&en.categoria) mk=normKey(en.categoria);
      return {...en,mergedCatKey:mk};
    });
  },[allEntries,catIdToMergedKey]);

  /* ─── filtros ─── */
  const catFilterSet=useMemo(()=>new Set(selectedCats),[selectedCats]);
  const filteredBase=useMemo(()=>{
    if (!catFilterSet.size) return resolvedEntries;
    return resolvedEntries.filter(en=>catFilterSet.has(en.mergedCatKey));
  },[resolvedEntries,catFilterSet]);

  const availableYears=useMemo(()=>{
    const ys=new Set();
    for (const en of allEntries) {
      const d=normalizeDate(en.date||en.createdAt);
      if (!isNaN(d.getTime())) ys.add(String(d.getFullYear()));
    }
    const arr=Array.from(ys).sort((a,b)=>Number(b)-Number(a));
    return arr.length?arr:[String(new Date().getFullYear())];
  },[allEntries]);

  useEffect(()=>{
    if (!availableYears.includes(selectedYear)) setSelectedYear(availableYears[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[availableYears.join("|")]);

  const yearsSpan=useMemo(()=>{
    const ys=availableYears.map(Number).filter(n=>!isNaN(n));
    if (!ys.length) return {min:Number(selectedYear),max:Number(selectedYear)};
    return {min:Math.min(...ys),max:Math.max(...ys)};
  },[availableYears,selectedYear]);

  const filteredEntries=useMemo(()=>{
    if (range==="month") {
      const y=Number(selectedYear);
      return filteredBase.filter(en=>normalizeDate(en.date||en.createdAt).getFullYear()===y);
    }
    if (range==="week") {
      const y=Number(selectedYear),m=Number(selectedMonth);
      return filteredBase.filter(en=>{
        const d=normalizeDate(en.date||en.createdAt);
        return d.getFullYear()===y&&d.getMonth()+1===m;
      });
    }
    return filteredBase;
  },[filteredBase,range,selectedYear,selectedMonth]);

  const chartBuckets=useMemo(()=>makeBuckets(range,selectedYear,yearsSpan,new Date(),selectedMonth),[range,selectedYear,yearsSpan,selectedMonth]);
  const {ig,combinado}=useMemo(()=>construirSeries(filteredEntries,range,chartBuckets),[filteredEntries,range,chartBuckets]);

  const tableRows=useMemo(()=>{
    const rows=groupByTime(filteredEntries,range);
    if (range==="month") {
      const map=new Map(rows.map(r=>[r.bucket,r]));
      return chartBuckets.map(b=>map.get(b)||{bucket:b,ingreso:0,gasto:0,neto:0});
    }
    if (range==="year") {
      const map=new Map(rows.map(r=>[r.bucket,r]));
      const ys=[]; for (let y=yearsSpan.min;y<=yearsSpan.max;y++) ys.push(String(y));
      ys.sort((a,b)=>Number(b)-Number(a));
      return ys.map(y=>map.get(y)||{bucket:y,ingreso:0,gasto:0,neto:0});
    }
    return rows;
  },[filteredEntries,range,chartBuckets,yearsSpan]);

  const globalTotals=useMemo(()=>totals(filteredEntries),[filteredEntries]);
  const bottleSummary=useMemo(()=>bottleIds.map(bid=>({
    bottleId:bid, name:bottleNames[bid]||bid,
    ...totals(filteredEntries.filter(en=>en.bottleId===bid))
  })),[bottleIds,filteredEntries,bottleNames]);

  const catSummary=useMemo(()=>{
    const map=new Map();
    const nameByKey=new Map(mergedCats.map(c=>[c.id,c.name]));
    for (const en of filteredEntries) {
      const key=en.mergedCatKey||"__sin__";
      const obj=map.get(key)||{key,name:nameByKey.get(key)||en.categoria||"Sin categoría",ingreso:0,gasto:0};
      const amt=Number(en.amount||0);
      if (en.type==="income") obj.ingreso+=amt; else obj.gasto+=amt;
      obj.neto=obj.ingreso-obj.gasto;
      map.set(key,obj);
    }
    return Array.from(map.values()).sort((a,b)=>(b.ingreso+b.gasto)-(a.ingreso+a.gasto));
  },[filteredEntries,mergedCats]);

  const showYearPicker  = range==="month"||range==="year"||range==="week";
  const showMonthPicker = range==="week";
  const catOptions=useMemo(()=>mergedCats.map(c=>({id:c.id,label:c.name})),[mergedCats]);

  function netoColor(n) { return n>=0?"#16a34a":"#dc2626"; }

  /* ─── render ─── */
  if (loadingBottles) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{background:C.page}}>
        <div className="rounded-2xl px-8 py-6 text-center" style={{background:C.tile,color:C.tileText,border:`1px solid ${C.border}`}}>
          Cargando entrada…
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-6">

      {/* ── Encabezado ── */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]"
            style={{fontFamily:'"Cinzel", Georgia, serif', color:C.tileText}}>
            Análisis General
          </h1>
          {entryName && (
            <p className="mt-1 text-sm" style={{color:"rgba(211,177,135,0.7)"}}>
              {entryName}
            </p>
          )}
        </div>
        <Link to="/especiales"
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition hover:-translate-y-0.5"
          style={{background:C.tile,color:C.tileText,border:`1px solid ${C.borderMd}`,boxShadow:"0 4px 12px rgba(0,0,0,0.2)"}}>
          ← Volver
        </Link>
      </div>

      {/* ── Botellas incluidas ── */}
      <div className="rounded-2xl p-4 mb-5 flex flex-wrap items-center gap-3"
        style={{background:C.tile,border:`1px solid ${C.border}`,boxShadow:"0 2px 12px rgba(0,0,0,0.15)"}}>
        <span className="text-xs font-semibold uppercase tracking-widest" style={{color:C.tileText,opacity:0.6}}>
          Botellas
        </span>
        <div className="w-px h-4 self-center" style={{background:C.border}} />
        {bottleIds.map(bid=>(
          <span key={bid} className="rounded-xl px-3 py-1 text-sm font-medium"
            style={{background:"rgba(211,177,135,0.12)",color:C.tileText,border:`1px solid ${C.border}`}}>
            {bottleNames[bid]||bid}
          </span>
        ))}
        {!bottleIds.length&&<span className="text-sm" style={{color:C.tileText,opacity:0.5}}>Sin botellas.</span>}
      </div>

      {/* ── Error ── */}
      {error&&(
        <div className="rounded-xl p-3 mb-4 text-sm" style={{background:"#fef2f2",border:"1px solid #fecaca",color:"#991b1b"}}>
          {error}
        </div>
      )}

      {/* ── Cargando movimientos ── */}
      {loadingMovs&&(
        <div className="rounded-xl p-4 mb-4 text-sm text-center" style={{background:C.tile,color:C.tileText,border:`1px solid ${C.border}`}}>
          Cargando movimientos…
        </div>
      )}

      {/* ── Tarjetas de totales ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard label="Ingresos totales" value={globalTotals.ingreso} color="#4ade80" icon="▲" />
        <StatCard label="Gastos totales"   value={globalTotals.gasto}   color="#f87171" icon="▼" />
        <StatCard label="Neto"             value={globalTotals.neto}    color={netoColor(globalTotals.neto)} icon="=" />
      </div>

      {/* ── Filtros ── */}
      <PageCard>
        <SectionTitle>Filtros</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
          <div className={showYearPicker?"md:col-span-3":"md:col-span-4"}>
            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Escala de tiempo</label>
            <select className="w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
              value={range} onChange={e=>setRange(e.target.value)}>
              {RANGE_OPTS.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
          {showYearPicker&&(
            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Año</label>
              <select className="w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
                value={selectedYear} onChange={e=>setSelectedYear(e.target.value)}>
                {availableYears.map(y=><option key={y} value={y}>{y}</option>)}
              </select>
              {showMonthPicker&&(
                <div className="mt-3">
                  <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Mes</label>
                  <select className="w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
                    value={selectedMonth} onChange={e=>setSelectedMonth(e.target.value)}>
                    {MESES.map((m,i)=><option key={m} value={String(i+1)}>{m}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}
          <div className={showYearPicker?"md:col-span-6":"md:col-span-8"}>
            <MultiSelect
              title="Categorías"
              options={catOptions}
              values={selectedCats}
              onChange={setSelectedCats}
              placeholder="Todas las categorías"
            />
          </div>
        </div>
      </PageCard>

      {/* ── Gráficas ── */}
      <ChartCard title="Ingreso vs Gasto — Entrada completa">
        <TimeSeriesChart data={ig} lines={["ingreso","gasto"]} colorByKey={{ingreso:"#16a34a",gasto:"#dc2626"}} />
      </ChartCard>

      <ChartCard title="Neto — Entrada completa">
        <TimeSeriesChart data={combinado} lines={["neto"]} colorByKey={{neto:"#2563eb"}} />
      </ChartCard>

      {/* ── Tabla resumen por período ── */}
      <PageCard>
        <SectionTitle>Resumen por período</SectionTitle>
        <DataTable
          columns={[
            {key:"bucket",  label:"Período"},
            {key:"ingreso", label:"Ingreso", align:"right"},
            {key:"gasto",   label:"Gasto",   align:"right"},
            {key:"neto",    label:"Neto",    align:"right"},
          ]}
          rows={tableRows.map(r=>({
            _key: r.bucket,
            bucket:  <span className="font-mono text-xs text-slate-600">{r.bucket}</span>,
            ingreso: <span className="font-medium text-green-700">${fmtMoney(r.ingreso)}</span>,
            gasto:   <span className="font-medium text-red-600">${fmtMoney(r.gasto)}</span>,
            neto:    <span className={`font-semibold ${r.neto>=0?"text-green-700":"text-red-600"}`}>${fmtMoney(r.neto)}</span>,
          }))}
        />
      </PageCard>

      {/* ── Resumen por botella ── */}
      <PageCard>
        <SectionTitle>Resumen por botella</SectionTitle>
        <DataTable
          columns={[
            {key:"name",    label:"Botella"},
            {key:"ingreso", label:"Ingresos", align:"right"},
            {key:"gasto",   label:"Gastos",   align:"right"},
            {key:"neto",    label:"Neto",     align:"right"},
          ]}
          rows={bottleSummary.map(b=>({
            _key: b.bottleId,
            name:    <span className="font-medium text-slate-700">{b.name}</span>,
            ingreso: <span className="font-medium text-green-700">${fmtMoney(b.ingreso)}</span>,
            gasto:   <span className="font-medium text-red-600">${fmtMoney(b.gasto)}</span>,
            neto:    <span className={`font-semibold ${b.neto>=0?"text-green-700":"text-red-600"}`}>${fmtMoney(b.neto)}</span>,
          }))}
        />
      </PageCard>

      {/* ── Resumen por categoría ── */}
      <PageCard>
        <SectionTitle>Resumen por categoría</SectionTitle>
        <DataTable
          columns={[
            {key:"name",    label:"Categoría"},
            {key:"ingreso", label:"Ingresos", align:"right"},
            {key:"gasto",   label:"Gastos",   align:"right"},
            {key:"neto",    label:"Neto",     align:"right"},
          ]}
          rows={catSummary.map(r=>({
            _key: r.key,
            name:    <span className="text-slate-700">{r.name}</span>,
            ingreso: <span className="font-medium text-green-700">${fmtMoney(r.ingreso)}</span>,
            gasto:   <span className="font-medium text-red-600">${fmtMoney(r.gasto)}</span>,
            neto:    <span className={`font-semibold ${r.neto>=0?"text-green-700":"text-red-600"}`}>${fmtMoney(r.neto)}</span>,
          }))}
          emptyMsg="Sin datos para el período seleccionado."
        />
      </PageCard>

      {/* ── Gráficas por botella ── */}
      <div className="mb-4">
        <button type="button" onClick={()=>setViewByBottle(v=>!v)}
          className="rounded-xl px-4 py-2 text-sm font-medium transition hover:-translate-y-0.5"
          style={{background:C.tile,color:C.tileText,border:`1px solid ${C.borderMd}`,boxShadow:"0 2px 8px rgba(0,0,0,0.15)"}}>
          {viewByBottle?"Ocultar gráficas por botella":"Ver gráficas por botella"}
        </button>
      </div>

      {viewByBottle&&bottleIds.map(bid=>{
        const bottleEntries=filteredEntries.filter(en=>en.bottleId===bid);
        const {ig:bIg,combinado:bComb}=construirSeries(bottleEntries,range,chartBuckets);
        return (
          <div key={bid}>
            <div className="mb-2 mt-2 text-sm font-semibold" style={{color:C.tileText,opacity:0.85}}>
              {bottleNames[bid]||bid}
            </div>
            <ChartCard title={`${bottleNames[bid]||bid} — Ingreso vs Gasto`}>
              <TimeSeriesChart data={bIg} lines={["ingreso","gasto"]} colorByKey={{ingreso:"#16a34a",gasto:"#dc2626"}} />
            </ChartCard>
            <ChartCard title={`${bottleNames[bid]||bid} — Neto`}>
              <TimeSeriesChart data={bComb} lines={["neto"]} colorByKey={{neto:"#2563eb"}} />
            </ChartCard>
          </div>
        );
      })}

    </div>
  );
}
