// src/pages/Dashboard.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, collection, getDocs, query, orderBy, limit } from "firebase/firestore";
import { db } from "../firebase";
import { useOrg } from "../context/OrgContext.jsx";
import { useToast } from "../components/Toast.jsx";

// ─── Constants ────────────────────────────────────────────────────────────────

const C = {
  page: "#3b241b",
  tile: "#4b2d22",
  gold: "#d3b187",
  border: "rgba(211,177,135,0.25)",
  card: "rgba(255,255,255,0.97)",
};

const SPECIAL_BOTTLES = ["de-la-iglesia", "construyendo-lazos"];
const SPECIAL_ENTRY_ID = "parroquia-nuestra-senora-de-guadalupe";
const SPECIAL_ENTRY_NAME = "Parroquia Nuestra Señora de Guadalupe";
const CREST_URL = "/crest.png";

// orgId used in URL may differ from bottleId in Firestore (special case: iglesia)
const BOTTLE_TO_ORG = { "de-la-iglesia": "iglesia" };
function getOrgId(bottleId) {
  return BOTTLE_TO_ORG[bottleId] || bottleId;
}

// Normalize a doc from either movimientos (legacy) or entries (new) into a consistent shape
function normDash(data, id, bottleId, bottleName) {
  const rawDate = data.fecha || data.date;
  const fecha = rawDate?.toDate ? rawDate.toDate() : (rawDate ? new Date(rawDate) : null);
  const monto = Number(data.monto ?? data.amount ?? 0);
  const rawTipo = String(data.tipo ?? data.type ?? "").toLowerCase();
  const isIngreso = rawTipo.includes("ing") || rawTipo.includes("inc");
  return {
    ...data,
    id,
    _bottleId: bottleId,
    _bottleName: bottleName,
    _fecha: fecha,
    monto,
    tipo: isIngreso ? "ingreso" : "egreso",
    categoria: data.categoria ?? data.category ?? "",
    concepto: data.concepto ?? data.concept ?? "",
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: C.gold }} />
      <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: "rgba(211,177,135,0.5)" }}>
        {children}
      </span>
    </div>
  );
}

