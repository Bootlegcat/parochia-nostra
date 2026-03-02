// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import OrgGate from "./components/OrgGate.jsx";

import OrgSelect from "./pages/OrgSelect.jsx";
import SpecialOrgs from "./pages/SpecialOrgs.jsx";
import JoinBottle from "./pages/JoinBottle.jsx";
import Home from "./pages/Home.jsx";
import Entries from "./pages/Entries.jsx";
import Events from "./pages/Events.jsx";
import Analytics from "./pages/Analytics.jsx";
import Members from "./pages/Members.jsx";
import MovimientosPage from "./pages/MovimientosPage.jsx";

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

        <Route
          path="/especiales"
          element={
            <ProtectedRoute>
              <SpecialOrgs />
            </ProtectedRoute>
          }
        />

        <Route
          path="/unirse"
          element={
            <ProtectedRoute>
              <JoinBottle />
            </ProtectedRoute>
          }
        />

        {/* ✅ Alias: si alguien entra a /org directo, mándalo al selector */}
        <Route
          path="/org"
          element={
            <ProtectedRoute>
              <RedirectToOrgSelect />
            </ProtectedRoute>
          }
        />

        {/* Home por organización */}
        <Route
          path="/org/:orgId/home"
          element={
            <ProtectedRoute>
              <OrgGate>
                <Home />
              </OrgGate>
            </ProtectedRoute>
          }
        />

        {/* Módulos */}
        <Route
          path="/org/:orgId/entries"
          element={
            <ProtectedRoute>
              <OrgGate>
                <Entries />
              </OrgGate>
            </ProtectedRoute>
          }
        />
        <Route
          path="/org/:orgId/events"
          element={
            <ProtectedRoute>
              <OrgGate>
                <Events />
              </OrgGate>
            </ProtectedRoute>
          }
        />
        <Route
          path="/org/:orgId/analytics"
          element={
            <ProtectedRoute>
              <OrgGate>
                <Analytics />
              </OrgGate>
            </ProtectedRoute>
          }
        />

        {/* Miembros */}
        <Route
          path="/org/:orgId/members"
          element={
            <ProtectedRoute>
              <OrgGate>
                <Members />
              </OrgGate>
            </ProtectedRoute>
          }
        />

        {/* Movimientos migrados */}
        <Route
          path="/org/:orgId/movimientos"
          element={
            <ProtectedRoute>
              <OrgGate>
                <MovimientosPage />
              </OrgGate>
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
