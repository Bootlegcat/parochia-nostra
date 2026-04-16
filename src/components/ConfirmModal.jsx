// src/components/ConfirmModal.jsx
import { createContext, useCallback, useContext, useRef, useState } from "react";

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null); // { message }
  const resolveRef = useRef(null);

  const confirm = useCallback((message) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ message });
    });
  }, []);

  function handleCancel() {
    setState(null);
    resolveRef.current?.(false);
  }

  function handleConfirm() {
    setState(null);
    resolveRef.current?.(true);
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9998,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.65)",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            style={{
              background: "#2a1610",
              border: "1px solid rgba(211,177,135,0.4)",
              borderRadius: "16px",
              padding: "28px 32px",
              maxWidth: "400px",
              width: "90%",
              boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
            }}
          >
            <h2
              style={{
                fontFamily: '"Cinzel", Georgia, serif',
                color: "#d3b187",
                fontSize: "17px",
                fontWeight: "700",
                margin: "0 0 12px",
              }}
            >
              Confirmar acción
            </h2>
            <p
              style={{
                color: "rgba(255,255,255,0.75)",
                fontSize: "14px",
                margin: "0 0 24px",
                lineHeight: "1.5",
              }}
            >
              {state.message}
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                onClick={handleCancel}
                style={{
                  border: "1px solid rgba(211,177,135,0.3)",
                  background: "transparent",
                  color: "rgba(211,177,135,0.7)",
                  borderRadius: "10px",
                  padding: "8px 20px",
                  fontSize: "13px",
                  cursor: "pointer",
                  fontFamily: '"Cinzel", Georgia, serif',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirm}
                style={{
                  background: "#dc2626",
                  border: "1px solid rgba(220,38,38,0.5)",
                  color: "white",
                  borderRadius: "10px",
                  padding: "8px 20px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                  fontFamily: '"Cinzel", Georgia, serif',
                }}
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx.confirm;
}
