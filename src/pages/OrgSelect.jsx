// src/pages/OrgSelect.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase";

// Rutas públicas (archivos en /public)
const CREST_URL = "/crest.png";
const BG_URL = "/parchment.jpg";
const CORNER_URL = "/corner-ornate.png";

const COLORS = {
  page: "#3b241b",
  tile: "#4b2d22",
  tileText: "#d3b187",
};

const SPECIAL_BOTTLES = ["de-la-iglesia", "construyendo-lazos"];
const SPECIAL_ENTRY_ID = "parroquia-nuestra-senora-de-guadalupe";
const SPECIAL_ENTRY_NAME = "Parroquia Nuestra Señora de Guadalupe";

function CornerImg({ className = "" }) {
  return (
    <img
      src={CORNER_URL}
      alt=""
      draggable={false}
      className={
        "w-40 md:w-48 h-auto opacity-95 pointer-events-none select-none " + className
      }
    />
  );
}

function TileButton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="
        group flex items-center justify-center text-center
        h-56 md:h-64 rounded-[36px] px-10
        shadow-[0_10px_24px_rgba(0,0,0,0.25)]
        ring-1 ring-black/15 hover:shadow-[0_14px_28px_rgba(0,0,0,0.3)]
        hover:-translate-y-0.5 transition
      "
      style={{ background: COLORS.tile, color: COLORS.tileText }}
    >
      <div
        className="text-3xl md:text-[34px] font-semibold leading-tight tracking-wide text-center"
        style={{ fontFamily: '"Cinzel", Georgia, serif' }}
      >
        {children}
      </div>
    </button>
  );
}

