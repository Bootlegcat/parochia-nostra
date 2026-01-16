// src/pages/MovimientosPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { fetchMovimientos } from "../services/movimientos";
import BackToHome from "../components/BackToHome";

const BOTTLE_ID_BY_ORG = {
  iglesia: "de-la-iglesia",
  "construyendo-lazos": "construyendo-lazos",
};

export default function MovimientosPage() {
  const { orgId } = useParams();

  // ✅ mapping si existe, si no usar orgId como bottleId (botella personal)
  const botellaId = useMemo(() => {
    if (!orgId) return "";
    return BOTTLE_ID_BY_ORG[orgId] || orgId;
  }, [orgId]);

  const [tipo, setTipo] = useState(null);
  const [cuenta, setCuenta] = useState(null);
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);

  async function load(reset = false) {
    if (!botellaId) return;

    const res = await fetchMovimientos({
      botellaId,
      tipo,
      cuenta,
      pageSize: 50,
      cursor: reset ? null : cursor,
    });

    setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
    setCursor(res.nextCursor);
  }

  useEffect(() => {
    // ✅ limpiar lista al cambiar filtros o botella
    setItems([]);
    setCursor(null);
    load(true);
    // eslint-disable-next-line
  }, [tipo, cuenta, botellaId]);

  // guards (compat con tu flujo actual)
  if (!orgId) return <Navigate to="/organizaciones" replace />;
  if (!botellaId) return <Navigate to="/organizaciones" replace />;

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl md:text-3xl font-semibold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]">
          Movimientos
        </h1>
        <BackToHome />
      </div>

      <div className="rounded-2xl border bg-white p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Tipo</label>
            <select
              className="w-full rounded-xl border px-3 py-2"
              value={tipo || ""}
              onChange={(e) => setTipo(e.target.value || null)}
            >
              <option value="">Todos</option>
              <option value="ingreso">Ingresos</option>
              <option value="egreso">Egresos</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">Cuenta</label>
            <select
              className="w-full rounded-xl border px-3 py-2"
              value={cuenta || ""}
              onChange={(e) => setCuenta(e.target.value || null)}
            >
              <option value="">Todas las cuentas</option>
              <option value="BANORTE 8686">BANORTE 8686</option>
              <option value="BANORTE 4074">BANORTE 4074</option>
              <option value="AFIRME 874">AFIRME 874</option>
            </select>
          </div>
        </div>

        <div className="text-xs text-slate-500 mt-3">
          Botella: <span className="font-mono">{botellaId}</span>
        </div>
      </div>

      <div className="rounded-2xl border bg-white">
        <div className="px-4 py-3 border-b text-sm text-slate-500">Lista</div>

        <ul className="divide-y">
          {items.map((m) => (
            <li key={m.id} className="px-4 py-3">
              <div className="text-sm">
                <b>{m.tipo}</b> — ${Number(m.monto || 0).toLocaleString("es-MX")}
              </div>
              <div className="text-xs text-slate-600">
                {m.categoria} / {m.subcategoria} / {m.concepto}
              </div>
              <div className="text-xs text-slate-500">
                {m.cuentaBancaria} — {m.formaPago}
              </div>
            </li>
          ))}

          {items.length === 0 && (
            <li className="px-4 py-6 text-sm text-slate-500">No hay movimientos.</li>
          )}
        </ul>

        <div className="p-4 flex justify-end">
          <button
            className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
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
