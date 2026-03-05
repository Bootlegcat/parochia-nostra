// src/pages/MovimientosPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { fetchMovimientos } from "../services/movimientos";
import BackToHome from "../components/BackToHome";

const BOTTLE_ID_BY_ORG = {
  iglesia: "de-la-iglesia",
  "construyendo-lazos": "construyendo-lazos",
};

const cardStyle = {
  background: "#fff",
  border: "1px solid rgba(59,36,27,0.10)",
  boxShadow: "0 2px 16px rgba(59,36,27,0.07)",
};

const labelCls = "block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5";
const inputCls = "w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-300 transition";

export default function MovimientosPage() {
  const { orgId } = useParams();
  const botellaId = useMemo(() => (orgId ? BOTTLE_ID_BY_ORG[orgId] || orgId : ""), [orgId]);

  const [tipo,   setTipo]   = useState(null);
  const [cuenta, setCuenta] = useState(null);
  const [items,  setItems]  = useState([]);
  const [cursor, setCursor] = useState(null);

  async function load(reset = false) {
    if (!botellaId) return;
    const res = await fetchMovimientos({ botellaId, tipo, cuenta, pageSize: 50, cursor: reset ? null : cursor });
    setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
    setCursor(res.nextCursor);
  }

  useEffect(() => {
    setItems([]); setCursor(null); load(true);
    // eslint-disable-next-line
  }, [tipo, cuenta, botellaId]);

  if (!orgId)     return <Navigate to="/organizaciones" replace />;
  if (!botellaId) return <Navigate to="/organizaciones" replace />;

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-6">
      {/* Encabezado */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl md:text-3xl font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]"
          style={{ fontFamily: '"Cinzel", Georgia, serif', color: "#d3b187" }}>
          Movimientos
        </h1>
        <BackToHome />
      </div>

      {/* Filtros */}
      <div className="rounded-2xl p-5 mb-5" style={cardStyle}>
        <div className="flex items-center gap-2 mb-4">
          <span className="w-1 h-5 rounded-full inline-block" style={{ background: "#d3b187" }} />
          <span className="text-xs font-semibold text-slate-600 tracking-wide uppercase">Filtros</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Tipo</label>
            <select className={inputCls} value={tipo || ""} onChange={(e) => setTipo(e.target.value || null)}>
              <option value="">Todos</option>
              <option value="ingreso">Ingresos</option>
              <option value="egreso">Egresos</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Cuenta</label>
            <select className={inputCls} value={cuenta || ""} onChange={(e) => setCuenta(e.target.value || null)}>
              <option value="">Todas las cuentas</option>
              <option value="BANORTE 8686">BANORTE 8686</option>
              <option value="BANORTE 4074">BANORTE 4074</option>
              <option value="AFIRME 874">AFIRME 874</option>
            </select>
          </div>
        </div>
        <div className="text-xs text-slate-400 mt-3">
          Botella: <span className="font-mono">{botellaId}</span>
        </div>
      </div>

      {/* Lista */}
      <div className="rounded-2xl overflow-hidden" style={cardStyle}>
        <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: "rgba(59,36,27,0.08)" }}>
          <span className="w-1 h-4 rounded-full inline-block" style={{ background: "#d3b187" }} />
          <span className="text-xs font-semibold text-slate-600 tracking-wide uppercase">Lista</span>
        </div>

        <ul className="divide-y" style={{ borderColor: "rgba(59,36,27,0.06)" }}>
          {items.map((m) => (
            <li key={m.id} className="px-5 py-3 hover:bg-amber-50/40 transition">
              <div className="text-sm font-medium text-slate-800">
                <span className={m.tipo?.toLowerCase().includes("ing") ? "text-green-700" : "text-red-600"}>
                  {m.tipo}
                </span>
                {" — "}
                <span className="font-semibold">${Number(m.monto || 0).toLocaleString("es-MX")}</span>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {[m.categoria, m.subcategoria, m.concepto].filter(Boolean).join(" · ")}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                {[m.cuentaBancaria, m.formaPago].filter(Boolean).join(" — ")}
              </div>
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-5 py-10 text-sm text-center text-slate-400">No hay movimientos.</li>
          )}
        </ul>

        <div className="p-4 flex justify-end border-t" style={{ borderColor: "rgba(59,36,27,0.08)" }}>
          <button
            className="rounded-xl px-4 py-2 text-sm font-medium transition hover:-translate-y-0.5 disabled:opacity-40"
            style={{ background: "#4b2d22", color: "#d3b187", border: "1px solid rgba(211,177,135,0.3)" }}
            disabled={!cursor}
            onClick={() => load(false)}
            type="button"
          >
            Cargar más
          </button>
        </div>
      </div>
    </div>
  );
}
