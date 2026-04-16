// src/components/OrgLayout.jsx
import { useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import Sidebar from "./Sidebar.jsx";

const CREST_URL = "/crest.png";

// Hamburger icon
function HamburgerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M3 5h14M3 10h14M3 15h14" stroke="#d3b187" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function OrgLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const nav = useNavigate();

  return (
    <div className="flex overflow-hidden" style={{ height: "100vh", width: "100vw", background: "#3b241b" }}>

      {/* Sidebar (desktop: always visible / mobile: overlay) */}
      <Sidebar
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />

      {/* Main content — independently scrollable */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* Mobile top bar */}
        <div
          className="md:hidden flex items-center gap-3 px-4 py-3 flex-shrink-0"
          style={{
            background: "#2a1610",
            borderBottom: "1px solid rgba(211,177,135,0.12)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          }}
        >
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="p-1 rounded-lg transition"
            style={{ color: "#d3b187" }}
            aria-label="Abrir menú"
          >
            <HamburgerIcon />
          </button>

          <button
            type="button"
            onClick={() => nav("/dashboard")}
            className="flex items-center gap-2"
          >
            <img src={CREST_URL} alt="" className="w-6 h-6 object-contain" />
            <span
              className="text-sm font-bold tracking-wide"
              style={{ fontFamily: '"Cinzel", Georgia, serif', color: "#d3b187" }}
            >
              Parochia Nostra
            </span>
          </button>
        </div>

        {/* Page content — scrolls independently */}
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>

      </div>
    </div>
  );
}
