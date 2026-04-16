// src/components/Toast.jsx
import { createContext, useCallback, useContext, useState } from "react";

const ToastContext = createContext(null);

let _toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = "info", duration = 3500) => {
    const id = ++_toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const STYLES = {
    success: { border: "#22c55e", icon: "✓", bg: "rgba(20,40,20,0.95)" },
    error:   { border: "#ef4444", icon: "✕", bg: "rgba(40,12,12,0.95)" },
    info:    { border: "#d3b187", icon: "ℹ", bg: "rgba(30,17,10,0.97)" },
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        style={{
          position: "fixed",
          top: "16px",
          right: "16px",
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => {
          const s = STYLES[t.type] || STYLES.info;
          return (
            <div
              key={t.id}
              onClick={() => dismiss(t.id)}
              style={{
                background: s.bg,
                border: `1px solid ${s.border}`,
                borderLeft: `3px solid ${s.border}`,
                borderRadius: "12px",
                padding: "10px 16px",
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
                maxWidth: "360px",
                pointerEvents: "auto",
                cursor: "pointer",
                backdropFilter: "blur(8px)",
                animation: "slideInRight 0.2s ease",
              }}
            >
              <span style={{ color: s.border, fontWeight: "bold", flexShrink: 0, marginTop: "1px", fontSize: "13px" }}>
                {s.icon}
              </span>
              <span style={{ color: "rgba(255,255,255,0.88)", fontSize: "13px", lineHeight: "1.45" }}>
                {t.message}
              </span>
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(40px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
