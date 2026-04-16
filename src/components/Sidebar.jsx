// src/components/Sidebar.jsx
import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useOrg } from "../context/OrgContext.jsx";

const CREST_URL = "/crest.png";

const S = {
  bg: "#1e110a",
  header: "#2a1610",
  gold: "#d3b187",
  goldDim: "rgba(211,177,135,0.5)",
  goldFaint: "rgba(211,177,135,0.12)",
  border: "rgba(211,177,135,0.12)",
  active: "rgba(211,177,135,0.15)",
  activeBorder: "#d3b187",
};

// ─── Chevron icon ─────────────────────────────────────────────────────────────

function Chevron({ open }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 11 11"
      fill="none"
      style={{
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 0.2s ease",
        flexShrink: 0,
      }}
    >
      <path
        d="M3.5 2L7.5 5.5L3.5 9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Accordion wrapper ────────────────────────────────────────────────────────

function Dropdown({ label, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 transition"
        style={{ color: S.goldDim }}
        onMouseEnter={(e) => (e.currentTarget.style.color = S.gold)}
        onMouseLeave={(e) => (e.currentTarget.style.color = S.goldDim)}
      >
        <span
          className="text-[10px] font-bold tracking-[0.15em] uppercase"
          style={{ fontFamily: '"Cinzel", Georgia, serif' }}
        >
          {label}
        </span>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="pb-1">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Nav item ─────────────────────────────────────────────────────────────────

function NavItem({ label, to, isActive, onClick }) {
  const nav = useNavigate();

  function handleClick() {
    if (onClick) { onClick(); return; }
    nav(to);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full flex items-center gap-3 px-4 py-2 text-left transition"
      style={{
        background: isActive ? S.active : "transparent",
        borderLeft: isActive ? `2px solid ${S.activeBorder}` : "2px solid transparent",
        color: isActive ? S.gold : S.goldDim,
        paddingLeft: isActive ? "14px" : "16px",
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = S.goldFaint;
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = "transparent";
      }}
    >
      <span
        className="text-sm font-medium truncate"
        style={{ fontFamily: '"Cinzel", Georgia, serif' }}
      >
        {label}
      </span>
    </button>
  );
}

// ─── Divider ──────────────────────────────────────────────────────────────────

function Divider() {
  return <div className="mx-4 my-2" style={{ height: "1px", background: S.border }} />;
}

// ─── Main sidebar ─────────────────────────────────────────────────────────────

export default function Sidebar({ mobileOpen, onClose }) {
  const nav = useNavigate();
  const loc = useLocation();
  const { active } = useOrg();
  const onDashboard = loc.pathname === "/dashboard";

  // Bottles to show — fall back to just the active bottle if entryBottles missing
  const entryBottles =
    active?.entryBottles?.length
      ? active.entryBottles
      : active?.bottleId
      ? [{ id: active.bottleId, orgId: active.orgId, name: active.bottleName }]
      : [];

  function isOrgActive(orgId) {
    return loc.pathname.startsWith(`/org/${orgId}/`);
  }

  function isExactPath(path) {
    return loc.pathname === path;
  }

  function goToDashboard() {
    if (onDashboard) return;
    if (onClose) onClose();
    nav("/dashboard");
  }

  const entryId = active?.entryId;
  const membersOrgId = active?.orgId;

  // ── Sidebar inner content (shared between desktop + mobile) ───────────────
  const content = (
    <div className="flex flex-col h-full" style={{ background: S.bg }}>

      {/* Logo */}
      <button
        type="button"
        onClick={goToDashboard}
        className="flex flex-col items-center gap-1.5 py-6 px-4 transition"
        style={{ borderBottom: `1px solid ${S.border}`, cursor: onDashboard ? "default" : "pointer" }}
        title={onDashboard ? "Dashboard" : "Volver al Dashboard"}
      >
        <img
          src={CREST_URL}
          alt="Parochia Nostra"
          className="w-12 h-12 object-contain transition"
          style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.4))", opacity: 0.9 }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.9")}
        />
        <span
          className="text-xs font-bold tracking-wide text-center leading-tight"
          style={{ fontFamily: '"Cinzel", Georgia, serif', color: S.gold }}
        >
          Parochia Nostra
        </span>
        <span
          className="text-[9px] text-center leading-tight px-2 truncate w-full"
          style={{ color: active?.entryName ? S.goldDim : "rgba(211,177,135,0.2)" }}
        >
          {active?.entryName || "Ninguna entrada seleccionada"}
        </span>
      </button>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 space-y-1">

        {/* Dropdown 1: Botellas */}
        {entryBottles.length > 0 && (
          <>
            <Dropdown label="Botellas" defaultOpen={true}>
              {entryBottles.map((b) => (
                <NavItem
                  key={b.id}
                  label={b.name}
                  to={`/org/${b.orgId}/home`}
                  isActive={isOrgActive(b.orgId)}
                  onClick={() => {
                    if (onClose) onClose();
                    nav(`/org/${b.orgId}/home`);
                  }}
                />
              ))}
            </Dropdown>
            <Divider />
          </>
        )}

        {/* Dropdown 2: General */}
        <Dropdown label="General" defaultOpen={true}>
          {membersOrgId && (
            <NavItem
              label="Miembros"
              to={`/org/${membersOrgId}/members`}
              isActive={isExactPath(`/org/${membersOrgId}/members`)}
              onClick={() => {
                if (onClose) onClose();
                nav(`/org/${membersOrgId}/members`);
              }}
            />
          )}
          {entryId && (
            <NavItem
              label="Análisis General"
              to={`/entry/${entryId}/analytics`}
              isActive={isExactPath(`/entry/${entryId}/analytics`)}
              onClick={() => {
                if (onClose) onClose();
                nav(`/entry/${entryId}/analytics`);
              }}
            />
          )}
          <Divider />
          <NavItem
            label="Crear entrada"
            to="/organizaciones"
            isActive={false}
            onClick={() => {
              if (onClose) onClose();
              nav("/organizaciones");
            }}
          />
          <NavItem
            label="Unirse a entrada"
            to="/unirse"
            isActive={false}
            onClick={() => {
              if (onClose) onClose();
              nav("/unirse");
            }}
          />
          <NavItem
            label="Mi perfil"
            to="/profile"
            isActive={isExactPath("/profile")}
            onClick={() => {
              if (onClose) onClose();
              nav("/profile");
            }}
          />
        </Dropdown>

      </nav>

      {/* Footer */}
      <div
        className="px-4 py-3 text-[9px] text-center"
        style={{ color: "rgba(211,177,135,0.25)", borderTop: `1px solid ${S.border}` }}
      >
        Parochia Nostra © {new Date().getFullYear()}
      </div>
    </div>
  );

  return (
    <>
      {/* ── Desktop sidebar ── */}
      <aside
        className="hidden md:flex flex-col w-[260px] flex-shrink-0 overflow-y-auto"
        style={{ height: "100vh", borderRight: `1px solid ${S.border}` }}
      >
        {content}
      </aside>

      {/* ── Mobile overlay ── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.6)" }}
            onClick={onClose}
          />
          {/* Drawer */}
          <aside
            className="relative w-[260px] h-full flex flex-col overflow-hidden"
            style={{ borderRight: `1px solid ${S.border}` }}
          >
            {content}
          </aside>
        </div>
      )}
    </>
  );
}
