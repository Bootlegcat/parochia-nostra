// src/pages/SpecialOrgs.jsx
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
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

const SPECIALS = [
  { orgId: "iglesia", bottleId: "de-la-iglesia", label: "Iglesia" },
  { orgId: "construyendo-lazos", bottleId: "construyendo-lazos", label: "Construyendo Lazos" },
];

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

function Tile({ to, children }) {
  return (
    <Link
      to={to}
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
        className="text-3xl md:text-[38px] font-semibold leading-tight tracking-wide text-center"
        style={{ fontFamily: '"Cinzel", Georgia, serif' }}
      >
        {children}
      </div>
    </Link>
  );
}

function SubTile({ to, children }) {
  return (
    <Link
      to={to}
      className="
        group flex items-center justify-center text-center
        h-16 md:h-18 rounded-[18px] px-6
        shadow-[0_8px_18px_rgba(0,0,0,0.22)]
        ring-1 ring-black/15 hover:shadow-[0_12px_22px_rgba(0,0,0,0.28)]
        hover:-translate-y-0.5 transition
      "
      style={{ background: COLORS.tile, color: COLORS.tileText }}
    >
      <div
        className="text-lg md:text-xl font-semibold tracking-wide"
        style={{ fontFamily: '"Cinzel", Georgia, serif' }}
      >
        {children}
      </div>
    </Link>
  );
}

export default function SpecialOrgs() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState([]); // list of orgId
  const membersOrgId = allowed[0] || "iglesia";

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
      const results = [];
      for (const s of SPECIALS) {
        const mRef = doc(db, "botellas", s.bottleId, "members", user.uid);
        const snap = await getDoc(mRef);
        if (snap.exists()) results.push(s.orgId);
      }
      if (alive) setAllowed(results);
    })();
    return () => {
      alive = false;
    };
  }, [user?.uid]);

  if (!user && !loading) return <Navigate to="/" replace />;
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: COLORS.page, color: "#fff" }}>
        Cargando…
      </div>
    );

  if (!allowed.length) {
    return (
      <div className="min-h-screen p-4 md:p-6" style={{ background: COLORS.page }}>
        <div
          className="
            relative mx-auto w-[96vw] max-w-[1200px]
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

          <div className="relative px-8 md:px-12 pt-10 md:pt-12 pb-20 text-center">
            <div className="flex justify-center mb-6 md:mb-10">
              <img
                src={CREST_URL}
                alt="Escudo Parochia Nostra"
                className="w-[220px] h-[220px] md:w-[320px] md:h-[320px] object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.35)]"
              />
            </div>
            <div className="text-2xl mb-4" style={{ fontFamily: '"Cinzel", Georgia, serif', color: COLORS.tileText }}>
              Sin acceso a organizaciones especiales
            </div>
            <div className="text-sm mb-8" style={{ color: COLORS.tileText }}>
              No tienes permisos para Iglesia o Construyendo Lazos.
            </div>
            <Link
              to="/organizaciones"
              className="inline-flex rounded-xl border border-[#d3b187]/40 px-4 py-2 text-sm hover:bg-[#5b3a2d]"
              style={{ color: COLORS.tileText }}
            >
              Volver a inicio
            </Link>
          </div>
        </div>
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
            {SPECIALS.filter((s) => allowed.includes(s.orgId)).map((s) => (
              <Tile key={s.orgId} to={`/org/${s.orgId}/home`}>
                {s.label}
              </Tile>
            ))}
          </div>

          <div className="flex justify-center mt-2 md:mt-4 pb-4">
            <div className="w-full md:w-1/3 flex justify-center">
              <div className="w-2/3">
                <SubTile to={`/org/${membersOrgId}/members`}>Miembros</SubTile>
              </div>
            </div>
          </div>

          <Link
            to="/organizaciones"
            className="absolute left-4 bottom-3 text-white font-medium text-sm underline-offset-4 hover:underline transition"
            title="Regresar a inicio"
          >
            Volver a inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
