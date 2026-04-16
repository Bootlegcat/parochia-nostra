// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { OrgProvider } from "./context/OrgContext.jsx";
import { ToastProvider } from "./components/Toast.jsx";
import { ConfirmProvider } from "./components/ConfirmModal.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";

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
import EntryAnalytics from "./pages/EntryAnalytics.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Profile from "./pages/Profile.jsx";
import OrgLayout from "./components/OrgLayout.jsx";

function RedirectToOrgSelect() {
  return <Navigate to="/organizaciones" replace />;
}

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <OrgProvider>
          <BrowserRouter>
            <Routes>
              {/* Públicas */}
              <Route path="/" element={<Login />} />
              <Route path="/register" element={<Register />} />

              <Route
                path="/especiales"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary><SpecialOrgs /></ErrorBoundary>
                  </ProtectedRoute>
                }
              />

              {/* Alias: /org directo → selector */}
              <Route
                path="/org"
                element={
                  <ProtectedRoute>
                    <RedirectToOrgSelect />
                  </ProtectedRoute>
                }
              />

              {/* ── Layout con sidebar ── */}
              <Route
                element={
                  <ProtectedRoute>
                    <OrgLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="/dashboard"              element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
                <Route path="/organizaciones"         element={<ErrorBoundary><OrgSelect /></ErrorBoundary>} />
                <Route path="/unirse"                 element={<ErrorBoundary><JoinBottle /></ErrorBoundary>} />
                <Route path="/profile"                element={<ErrorBoundary><Profile /></ErrorBoundary>} />
                <Route path="/org/:orgId/home"        element={<OrgGate><ErrorBoundary><Home /></ErrorBoundary></OrgGate>} />
                <Route path="/org/:orgId/entries"     element={<OrgGate><ErrorBoundary><Entries /></ErrorBoundary></OrgGate>} />
                <Route path="/org/:orgId/events"      element={<OrgGate><ErrorBoundary><Events /></ErrorBoundary></OrgGate>} />
                <Route path="/org/:orgId/analytics"   element={<OrgGate><ErrorBoundary><Analytics /></ErrorBoundary></OrgGate>} />
                <Route path="/org/:orgId/members"     element={<OrgGate><ErrorBoundary><Members /></ErrorBoundary></OrgGate>} />
                <Route path="/org/:orgId/movimientos" element={<OrgGate><ErrorBoundary><MovimientosPage /></ErrorBoundary></OrgGate>} />
                <Route path="/entry/:entryId/analytics" element={<ErrorBoundary><EntryAnalytics /></ErrorBoundary>} />
              </Route>

              {/* Compatibilidad hacia atrás */}
              <Route path="/home"      element={<ProtectedRoute><RedirectToOrgSelect /></ProtectedRoute>} />
              <Route path="/entries"   element={<ProtectedRoute><RedirectToOrgSelect /></ProtectedRoute>} />
              <Route path="/events"    element={<ProtectedRoute><RedirectToOrgSelect /></ProtectedRoute>} />
              <Route path="/analytics" element={<ProtectedRoute><RedirectToOrgSelect /></ProtectedRoute>} />

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </BrowserRouter>
        </OrgProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
