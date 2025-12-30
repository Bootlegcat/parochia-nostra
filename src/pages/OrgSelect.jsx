// src/pages/OrgSelect.jsx
import { Link } from "react-router-dom";

export default function OrgSelect() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#3b241b] p-6">
      <div className="grid gap-6 w-full max-w-3xl md:grid-cols-2">
        <Link
          to="/org/iglesia/home"
          className="rounded-3xl bg-[#4b2d22] text-[#d3b187] p-10 text-center text-2xl"
          style={{ fontFamily: '"Cinzel", Georgia, serif' }}
        >
          Iglesia
        </Link>
        <Link
          to="/org/construyendo-lazos/home"
          className="rounded-3xl bg-[#4b2d22] text-[#d3b187] p-10 text-center text-2xl"
          style={{ fontFamily: '"Cinzel", Georgia, serif' }}
        >
          Construyendo Lazos
        </Link>
      </div>
    </div>
  );
}
