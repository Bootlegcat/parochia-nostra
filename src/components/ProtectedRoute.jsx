import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase";
import { Navigate } from "react-router-dom";

// ✅ NUEVO
import { ensurePersonalBottle } from "../utils/ensurePersonalBottle";

export default function ProtectedRoute({ children }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);

      // ✅ NUEVO: crear botella personal si no existe
      if (u) {
        try {
          await ensurePersonalBottle(u.uid, u.email || "");
        } catch (err) {
          console.error("Error creando botella personal:", err);
        }
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#3b241b" }}>
      <div className="rounded-2xl px-8 py-5 text-sm font-medium" style={{ background: "#4b2d22", color: "#d3b187", border: "1px solid rgba(211,177,135,0.25)" }}>
        Cargando…
      </div>
    </div>
  );

  if (!user) {
    return <Navigate to="/register" />;
  }

  return children;
}
