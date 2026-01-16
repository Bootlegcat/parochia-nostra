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

  if (loading) return <p className="text-center mt-10">Cargando...</p>;

  if (!user) {
    return <Navigate to="/register" />;
  }

  return children;
}
