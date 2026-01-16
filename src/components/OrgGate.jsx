// src/components/OrgGate.jsx
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { db, auth } from "../firebase";

const SPECIAL_BOTTLE_BY_ORG = {
  iglesia: "de-la-iglesia",
  "construyendo-lazos": "construyendo-lazos",
};

export default function OrgGate({ children }) {
  const { orgId } = useParams();
  const nav = useNavigate();
  const loc = useLocation();

  const [checking, setChecking] = useState(true);
  const [uid, setUid] = useState("");

  // ✅ Auth estable (evita que pase sin checar membership al refrescar)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUid(u?.uid || "");
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        // si todavía no hay uid (auth aún cargando), seguimos en "checking"
        if (!orgId || !uid) {
          if (alive) setChecking(true);
          return;
        }

        const specialBottleId = SPECIAL_BOTTLE_BY_ORG[orgId];

        // ✅ Si NO es org especial, asumimos que orgId = bottleId personal → permitir
        if (!specialBottleId) {
          if (alive) setChecking(false);
          return;
        }

        // ✅ Es org especial: revisar membership
        const memberRef = doc(db, "botellas", specialBottleId, "members", uid);
        const memberSnap = await getDoc(memberRef);

        if (memberSnap.exists()) {
          if (alive) setChecking(false);
          return;
        }

        // ❌ No invitado → mandar a botella personal (defaultBottleId)
        const userRef = doc(db, "users", uid);
        const userSnap = await getDoc(userRef);
        const personalBottleId = userSnap.exists() ? userSnap.data()?.defaultBottleId : null;

        if (!personalBottleId) {
          nav("/organizaciones", { replace: true });
          return;
        }

        // conservar ruta: /org/:orgId/...  →  /org/:personalBottleId/...
        const newPath = loc.pathname.replace(`/org/${orgId}/`, `/org/${personalBottleId}/`);
        nav(`${newPath}${loc.search}${loc.hash}`, { replace: true });
      } catch (e) {
        console.error("OrgGate error:", e);
        // si falla, al menos no bloquees infinito
        if (alive) setChecking(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [uid, orgId, nav, loc.pathname, loc.search, loc.hash]);

  if (checking) return <p className="text-center mt-10">Cargando...</p>;
  return children;
}
