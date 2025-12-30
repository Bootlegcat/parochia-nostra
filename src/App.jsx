// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";

import OrgSelect from "./pages/OrgSelect.jsx";
import Home from "./pages/Home.jsx";
import Entries from "./pages/Entries.jsx";
import Events from "./pages/Events.jsx";
import Analytics from "./pages/Analytics.jsx";
import Members from "./pages/Members.jsx";

// ✅ NUEVO (lo migrado)
import MovimientosPage from "./pages/MovimientosPage.jsx";

/** Redirecciona rutas viejas (sin orgId) al selector de organización */
function RedirectToOrgSelect() {
  return <Navigate to="/organizaciones" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Públicas */}
        <Route path="/" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Selector de organización */}
        <Route
          path="/organizaciones"
          element={
            <ProtectedRoute>
              <OrgSelect />
            </ProtectedRoute>
          }
        />

        {/* Home por organización */}
        <Route
          path="/org/:orgId/home"
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        />

        {/* Módulos */}
        <Route
          path="/org/:orgId/entries"
          element={
            <ProtectedRoute>
              <Entries />
            </ProtectedRoute>
          }
        />
        <Route
          path="/org/:orgId/events"
          element={
            <ProtectedRoute>
              <Events />
            </ProtectedRoute>
          }
        />
        <Route
          path="/org/:orgId/analytics"
          element={
            <ProtectedRoute>
              <Analytics />
            </ProtectedRoute>
          }
        />

        {/* ✅ NUEVO: Miembros */}
        <Route
          path="/org/:orgId/members"
          element={
            <ProtectedRoute>
              <Members />
            </ProtectedRoute>
          }
        />

        {/* ✅ NUEVO: Movimientos migrados */}
        <Route
          path="/org/:orgId/movimientos"
          element={
            <ProtectedRoute>
              <MovimientosPage />
            </ProtectedRoute>
          }
        />

        {/* Compatibilidad hacia atrás */}
        <Route
          path="/home"
          element={
            <ProtectedRoute>
              <RedirectToOrgSelect />
            </ProtectedRoute>
          }
        />
        <Route
          path="/entries"
          element={
            <ProtectedRoute>
              <RedirectToOrgSelect />
            </ProtectedRoute>
          }
        />
        <Route
          path="/events"
          element={
            <ProtectedRoute>
              <RedirectToOrgSelect />
            </ProtectedRoute>
          }
        />
        <Route
          path="/analytics"
          element={
            <ProtectedRoute>
              <RedirectToOrgSelect />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <RedirectToOrgSelect />
            </ProtectedRoute>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/organizaciones" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
