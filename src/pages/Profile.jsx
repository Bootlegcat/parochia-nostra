// src/pages/Profile.jsx
import { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged, updatePassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useToast } from "../components/Toast.jsx";

const C = {
  page: "#3b241b",
  tile: "#4b2d22",
  gold: "#d3b187",
  border: "rgba(211,177,135,0.25)",
};

function SectionLabel({ children }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: C.gold }} />
      <span
        className="text-[10px] font-bold tracking-widest uppercase"
        style={{ color: "rgba(211,177,135,0.5)", fontFamily: '"Cinzel", Georgia, serif' }}
      >
        {children}
      </span>
    </div>
  );
}

export default function Profile() {
  const { showToast } = useToast();

  const [user, setUser] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  // entradas: [{ entryId, entryName, bottles: [{ bottleId, bottleName, role }] }]
  const [entradas, setEntradas] = useState([]);
  const [loadingBottles, setLoadingBottles] = useState(true);

  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user?.uid) return;
    let alive = true;
    (async () => {
      try {
        setLoadingBottles(true);
        const uSnap = await getDoc(doc(db, "users", user.uid));
        const bottleIds = uSnap.exists() ? uSnap.data()?.bottleIds || [] : [];

        const rows = [];
        await Promise.all(
          bottleIds.map(async (bid) => {
            try {
              const [bSnap, mSnap] = await Promise.all([
                getDoc(doc(db, "botellas", bid)),
                getDoc(doc(db, "botellas", bid, "members", user.uid)),
              ]);
              const bData = bSnap.exists() ? bSnap.data() : {};
              const bottleName = bData?.name || bid;
              const entryId = bData?.entryId || "sin-entrada";
              const entryName = bData?.entryName || "Sin entrada";
              const role = mSnap.exists() ? mSnap.data()?.role || "viewer" : "viewer";
              rows.push({ bottleId: bid, bottleName, entryId, entryName, role });
            } catch {
              rows.push({ bottleId: bid, bottleName: bid, entryId: "sin-entrada", entryName: "Sin entrada", role: "viewer" });
            }
          })
        );

        // Group by entryId
        const map = new Map();
        for (const r of rows) {
          if (!map.has(r.entryId)) map.set(r.entryId, { entryId: r.entryId, entryName: r.entryName, bottles: [] });
          map.get(r.entryId).bottles.push({ bottleId: r.bottleId, bottleName: r.bottleName, role: r.role });
        }
        const grouped = Array.from(map.values()).sort((a, b) => a.entryName.localeCompare(b.entryName));
        for (const g of grouped) g.bottles.sort((a, b) => a.bottleName.localeCompare(b.bottleName));
        if (alive) setEntradas(grouped);
      } catch (e) {
        if (alive) showToast(e?.message || String(e), "error");
      } finally {
        if (alive) setLoadingBottles(false);
      }
    })();
    return () => { alive = false; };
  }, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleChangePassword(e) {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      return showToast("La contraseña debe tener al menos 6 caracteres.", "error");
    }
    if (!user) return showToast("No hay sesión activa.", "error");
    try {
      setPwBusy(true);
      await updatePassword(user, newPassword);
      showToast("Contraseña actualizada correctamente.", "success");
      setNewPassword("");
    } catch (e) {
      showToast(e?.message || String(e), "error");
    } finally {
      setPwBusy(false);
    }
  }

  function roleLabel(r) {
    if (r === "admin") return "Administrador";
    if (r === "editor") return "Editor";
    return "Lector";
  }

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-8 space-y-8">
      <h1
        className="text-3xl md:text-4xl font-bold"
        style={{ fontFamily: '"Cinzel", Georgia, serif', color: C.gold }}
      >
        Mi perfil
      </h1>

      {/* ── Mi cuenta ── */}
      <section
        className="rounded-2xl p-6"
        style={{ background: "rgba(255,255,255,0.97)", border: `1px solid rgba(59,36,27,0.10)`, boxShadow: "0 2px 16px rgba(59,36,27,0.07)" }}
      >
        <SectionLabel>Mi cuenta</SectionLabel>

        <div className="mb-5">
          <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Correo</label>
          <div className="rounded-xl border bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {user?.email || "—"}
          </div>
        </div>

        <form onSubmit={handleChangePassword} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
              Nueva contraseña
            </label>
            <input
              type="password"
              className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-300"
              placeholder="Mínimo 6 caracteres"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={pwBusy}
            className="rounded-xl px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 disabled:opacity-50"
            style={{ background: "#4b2d22", color: "#d3b187", border: "1px solid rgba(211,177,135,0.35)", boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}
          >
            {pwBusy ? "Guardando…" : "Cambiar contraseña"}
          </button>
        </form>
      </section>

      {/* ── Mis accesos ── */}
      <section
        className="rounded-2xl p-6"
        style={{ background: "rgba(255,255,255,0.97)", border: `1px solid rgba(59,36,27,0.10)`, boxShadow: "0 2px 16px rgba(59,36,27,0.07)" }}
      >
        <SectionLabel>Mis accesos</SectionLabel>

        {loadingBottles ? (
          <div className="text-sm text-slate-500">Cargando accesos…</div>
        ) : entradas.length === 0 ? (
          <div className="text-sm text-slate-500">No tienes acceso a ninguna entrada aún.</div>
        ) : (
          <div className="space-y-4">
            {entradas.map((entrada) => (
              <div key={entrada.entryId} className="rounded-xl border overflow-hidden" style={{ borderColor: "rgba(59,36,27,0.10)" }}>
                <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: "rgba(59,36,27,0.04)" }}>
                  <span className="w-1 h-3.5 rounded-full flex-shrink-0" style={{ background: C.gold }} />
                  <span className="text-xs font-bold tracking-wide uppercase text-slate-600">{entrada.entryName}</span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-t text-left" style={{ borderColor: "rgba(59,36,27,0.07)" }}>
                      <th className="py-2 px-4 text-xs uppercase tracking-wide text-slate-400">Botella</th>
                      <th className="py-2 px-4 text-xs uppercase tracking-wide text-slate-400 text-right">Rol</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entrada.bottles.map((b) => (
                      <tr key={b.bottleId} className="border-t" style={{ borderColor: "rgba(59,36,27,0.06)" }}>
                        <td className="py-2.5 px-4 font-medium text-slate-700">{b.bottleName}</td>
                        <td className="py-2.5 px-4 text-right">
                          <span
                            className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                            style={{
                              background: b.role === "admin" ? "rgba(211,177,135,0.15)" : b.role === "editor" ? "rgba(34,197,94,0.1)" : "rgba(100,100,100,0.1)",
                              color: b.role === "admin" ? "#d3b187" : b.role === "editor" ? "#16a34a" : "#64748b",
                            }}
                          >
                            {roleLabel(b.role)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
