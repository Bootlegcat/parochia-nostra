// src/components/BackToOrgSelector.jsx
import { Link } from "react-router-dom";

export default function BackToOrgSelector({ className = "" }) {
  return (
    <Link
      to="/dashboard"
      className={"inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition hover:-translate-y-0.5 " + className}
      style={{
        background: "#fff",
        color: "#3b241b",
        border: "1px solid rgba(59,36,27,0.15)",
        boxShadow: "0 2px 8px rgba(59,36,27,0.12)",
      }}
      title="Dashboard"
    >
      <span style={{ fontSize: "0.9em" }}>←</span>
      <span>Dashboard</span>
    </Link>
  );
}