export default function OrgSelect() {
  const nav = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const [bottles, setBottles] = useState([]); // {id, name, entryId, entryName}
  const [entries, setEntries] = useState([]); // {id, name}
  const [selectedEntryId, setSelectedEntryId] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [entryName, setEntryName] = useState("");
  const [bottleCount, setBottleCount] = useState(2);
  const [bottleNames, setBottleNames] = useState(["", ""]);
  const [busyCreate, setBusyCreate] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(getAuth(), (u) => {
      setUser(u || null);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!user?.uid) return;

      try {
        setError("");
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        const baseIds = userSnap.exists() ? userSnap.data()?.bottleIds || [] : [];

        const ids = [...baseIds];
        for (const bid of SPECIAL_BOTTLES) {
          const mRef = doc(db, "botellas", bid, "members", user.uid);
          const mSnap = await getDoc(mRef);
          if (mSnap.exists()) ids.push(bid);
        }

        const unique = Array.from(new Set(ids));
        const rows = await Promise.all(
          unique.map(async (id) => {
            const bSnap = await getDoc(doc(db, "botellas", id));
            const data = bSnap.exists() ? bSnap.data() : {};
            const name = data?.name || id;
            const entryId =
              data?.entryId ||
              (SPECIAL_BOTTLES.includes(id) ? SPECIAL_ENTRY_ID : "sin-entrada");
            const entryName =
              data?.entryName ||
              (SPECIAL_BOTTLES.includes(id) ? SPECIAL_ENTRY_NAME : "Sin entrada");
            return { id, name, entryId, entryName };
          })
        );

        if (alive) {
          setBottles(rows);
          const byEntry = new Map();
          rows.forEach((b) => {
            if (!byEntry.has(b.entryId)) {
              byEntry.set(b.entryId, { id: b.entryId, name: b.entryName });
            }
          });
          const entryList = Array.from(byEntry.values());
          setEntries(entryList);
          if (!selectedEntryId && entryList[0]?.id) setSelectedEntryId(entryList[0].id);
        }
      } catch (e) {
        if (alive) setError(e?.message || String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [user?.uid, selectedEntryId]);

  const bottleOptions = useMemo(() => {
    if (!selectedEntryId) return [];
    return bottles.filter((b) => b.entryId === selectedEntryId);
  }, [bottles, selectedEntryId]);

  async function onCreateBottle() {
    if (!user?.uid) return;
    setBusyCreate(true);
    setError("");

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

      nav(`/org/${createdIds[0]}/home`);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusyCreate(false);
    }
  }

  function onEnterBottle() {
    if (!selectedEntryId) return;
    if (selectedEntryId === SPECIAL_ENTRY_ID) {
      nav("/especiales");
      return;
    }
    const firstBottleId = bottleOptions[0]?.id;
    if (!firstBottleId) return;
    nav(`/org/${firstBottleId}/home`);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: COLORS.page, color: "#fff" }}>
        Cargando…
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: COLORS.page }}>
      <div
        className="
          relative mx-auto w-[96vw] max-w-[1500px]
          rounded-[28px] overflow-hidden
          border-[12px] shadow-[0_20px_80px_rgba(0,0,0,0.35)]
        "
        style={{
          borderColor: COLORS.page,
          backgroundImage: `url(${BG_URL})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <CornerImg className="absolute top-4 left-4" />
        <CornerImg className="absolute top-4 right-4 scale-x-[-1]" />
        <CornerImg className="absolute bottom-4 left-4 scale-y-[-1]" />
        <CornerImg className="absolute bottom-4 right-4 scale-x-[-1] scale-y-[-1]" />

        <div className="relative px-8 md:px-12 pt-10 md:pt-12 pb-20">
          <div className="flex justify-center mb-6 md:mb-10">
            <img
              src={CREST_URL}
              alt="Escudo Parochia Nostra"
              className="w-[220px] h-[220px] md:w-[320px] md:h-[320px] object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.35)]"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-12 pb-6">
            <TileButton onClick={() => setCreateOpen((v) => !v)}>
              {busyCreate ? "Creando…" : "Crear nueva entrada"}
            </TileButton>
            <TileButton onClick={() => nav("/unirse")}>Unirse a una botella</TileButton>
          </div>

          {createOpen && (
            <div className="rounded-2xl border bg-white/95 p-5 mb-8">
              <div className="text-lg font-semibold mb-3">Nueva entrada</div>

              <div className="text-sm mb-2 text-slate-600">Nombre de la entrada</div>
              <input
                className="w-full rounded-xl border px-3 py-2 mb-4"
                placeholder="Ej. Parroquia San José"
                value={entryName}
                onChange={(e) => setEntryName(e.target.value)}
              />

              <div className="text-sm mb-2 text-slate-600">Número de botellas</div>
              <select
                className="w-full rounded-xl border px-3 py-2 mb-4"
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
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>

              <div className="text-sm mb-2 text-slate-600">Nombres de botellas</div>
              <div className="grid gap-2">
                {Array.from({ length: bottleCount }).map((_, i) => (
                  <input
                    key={i}
                    className="w-full rounded-xl border px-3 py-2"
                    placeholder={`Botella ${i + 1}`}
                    value={bottleNames[i] || ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setBottleNames((prev) => {
                        const next = [...prev];
                        next[i] = v;
                        return next;
                      });
                    }}
                  />
                ))}
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  className="rounded-xl bg-black text-white px-4 py-2 disabled:opacity-50"
                  onClick={onCreateBottle}
                  disabled={busyCreate}
                >
                  {busyCreate ? "Creando…" : "Crear entrada"}
                </button>
              </div>
            </div>
          )}

          <div className="rounded-2xl border bg-white/95 p-5">
            <div className="text-lg font-semibold mb-3">Seleccionar entrada</div>
            <div className="flex flex-col md:flex-row gap-3">
              <select
                className="flex-1 rounded-xl border px-3 py-2"
                value={selectedEntryId}
                onChange={(e) => setSelectedEntryId(e.target.value)}
              >
                <option value="">Selecciona entrada…</option>
                {entries.map((en) => (
                  <option key={en.id} value={en.id}>
                    {en.name}
                  </option>
                ))}
              </select>
              <button
                className="rounded-xl bg-black text-white px-4 py-2 disabled:opacity-50"
                onClick={onEnterBottle}
                disabled={!selectedEntryId}
              >
                Entrar
              </button>
            </div>
            <div className="mt-4 text-sm text-slate-500">
              Solo aparecen entradas/botellas a las que tu usuario tiene acceso.
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-xl bg-red-50 border border-red-200 p-3 text-red-800">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
