// src/pages/JoinBottle.jsx
import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, arrayUnion } from "firebase/firestore";
import { db } from "../firebase";

function normEmail(s) {
  return String(s || "").trim().toLowerCase();
}

function parseInviteCode(raw) {
  const t = String(raw || "").trim();
  if (!t) return { entryId: "", inviteId: "" };
  if (!t.includes(":")) return { entryId: "", inviteId: "" };
  const [entryId, inviteId] = t.split(":").map((x) => x.trim());
  return { entryId: entryId || "", inviteId: inviteId || "" };
}

export default function JoinBottle() {
  const nav = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(getAuth(), (u) => {
      setUser(u || null);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  async function onJoin(e) {
    e.preventDefault();
    setError("");
    setOk("");

    const parsed = parseInviteCode(code);
    if (!parsed.entryId || !parsed.inviteId) {
      return setError("Código inválido. Usa formato: entradaId:inviteId");
    }
    if (!user?.uid || !user?.email) return setError("No hay sesión activa con email.");

    try {
      setBusy(true);

      const inviteRef = doc(db, "entradas", parsed.entryId, "invites", parsed.inviteId);
      const invSnap = await getDoc(inviteRef);
      if (!invSnap.exists()) throw new Error("Ese código no existe.");
      const inv = invSnap.data() || {};

      if (inv.used === true) throw new Error("Este código ya fue usado.");
      if (normEmail(inv.email) !== normEmail(user.email)) {
        throw new Error("Este código no es para tu correo.");
      }

      const bottleIds = Array.isArray(inv.bottleIds) && inv.bottleIds.length ? inv.bottleIds : [];
      if (!bottleIds.length) throw new Error("Este código no tiene botellas asociadas.");

      for (const bid of bottleIds) {
        await setDoc(
          doc(db, "botellas", bid, "members", user.uid),
          {
            role: "viewer",
            email: normEmail(user.email),
            inviteId: parsed.inviteId,
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      await updateDoc(inviteRef, { used: true });

      await setDoc(
        doc(db, "users", user.uid),
        { bottleIds: arrayUnion(...bottleIds) },
        { merge: true }
      );

      setOk("✅ Te uniste a la entrada. Redirigiendo…");
      setCode("");
      setTimeout(() => {
        nav("/organizaciones");
      }, 600);
    } catch (e2) {
      setError(e2?.message || String(e2));
    } finally {
      setBusy(false);
    }
  }

  if (!user && !loading) return <Navigate to="/" replace />;
  if (loading) return <div className="min-h-screen flex items-center justify-center text-white">Cargando…</div>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#3b241b] p-6">
      <div className="w-full max-w-2xl rounded-3xl bg-[#4b2d22] text-[#d3b187] p-10">
        <div className="text-2xl mb-2" style={{ fontFamily: '"Cinzel", Georgia, serif' }}>
          Unirse a una entrada
        </div>
        <div className="text-sm text-[#d3b187]/80 mb-6">
          Pega el código que te dio el admin en formato <b>entradaId:inviteId</b>.
        </div>

        <form onSubmit={onJoin} className="flex flex-col md:flex-row gap-3">
          <input
            className="flex-1 rounded-xl border px-3 py-2 text-black"
            placeholder="entradaId:inviteId"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button
            className="rounded-xl bg-black text-white px-4 py-2 disabled:opacity-50"
            disabled={busy}
          >
            {busy ? "Validando…" : "Unirme"}
          </button>
        </form>

        {error && <div className="mt-4 text-sm text-red-200">{error}</div>}
        {ok && <div className="mt-4 text-sm text-green-200">{ok}</div>}

        <div className="mt-6">
          <button
            type="button"
            onClick={() => nav("/organizaciones")}
            className="text-sm underline underline-offset-4"
          >
            Volver a inicio
          </button>
        </div>
      </div>
    </div>
  );
}
