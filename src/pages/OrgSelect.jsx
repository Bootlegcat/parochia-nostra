// src/pages/OrgSelect.jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { useOrg } from "../context/OrgContext.jsx";
import { useToast } from "../components/Toast.jsx";

export default function OrgSelect() {
  const nav = useNavigate();
  const { setActive } = useOrg();
  const { showToast } = useToast();
  const [user, setUser] = useState(null);

  const [entryName, setEntryName] = useState("");
  const [bottleCount, setBottleCount] = useState(2);
  const [bottleNames, setBottleNames] = useState(["", ""]);
  const [busyCreate, setBusyCreate] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(getAuth(), (u) => {
      setUser(u || null);
    });
    return () => unsub();
  }, []);

  async function onCreateBottle() {
    if (!user?.uid) return;
    setBusyCreate(true);

    try {
      const entryRef = await addDoc(collection(db, "entradas"), {
        name: entryName.trim() || "Nueva entrada",
        createdAt: serverTimestamp(),
      });

      const entryId = entryRef.id;
      const count = Math.max(1, Math.min(6, Number(bottleCount) || 2));
      const names = Array.from({ length: count }).map((_, i) => {
        const n = bottleNames[i]?.trim();
        return n || `Botella ${i + 1}`;
      });

      const createdIds = [];
      for (let i = 0; i < count; i++) {
        const bRef = await addDoc(collection(db, "botellas"), {
          name: names[i],
          entryId,
          entryName: entryName.trim() || "Nueva entrada",
          ownerUid: user.uid,
          kind: "entry",
          createdAt: serverTimestamp(),
        });

        await setDoc(doc(db, "botellas", bRef.id, "members", user.uid), {
          role: "admin",
          email: user.email || "",
          createdAt: serverTimestamp(),
          createdBy: user.uid,
        });

        createdIds.push(bRef.id);
      }

      await setDoc(
        doc(db, "users", user.uid),
        {
          defaultBottleId: createdIds[0],
          bottleIds: arrayUnion(...createdIds),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );

      setActive({
        bottleId: createdIds[0],
        orgId: createdIds[0],
        bottleName: names[0],
        entryId,
        entryName: entryName.trim() || "Nueva entrada",
        entryBottles: createdIds.map((id, i) => ({ id, orgId: id, name: names[i] })),
      });
      nav(`/org/${createdIds[0]}/home`);
    } catch (e) {
      showToast(e?.message || String(e), "error");
    } finally {
      setBusyCreate(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-8">
      <h1
        className="text-3xl font-bold mb-6"
        style={{ fontFamily: '"Cinzel", Georgia, serif', color: '#d3b187' }}
      >
        Crear entrada
      </h1>

      <div
        className="rounded-2xl bg-white p-5 mb-4"
        style={{ border: '1px solid rgba(59,36,27,0.10)', boxShadow: '0 2px 16px rgba(59,36,27,0.07)' }}
      >
        <div className="flex items-center gap-2 mb-4">
          <span className="w-1 h-4 rounded-full" style={{ background: '#d3b187' }} />
          <span className="text-xs font-bold tracking-widest uppercase text-slate-600">Nueva entrada</span>
        </div>

        <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">
          Nombre de la entrada
        </label>
        <input
          className="w-full rounded-xl border px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
          placeholder="Ej. Parroquia San José"
          value={entryName}
          onChange={(e) => setEntryName(e.target.value)}
        />

        <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">
          Número de botellas
        </label>
        <select
          className="w-full rounded-xl border px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
          value={bottleCount}
          onChange={(e) => {
            const n = Number(e.target.value);
            setBottleCount(n);
            setBottleNames((prev) => {
              const next = [...prev];
              while (next.length < n) next.push("");
              return next.slice(0, n);
            });
          }}
        >
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>

        <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">
          Nombres de botellas
        </label>
        <div className="grid gap-2 mb-4">
          {Array.from({ length: bottleCount }).map((_, i) => (
            <input
              key={i}
              className="w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-300 transition"
              placeholder={`Botella ${i + 1}`}
              value={bottleNames[i] || ""}
              onChange={(e) => {
                const v = e.target.value;
                setBottleNames((prev) => { const next = [...prev]; next[i] = v; return next; });
              }}
            />
          ))}
        </div>

        <div className="flex justify-end">
          <button
            className="rounded-xl px-5 py-2.5 text-sm font-semibold transition hover:-translate-y-0.5 disabled:opacity-50"
            style={{ background: '#4b2d22', color: '#d3b187', border: '1px solid rgba(211,177,135,0.35)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}
            onClick={onCreateBottle}
            disabled={busyCreate}
          >
            {busyCreate ? "Creando…" : "Crear entrada"}
          </button>
        </div>
      </div>
    </div>
  );
}
