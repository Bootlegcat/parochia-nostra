// src/components/BackToHome.jsx
import { Link, useParams } from "react-router-dom";

export default function BackToHome({ className = "", to }) {
  const { orgId } = useParams();
  // Destino por defecto según contexto
  const href = to ?? (orgId ? `/org/${orgId}/home` : "/organizaciones");

  return (
    <Link
      to={href}
      className={
        "inline-flex items-center gap-2 rounded-2xl px-4 py-2 " +
        "bg-white text-[#3b241b] border border-white shadow-sm " +
        "hover:bg-white/90 " + className
      }
      title="Volver al inicio"
      aria-label="Volver al inicio"
    >
      <span aria-hidden>←</span>
      <span>Volver al inicio</span>
    </Link>
  );
}
