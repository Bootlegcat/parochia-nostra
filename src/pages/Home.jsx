// src/pages/Home.jsx
import { Link, Navigate, useParams } from "react-router-dom";
import { getAuth, signOut } from "firebase/auth";

// Rutas públicas (archivos en /public)
const CREST_URL = "/crest.png";
const BG_URL = "/parchment.jpg";
const CORNER_URL = "/corner-ornate.png";

const COLORS = {
  page: "#3b241b",
  tile: "#4b2d22",
  tileText: "#d3b187",
};

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
  const auth = getAuth();
  const { orgId } = useParams(); // "iglesia" | "construyendo-lazos" | bottleId personal

  async function onLogout() {
    try {
      await signOut(auth);
    } catch (e) {
      alert(e?.message || String(e));
    }
  }

  // ✅ Si no hay orgId, manda al selector central
  if (!orgId) return <Navigate to="/organizaciones" replace />;

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
        {/* Cenefas */}
        <CornerImg className="absolute top-4 left-4" />
        <CornerImg className="absolute top-4 right-4 scale-x-[-1]" />
        <CornerImg className="absolute bottom-4 left-4 scale-y-[-1]" />
        <CornerImg className="absolute bottom-4 right-4 scale-x-[-1] scale-y-[-1]" />

        {/* Contenido */}
        <div className="relative px-8 md:px-12 pt-10 md:pt-12 pb-20">
          {/* Escudo */}
          <div className="flex justify-center mb-6 md:mb-10">
            <img
              src={CREST_URL}
              alt="Escudo Parochia Nostra"
              className="w-[220px] h-[220px] md:w-[320px] md:h-[320px] object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.35)]"
            />
          </div>

          {/* Botones grandes — EXACTAMENTE igual */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-12 pb-6">
            <Tile to={`/org/${orgId}/entries`}>
              <span className="block">
                Ingresos &amp; <br className="hidden md:block" />
                Gastos
              </span>
            </Tile>

            <Tile to={`/org/${orgId}/events`}>Eventos</Tile>

            <Tile to={`/org/${orgId}/analytics`}>Análisis</Tile>
          </div>

          {/* Botón "Miembros" debajo de Eventos */}
          <div className="flex justify-center mt-2 md:mt-4 pb-12">
            <div className="w-full md:w-1/3 flex justify-center">
              <div className="w-2/3">
                <SubTile to={`/org/${orgId}/members`}>Miembros</SubTile>
              </div>
            </div>
          </div>

          {/* ✅ Cambiar organización (ahora al selector real) */}
          <Link
            to="/organizaciones"
            className="
              absolute left-4 bottom-3 text-white font-medium text-sm
              underline-offset-4 hover:underline transition
            "
            title="Regresar a selector"
          >
            Cambiar organización
          </Link>

          {/* Cerrar sesión */}
          <button
            onClick={onLogout}
            className="
              absolute right-4 bottom-3 text-white font-medium text-sm
              underline-offset-4 hover:underline transition
            "
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
