// src/components/BackToOrgSelector.jsx
import { Link } from "react-router-dom";

export default function BackToOrgSelector({ className = "" }) {
  return (
    <Link
      to="/home" // <- pantalla central de selección de organización
      className={
        "inline-flex items-center gap-2 rounded-2xl px-4 py-2 " +
        "bg-white text-[#3b241b] border border-white shadow-sm " +
        "hover:bg-white/90 " + className
      }
      title="Cambiar organización"
    >
      <span>⇦</span>
      <span>Cambiar organización</span>
    </Link>
  );
}
