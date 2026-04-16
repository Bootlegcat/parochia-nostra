import { useEffect } from "react";
import { auth } from "../firebase";
import { signInWithEmailAndPassword, onAuthStateChanged } from "firebase/auth";
import { useNavigate, Link } from "react-router-dom";
import { useState } from "react";
import { useToast } from "../components/Toast.jsx";

const CREST_URL = "/crest.png";
const C = { page: "#3b241b", tile: "#4b2d22", tileText: "#d3b187", border: "rgba(211,177,135,0.3)" };

function Login() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy]         = useState(false);
  const { showToast } = useToast();
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate("/dashboard");
    } catch {
      showToast("Correo o contraseña incorrectos.", "error");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => { if (user) navigate("/dashboard"); });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: C.page }}>
      <div className="w-full max-w-md">
        {/* Escudo */}
        <div className="flex justify-center mb-6">
          <img src={CREST_URL} alt="Parochia Nostra" className="w-28 h-28 object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.4)]" />
        </div>

        {/* Card */}
        <div className="rounded-3xl p-8" style={{ background: C.tile, border: `1px solid ${C.border}`, boxShadow: "0 8px 40px rgba(0,0,0,0.35)" }}>
          <h1 className="text-2xl font-bold text-center mb-1" style={{ fontFamily: '"Cinzel", Georgia, serif', color: C.tileText }}>
            Iniciar sesión
          </h1>
          <p className="text-center text-xs mb-6" style={{ color: "rgba(211,177,135,0.6)" }}>Parochia Nostra</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-wide" style={{ color: "rgba(211,177,135,0.7)" }}>Correo</label>
              <input
                type="email"
                placeholder="correo@ejemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-sm bg-white border-0 focus:outline-none focus:ring-2 focus:ring-amber-400"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-wide" style={{ color: "rgba(211,177,135,0.7)" }}>Contraseña</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-sm bg-white border-0 focus:outline-none focus:ring-2 focus:ring-amber-400"
                required
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl py-2.5 text-sm font-semibold transition hover:-translate-y-0.5 disabled:opacity-50"
              style={{ background: C.tileText, color: C.page, boxShadow: "0 4px 14px rgba(0,0,0,0.2)" }}
            >
              {busy ? "Entrando…" : "Entrar"}
            </button>
          </form>

          <p className="text-center text-xs mt-5" style={{ color: "rgba(211,177,135,0.6)" }}>
            ¿No tienes cuenta?{" "}
            <Link to="/register" className="underline underline-offset-2" style={{ color: C.tileText }}>
              Regístrate
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;
