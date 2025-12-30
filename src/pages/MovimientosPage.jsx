import { useEffect, useState } from "react";
import { fetchMovimientos } from "../services/movimientos";

export default function MovimientosPage() {
  const botellaId = "de-la-iglesia"; // por ahora fijo
  const [tipo, setTipo] = useState(null);
  const [cuenta, setCuenta] = useState(null);
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);

  async function load(reset = false) {
    const res = await fetchMovimientos({
      botellaId,
      tipo,
      cuenta,
      pageSize: 50,
      cursor: reset ? null : cursor,
    });

    setItems(prev => reset ? res.items : [...prev, ...res.items]);
    setCursor(res.nextCursor);
  }

  useEffect(() => {
    load(true);
    // eslint-disable-next-line
  }, [tipo, cuenta]);

  return (
    <div style={{ padding: 16 }}>
      <h2>Movimientos</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <select onChange={(e)=>setTipo(e.target.value || null)}>
          <option value="">Todos</option>
          <option value="ingreso">Ingresos</option>
          <option value="egreso">Egresos</option>
        </select>

        <select onChange={(e)=>setCuenta(e.target.value || null)}>
          <option value="">Todas las cuentas</option>
          <option value="BANORTE 8686">BANORTE 8686</option>
          <option value="BANORTE 4074">BANORTE 4074</option>
          <option value="AFIRME 874">AFIRME 874</option>
        </select>
      </div>

      <ul>
        {items.map(m => (
          <li key={m.id} style={{ marginBottom: 10 }}>
            <div><b>{m.tipo}</b> — ${m.monto}</div>
            <div>{m.categoria} / {m.subcategoria} / {m.concepto}</div>
            <div>{m.cuentaBancaria} — {m.formaPago}</div>
          </li>
        ))}
      </ul>

      <button disabled={!cursor} onClick={()=>load(false)}>
        Cargar más
      </button>
    </div>
  );
}
