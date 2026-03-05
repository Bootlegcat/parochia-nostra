// src/pages/JoinBottle.jsx
import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, arrayUnion } from "firebase/firestore";
import { db } from "../firebase";

const CREST_URL = "/crest.png";
const C = { page: "#3b241b", tile: "#4b2d22", tileText: "#d3b187", border: "rgba(211,177,135,0.3)" };

function normEmail(s) { return String(s || "").trim().toLowerCase(); }

function parseInviteCode(raw) {
  const t = String(raw || "").trim();
  if (!t || !t.includes(":")) return { entryId: "", inviteId: "" };
  const [entryId, inviteId] = t.split(":").map((x) => x.trim());
  return { entryId: entryId || "", inviteId: inviteId || "" };
}

export default function JoinBottle() {
  const nav = useNavigate();
  const [user, setUser]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode]     = useState("");
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState("");
  const [ok, setOk]         = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(getAuth(), (u) => { setUser(u || null); setLoading(false); });
    return () => unsub();
  }, []);

  async function onJoin(e) {
    e.preventDefault();
    setError(""); setOk("");
    const parsed = parseInviteCode(code);
    if (!parsed.entryId || !parsed.inviteId) return setError("Código inválido. Usa formato: entradaId:inviteId");
    if (!user?.uid || !user?.email) return setError("No hay sesión activa con email.");

    try {
      setBusy(true);
      const inviteRef = doc(db, "entradas", parsed.entryId, "invites", parsed.inviteId);
      const invSnap = await getDoc(inviteRef);
      if (!invSnap.exists()) throw new Error("Ese código no existe.");
      const inv = invSnap.data() || {};
      if (inv.used === true) throw new Error("Este código ya fue usado.");
      if (normEmail(inv.email) !== normEmail(user.email)) throw new Error("Este código no es para tu correo.");
      const bottleIds = Array.isArray(inv.bottleIds) && inv.bottleIds.length ? inv.bottleIds : [];
      if (!bottleIds.length) throw new Error("Este código no tiene botellas asociadas.");

      for (const bid of bottleIds) {
        await setDoc(doc(db, "botellas", bid, "members", user.uid), {
          role: inv.role && ["viewer","editor","admin"].includes(inv.role) ? inv.role : "viewer",
          email: normEmail(user.email),
          inviteId: parsed.inviteId,
          entryId: parsed.entryId,
          entryInviteId: parsed.inviteId,
          createdAt: serverTimestamp(),
        }, { merge: true });
      }
      await updateDoc(inviteRef, { used: true });
      await setDoc(doc(db, "users", user.uid), { bottleIds: arrayUnion(...bottleIds) }, { merge: true });

      setOk("Acceso concedido. Redirigiendo…");
      setCode("");
      setTimeout(() => nav("/organizaciones"), 800);
    } catch (e2) {
      setError(e2?.message || String(e2));
    } finally {
      setBusy(false);
    }
  }

  if (!user && !loading) return <Navigate to="/" replace />;
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: C.page }}>
      <div className="rounded-2xl px-8 py-5 text-sm" style={{ background: C.tile, color: C.tileText, border: `1px solid ${C.border}` }}>Cargando…</div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: C.page }}>
      <div className="w-full max-w-lg">
        {/* Escudo */}
        <div className="flex justify-center mb-6">
          <img src={CREST_URL} alt="Parochia Nostra" className="w-24 h-24 object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.4)]" />
        </div>

        {/* Card */}
        <div className="rounded-3xl p-8" style={{ background: C.tile, border: `1px solid ${C.border}`, boxShadow: "0 8px 40px rgba(0,0,0,0.35)" }}>
          <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: '"Cinzel", Georgia, serif', color: C.tileText }}>
            Unirse a una entrada
          </h1>
          <p className="text-xs mb-6" style={{ color: "rgba(211,177,135,0.6)" }}>
            Pega el código que te dio el administrador en formato <b style={{ color: C.tileText }}>entradaId:inviteId</b>
          </p>

          <form onSubmit={onJoin} className="flex flex-col md:flex-row gap-3">
            <input
              className="flex-1 rounded-xl px-3 py-2.5 text-sm bg-white border-0 focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="entradaId:inviteId"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              className="rounded-xl px-5 py-2.5 text-sm font-semibold transition hover:-translate-y-0.5 disabled:opacity-50"
              style={{ background: C.tileText, color: C.page, boxShadow: "0 4px 14px rgba(0,0,0,0.2)" }}
              disabled={busy}
            >
              {busy ? "Validando…" : "Unirme"}
            </button>
          </form>

          {error && (
            <div className="mt-4 rounded-xl px-3 py-2 text-sm" style={{ background: "rgba(239,68,68,0.15)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.3)" }}>
              {error}
            </div>
          )}
          {ok && (
            <div className="mt-4 rounded-xl px-3 py-2 text-sm" style={{ background: "rgba(74,222,128,0.15)", color: "#86efac", border: "1px solid rgba(74,222,128,0.3)" }}>
              {ok}
            </div>
          )}

          <div className="mt-6">
            <button
              type="button"
              onClick={() => nav("/organizaciones")}
              className="text-xs underline underline-offset-4 transition"
              style={{ color: "rgba(211,177,135,0.6)" }}
            >
              ← Volver al inicio
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