function EntryCard({ entry, isActive, onEnter, onSelect }) {
  const fmt = (n) => `$${Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 0 })}`;
  const neto = (entry.ingresos || 0) - (entry.gastos || 0);

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3 transition"
      style={{
        background: isActive ? "rgba(211,177,135,0.08)" : "rgba(0,0,0,0.15)",
        border: isActive ? `1.5px solid rgba(211,177,135,0.5)` : `1px solid ${C.border}`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-sm font-bold truncate" style={{ fontFamily: '"Cinzel", Georgia, serif', color: C.gold }}>
              {entry.name}
            </div>
            {isActive && (
              <span
                className="text-[9px] font-semibold rounded-full px-2 py-0.5"
                style={{ background: 'rgba(211,177,135,0.15)', color: '#d3b187', border: '1px solid rgba(211,177,135,0.4)' }}
              >
                ✓ Activa
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {entry.bottles.map((b) => (
              <span
                key={b.id}
                className="rounded-full px-2 py-0.5 text-[9px] font-medium"
                style={{ background: "rgba(211,177,135,0.1)", color: "rgba(211,177,135,0.6)", border: `1px solid ${C.border}` }}
              >
                {b.name}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isActive && (
            <button
              onClick={() => onSelect(entry)}
              className="rounded-xl px-3 py-1.5 text-[11px] font-semibold transition hover:-translate-y-0.5"
              style={{ background: "rgba(211,177,135,0.1)", color: C.gold, border: `1px solid rgba(211,177,135,0.3)` }}
            >
              Seleccionar
            </button>
          )}
          <button
            onClick={() => onEnter(entry)}
            className="rounded-xl px-3 py-1.5 text-[11px] font-semibold transition hover:-translate-y-0.5"
            style={{ background: C.gold, color: C.page, boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}
          >
            Entrar →
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {[
          { label: "Ingresos", value: fmt(entry.ingresos), color: "#4ade80" },
          { label: "Gastos", value: fmt(entry.gastos), color: "#f87171" },
          { label: "Neto", value: fmt(neto), color: neto >= 0 ? "#4ade80" : "#f87171" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(0,0,0,0.2)" }}>
            <div className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: "rgba(211,177,135,0.4)" }}>{label}</div>
            <div className="text-xs font-bold" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const nav = useNavigate();
  const { active, setActive, clear } = useOrg();

  const { showToast } = useToast();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [installPrompt, setInstallPrompt] = useState(null);

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function handleInstall() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") setInstallPrompt(null);
  }
  const [entries, setEntries] = useState([]);
  const [recent, setRecent] = useState([]);
  const [memberCount, setMemberCount] = useState(null);
  const [prevStats, setPrevStats] = useState(null);

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(getAuth(), (u) => {
      setUser(u || null);
      if (!u) nav("/");
    });
    return () => unsub();
  }, [nav]);

  // ── Load entries + movimientos ────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    if (!user?.uid) return;

    (async () => {
      try {
        setLoading(true);

        // User's bottle IDs
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const userData = userSnap.exists() ? userSnap.data() : {};
        const baseIds = Array.isArray(userData.bottleIds) ? [...userData.bottleIds] : [];
        if (userData.defaultBottleId && !baseIds.includes(userData.defaultBottleId)) {
          baseIds.push(userData.defaultBottleId);
        }

        // Special access
        const specialAccess = [];
        for (const bid of SPECIAL_BOTTLES) {
          const mSnap = await getDoc(doc(db, "botellas", bid, "members", user.uid));
          if (mSnap.exists()) specialAccess.push(bid);
        }

        const allIds = Array.from(new Set([...baseIds, ...specialAccess]));
        if (!allIds.length) {
          if (alive) { setEntries([]); setLoading(false); }
          return;
        }

        // Bottle metadata
        const bottleMetas = await Promise.all(
          allIds.map(async (id) => {
            const snap = await getDoc(doc(db, "botellas", id));
            const d = snap.exists() ? snap.data() : {};
            const entryId = d.entryId || (SPECIAL_BOTTLES.includes(id) ? SPECIAL_ENTRY_ID : null);
            const entryName = d.entryName || (SPECIAL_BOTTLES.includes(id) ? SPECIAL_ENTRY_NAME : null);
            return { id, orgId: getOrgId(id), name: d.name || id, entryId, entryName };
          })
        );

        // Group by entry — skip orphan bottles (no entryId)
        const entryMap = new Map();
        bottleMetas.forEach((b) => {
          if (!b.entryId) return;
          if (!entryMap.has(b.entryId)) {
            entryMap.set(b.entryId, { id: b.entryId, name: b.entryName, bottles: [], ingresos: 0, gastos: 0 });
          }
          entryMap.get(b.entryId).bottles.push({ id: b.id, orgId: b.orgId, name: b.name });
        });

        // Current-month movimientos for stats + recent activity
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const allRecent = [];

        await Promise.all(
          bottleMetas.map(async (b) => {
            if (!b.entryId) return;
            const docs = [];

            // legacy movimientos
            try {
              const snap = await getDocs(
                query(collection(db, "botellas", b.id, "movimientos"), orderBy("fecha", "desc"), limit(100))
              );
              snap.docs.forEach((d) => docs.push(normDash(d.data(), d.id, b.id, b.name)));
            } catch {
              const snap = await getDocs(collection(db, "botellas", b.id, "movimientos"));
              snap.docs.forEach((d) => docs.push(normDash(d.data(), d.id, b.id, b.name)));
            }

            // new entries collection
            try {
              const snap = await getDocs(
                query(collection(db, "botellas", b.id, "entries"), orderBy("date", "desc"), limit(100))
              );
              snap.docs.forEach((d) => docs.push(normDash(d.data(), `e_${d.id}`, b.id, b.name)));
            } catch {
              const snap = await getDocs(collection(db, "botellas", b.id, "entries"));
              snap.docs.forEach((d) => docs.push(normDash(d.data(), `e_${d.id}`, b.id, b.name)));
            }

            docs.forEach((m) => {
              if (m._fecha && m._fecha >= monthStart) {
                const entry = entryMap.get(b.entryId);
                if (entry) {
                  if (m.tipo === "ingreso") entry.ingresos += m.monto;
                  else entry.gastos += m.monto;
                }
              }
              allRecent.push(m);
            });
          })
        );

        allRecent.sort((a, b) => (b._fecha || 0) - (a._fecha || 0));

        // Previous month comparison
        const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        let prevIngresos = 0, prevGastos = 0;
        allRecent.forEach((m) => {
          if (!m._fecha || m._fecha < prevMonthStart || m._fecha >= monthStart) return;
          if (String(m.tipo || "").toLowerCase().includes("ing")) prevIngresos += Number(m.monto || 0);
          else prevGastos += Number(m.monto || 0);
        });

        if (alive) {
          setEntries(Array.from(entryMap.values()));
          setRecent(allRecent.slice(0, 6));
          setPrevStats({ ingresos: prevIngresos, gastos: prevGastos });
          setLoading(false);
        }
      } catch (e) {
        if (alive) { showToast(e?.message || String(e), "error"); setLoading(false); }
      }
    })();

    return () => { alive = false; };
  }, [user?.uid]);

  const globalStats = useMemo(() => {
    const ingresos = entries.reduce((s, e) => s + (e.ingresos || 0), 0);
    const gastos = entries.reduce((s, e) => s + (e.gastos || 0), 0);
    return { ingresos, gastos, neto: ingresos - gastos };
  }, [entries]);

  // ── Member count ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active?.entryBottles?.length) return;
    let alive = true;
    (async () => {
      try {
        const uidSet = new Set();
        await Promise.all(
          active.entryBottles.map(async (b) => {
            const snap = await getDocs(collection(db, "botellas", b.id, "members"));
            snap.docs.forEach((d) => uidSet.add(d.id));
          })
        );
        if (alive) setMemberCount(uidSet.size);
      } catch {
        // silently ignore
      }
    })();
    return () => { alive = false; };
  }, [active?.entryBottles]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Refresh stale context ─────────────────────────────────────────────────
  useEffect(() => {
    if (!entries.length || !active?.entryId) return;
    const match = entries.find((e) => e.id === active.entryId);
    if (!match) return;
    if (
      !active.entryBottles?.length ||
      active.entryBottles.length !== match.bottles.length
    ) {
      const firstBottle = match.bottles[0];
      if (!firstBottle) return;
      setActive({
        bottleId: firstBottle.id,
        orgId: firstBottle.orgId,
        bottleName: firstBottle.name,
        entryId: match.id,
        entryName: match.name,
        entryBottles: match.bottles,
      });
    }
  }, [entries, active?.entryId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────────
  function selectEntry(entry) {
    const firstBottle = entry.bottles[0];
    if (!firstBottle) return;
    setActive({
      bottleId: firstBottle.id,
      orgId: firstBottle.orgId,
      bottleName: firstBottle.name,
      entryId: entry.id,
      entryName: entry.name,
      entryBottles: entry.bottles,
    });
  }

  function enterEntry(entry) {
    const firstBottle = entry.bottles[0];
    if (!firstBottle) return;
    setActive({
      bottleId: firstBottle.id,
      orgId: firstBottle.orgId,
      bottleName: firstBottle.name,
      entryId: entry.id,
      entryName: entry.name,
      entryBottles: entry.bottles,
    });
    nav(`/org/${firstBottle.orgId}/home`);
  }

  async function handleSignOut() {
    await signOut(getAuth());
    nav("/");
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (!user || (loading && entries.length === 0)) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.page }}>
        <div className="rounded-2xl px-8 py-5 text-sm font-medium" style={{ background: C.tile, color: C.gold, border: `1px solid ${C.border}` }}>
          Cargando…
        </div>
      </div>
    );
  }

  const fmt = (n) => `$${Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 0 })}`;
  const monthLabel = new Date().toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  const hasActive = !!active?.orgId;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: C.page }}>

      {/* ── Top bar ── */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between px-4 md:px-8 py-3"
        style={{ background: C.tile, borderBottom: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}
      >
        <div className="flex items-center gap-3">
          <img src={CREST_URL} alt="Parochia Nostra" className="w-8 h-8 object-contain" />
          <span className="text-sm font-bold tracking-wide" style={{ fontFamily: '"Cinzel", Georgia, serif', color: C.gold }}>
            Parochia Nostra
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs hidden md:block" style={{ color: "rgba(211,177,135,0.4)" }}>{user.email}</span>
          <button
            onClick={handleSignOut}
            className="rounded-xl px-3 py-1.5 text-xs font-medium transition hover:opacity-80"
            style={{ background: "rgba(211,177,135,0.1)", color: C.gold, border: `1px solid ${C.border}` }}
          >
            Cerrar sesión
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 md:px-6 py-8 space-y-8">

        {/* ── Page title + global stats ── */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold" style={{ fontFamily: '"Cinzel", Georgia, serif', color: C.gold }}>
              Dashboard
            </h1>
            <p className="text-xs mt-1 capitalize" style={{ color: "rgba(211,177,135,0.45)" }}>
              {monthLabel}
            </p>
          </div>
          {/* Supporting stats — small, not the hero */}
          {entries.length > 0 && (
            <div className="flex gap-3 text-right">
              {[
                { label: "Ingresos", value: fmt(globalStats.ingresos), color: "#4ade80" },
                { label: "Gastos", value: fmt(globalStats.gastos), color: "#f87171" },
                { label: "Neto", value: fmt(globalStats.neto), color: globalStats.neto >= 0 ? "#4ade80" : "#f87171" },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-xl px-3 py-2" style={{ background: "rgba(211,177,135,0.06)", border: `1px solid ${C.border}` }}>
                  <div className="text-[9px] uppercase tracking-wide" style={{ color: "rgba(211,177,135,0.4)" }}>{label}</div>
                  <div className="text-sm font-bold" style={{ color }}>{value}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Install banner ── */}
        {installPrompt && (
          <div
            className="rounded-2xl px-5 py-4 flex items-center justify-between gap-3"
            style={{ background: C.tile, border: `1px solid rgba(211,177,135,0.35)`, boxShadow: "0 4px 16px rgba(0,0,0,0.22)" }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <img src={CREST_URL} alt="" className="w-8 h-8 object-contain flex-shrink-0 opacity-80" />
              <div className="min-w-0">
                <div className="text-sm font-semibold" style={{ color: C.gold }}>Instalar Parochia Nostra</div>
                <div className="text-xs" style={{ color: "rgba(211,177,135,0.5)" }}>Accede rápido desde tu pantalla de inicio</div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setInstallPrompt(null)}
                className="rounded-xl px-3 py-1.5 text-xs font-medium transition hover:opacity-70"
                style={{ color: "rgba(211,177,135,0.4)" }}
              >
                Ahora no
              </button>
              <button
                onClick={handleInstall}
                className="rounded-xl px-4 py-2 text-xs font-semibold transition hover:-translate-y-0.5"
                style={{ background: C.gold, color: C.page, boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}
              >
                Instalar
              </button>
            </div>
          </div>
        )}

        {/* ── Last visited banner ── */}
        {hasActive && (
          <div
            className="rounded-2xl px-5 py-4 flex items-center justify-between gap-3"
            style={{ background: C.tile, border: `1px solid ${C.border}`, boxShadow: "0 4px 16px rgba(0,0,0,0.22)" }}
          >
            <div>
              <div className="text-[10px] uppercase tracking-widest font-semibold mb-0.5" style={{ color: "rgba(211,177,135,0.45)" }}>
                Última entrada visitada
              </div>
              <div className="text-sm font-bold" style={{ fontFamily: '"Cinzel", Georgia, serif', color: C.gold }}>
                {active.bottleName}
              </div>
              {active.entryName && active.entryName !== active.bottleName && (
                <div className="text-xs" style={{ color: "rgba(211,177,135,0.45)" }}>{active.entryName}</div>
              )}
            </div>
            <button
              onClick={() => nav(`/org/${active.orgId}/home`)}
              className="flex-shrink-0 rounded-xl px-4 py-2 text-xs font-semibold transition hover:-translate-y-0.5"
              style={{ background: C.gold, color: C.page, boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}
            >
              Ir al inicio →
            </button>
          </div>
        )}

        {/* ── Mis Entradas ── */}
        {entries.length > 0 && (
          <div>
            <SectionLabel>Mis entradas — mes actual</SectionLabel>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {entries.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  isActive={active?.entryId === entry.id}
                  onEnter={enterEntry}
                  onSelect={selectEntry}
                />
              ))}
            </div>
          </div>
        )}

        {entries.length === 0 && !loading && (
          <div className="rounded-2xl p-8 text-center text-sm" style={{ background: C.card, border: "1px solid rgba(59,36,27,0.10)", color: "#94a3b8" }}>
            No tienes entradas aún.
          </div>
        )}

        {/* ── Member count ── */}
        {active?.entryId && memberCount !== null && (
          <div
            className="rounded-2xl p-4 flex items-center justify-between gap-3"
            style={{ background: C.card, border: '1px solid rgba(59,36,27,0.10)', boxShadow: '0 2px 12px rgba(59,36,27,0.06)' }}
          >
            <div>
              <div className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'rgba(211,177,135,0.45)' }}>Miembros activos</div>
              <div className="text-2xl font-bold mt-0.5" style={{ fontFamily: '"Cinzel", Georgia, serif', color: C.gold }}>
                {memberCount}
              </div>
            </div>
            <span style={{ color: C.gold, fontSize: '1.5rem' }}>👥</span>
          </div>
        )}

        {/* ── Month comparison ── */}
        {active?.entryId && prevStats && (
          <div>
            <SectionLabel>vs mes anterior</SectionLabel>
            <div
              className="rounded-2xl p-4 grid grid-cols-2 gap-3"
              style={{ background: C.card, border: '1px solid rgba(59,36,27,0.10)', boxShadow: '0 2px 12px rgba(59,36,27,0.06)' }}
            >
              {[
                { label: 'Ingresos', curr: globalStats.ingresos, prev: prevStats.ingresos },
                { label: 'Gastos',   curr: globalStats.gastos,   prev: prevStats.gastos   },
              ].map(({ label, curr, prev }) => {
                const diff = curr - prev;
                const pct = prev > 0 ? Math.round((Math.abs(diff) / prev) * 100) : null;
                const up = diff >= 0;
                const isGood = label === 'Ingresos' ? up : !up;
                return (
                  <div key={label} className="rounded-xl px-3 py-2" style={{ background: 'rgba(0,0,0,0.03)' }}>
                    <div className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: 'rgba(59,36,27,0.4)' }}>{label}</div>
                    <div className="text-sm font-bold" style={{ color: isGood ? '#16a34a' : '#dc2626' }}>
                      {up ? '↑' : '↓'} {pct !== null ? `${pct}%` : fmt(Math.abs(diff))}
                    </div>
                    <div className="text-xs" style={{ color: 'rgba(59,36,27,0.5)' }}>
                      {fmt(curr)} este mes
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Recent activity ── */}
        {recent.length > 0 && (
          <div>
            <SectionLabel>Actividad reciente</SectionLabel>
            <div
              className="rounded-2xl overflow-hidden"
              style={{ background: C.card, border: "1px solid rgba(59,36,27,0.10)", boxShadow: "0 2px 12px rgba(59,36,27,0.06)" }}
            >
              <ul className="divide-y" style={{ borderColor: "rgba(59,36,27,0.06)" }}>
                {recent.map((m) => {
                  const isIngreso = String(m.tipo || "").toLowerCase().includes("ing");
                  const fecha = m._fecha
                    ? m._fecha.toLocaleDateString("es-MX", { day: "2-digit", month: "short" })
                    : "—";
                  return (
                    <li key={`${m._bottleId}-${m.id}`} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-amber-50/30 transition">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: isIngreso ? "#4ade80" : "#f87171" }} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-700 truncate">
                            {[m.categoria, m.concepto].filter(Boolean).join(" · ") || m.tipo || "Movimiento"}
                          </div>
                          <div className="text-xs text-slate-400 truncate">{m._bottleName}</div>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-sm font-semibold" style={{ color: isIngreso ? "#16a34a" : "#dc2626" }}>
                          {isIngreso ? "+" : "−"}${Number(m.monto || 0).toLocaleString("es-MX")}
                        </div>
                        <div className="text-xs text-slate-400">{fecha}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}


      </div>
    </div>
  );
}
