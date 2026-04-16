// src/pages/Home.jsx
import { Link, Navigate, useParams } from "react-router-dom";
import { useEffect, useMemo } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
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

const BOTTLE_BY_ORG = {
  iglesia: "de-la-iglesia",
  "construyendo-lazos": "construyendo-lazos",
};

const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

function getCatalogCacheKey(bottleId) {
  return `catalogCache:${bottleId}`;
}

function readCatalogCache(bottleId) {
  try {
    const raw = localStorage.getItem(getCatalogCacheKey(bottleId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.at) return null;
    if (Date.now() - parsed.at > CATALOG_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCatalogCache(bottleId, data) {
  try {
    localStorage.setItem(getCatalogCacheKey(bottleId), JSON.stringify({ ...data, at: Date.now() }));
  } catch {
    // ignore
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const res = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }).map(async () => {
    while (idx < items.length) {
      const cur = idx++;
      res[cur] = await fn(items[cur], cur);
    }
  });
  await Promise.all(workers);
  return res;
}

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
        h-40 md:h-52 rounded-[28px] px-8
        shadow-[0_10px_24px_rgba(0,0,0,0.25)]
        ring-1 ring-black/15 hover:shadow-[0_14px_28px_rgba(0,0,0,0.3)]
        hover:-translate-y-0.5 transition
      "
      style={{ background: COLORS.tile, color: COLORS.tileText }}
    >
      <div
        className="text-2xl md:text-3xl font-semibold leading-tight tracking-wide text-center"
        style={{ fontFamily: '"Cinzel", Georgia, serif' }}
      >
        {children}
      </div>
    </Link>
  );
}

// ✅ Botón discreto (para "Miembros"), sin cambiar el look general
function SubTile({ to, children }) {
  return (
    <Link
      to={to}
      className="
        flex items-center justify-center text-center
        h-16 rounded-[20px]
        shadow-[0_4px_10px_rgba(0,0,0,0.25)]
        ring-1 ring-black/10
        hover:shadow-[0_6px_14px_rgba(0,0,0,0.3)]
        transition
      "
      style={{ background: COLORS.tile, color: COLORS.tileText }}
    >
      <div
        className="text-base md:text-lg font-medium tracking-wide"
        style={{ fontFamily: '"Cinzel", Georgia, serif' }}
      >
        {children}
      </div>
    </Link>
  );
}

export default function Home() {
  const { orgId } = useParams(); // "iglesia" | "construyendo-lazos" | bottleId personal
  const bottleId = useMemo(() => (orgId ? BOTTLE_BY_ORG[orgId] || orgId : ""), [orgId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!bottleId) return;
      const cached = readCatalogCache(bottleId);
      if (cached) return;

      try {
        const [catsSnap, bankSnap] = await Promise.all([
          getDocs(query(collection(db, "botellas", bottleId, "categories"), orderBy("name"))),
          getDocs(query(collection(db, "botellas", bottleId, "bankAccounts"), orderBy("name"))),
        ]);

        const cats = catsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const banks = bankSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        const subs = [];
        const cons = [];

        await mapWithConcurrency(cats, 6, async (c) => {
          let subsSnap;
          try {
            subsSnap = await getDocs(
              query(collection(db, "botellas", bottleId, "categories", c.id, "subcategories"), orderBy("name"))
            );
          } catch {
            subsSnap = await getDocs(collection(db, "botellas", bottleId, "categories", c.id, "subcategories"));
          }
          const subsHere = subsSnap.docs.map((d) => ({ id: d.id, categoryId: c.id, ...d.data() }));
          subs.push(...subsHere);
        });

        await mapWithConcurrency(subs, 6, async (s) => {
          let consSnap;
          try {
            consSnap = await getDocs(
              query(
                collection(db, "botellas", bottleId, "categories", s.categoryId, "subcategories", s.id, "concepts"),
                orderBy("name")
              )
            );
          } catch {
            consSnap = await getDocs(
              collection(db, "botellas", bottleId, "categories", s.categoryId, "subcategories", s.id, "concepts")
            );
          }
          cons.push(
            ...consSnap.docs.map((d) => ({
              id: d.id,
              categoryId: s.categoryId,
              subCategoryId: s.id,
              ...d.data(),
            }))
          );
        });

        if (!alive) return;
        writeCatalogCache(bottleId, { cats, subs, cons, banks });
      } catch {
        // ignore preload errors
      }
    })();
    return () => {
      alive = false;
    };
  }, [bottleId]);

  // ✅ Si no hay orgId, manda al selector central
  if (!orgId) return <Navigate to="/organizaciones" replace />;

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: COLORS.page }}>
      <div
        className="
          relative mx-auto w-full
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
        {/* Cenefas */}
        <CornerImg className="absolute top-4 left-4" />
        <CornerImg className="absolute top-4 right-4 scale-x-[-1]" />
        <CornerImg className="absolute bottom-4 left-4 scale-y-[-1]" />
        <CornerImg className="absolute bottom-4 right-4 scale-x-[-1] scale-y-[-1]" />

        {/* Contenido */}
        <div className="relative px-8 md:px-14 pt-8 md:pt-12 pb-20">
          {/* Escudo */}
          <div className="flex justify-center mb-4 md:mb-8">
            <img
              src={CREST_URL}
              alt="Escudo Parochia Nostra"
              className="w-[160px] h-[160px] md:w-[220px] md:h-[220px] object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.35)]"
            />
          </div>

          {/* Botones grandes — EXACTAMENTE igual */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 pb-6">
            <Tile to={`/org/${orgId}/entries`}>
              <span className="block">
                Ingresos &amp; <br className="hidden md:block" />
                Gastos
              </span>
            </Tile>

            <Tile to={`/org/${orgId}/events`}>Eventos</Tile>

            <Tile to={`/org/${orgId}/analytics`}>Análisis</Tile>
          </div>

          <div className="pb-12" />

          {/* Volver al Dashboard */}
          <Link
            to="/dashboard"
            className="
              absolute left-4 bottom-3
              inline-flex items-center justify-center
              rounded-2xl px-4 py-2 text-sm font-semibold
              shadow-[0_8px_18px_rgba(0,0,0,0.25)]
              ring-1 ring-black/15 hover:shadow-[0_12px_22px_rgba(0,0,0,0.3)]
              hover:-translate-y-0.5 transition
            "
            style={{ background: "#4b2d22", color: "#d3b187" }}
            title="Dashboard"
          >
            ← Dashboard
          </Link>

        </div>
      </div>
    </div>
  );
}
