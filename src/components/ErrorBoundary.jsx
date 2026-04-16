// src/components/ErrorBoundary.jsx
import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#3b241b",
          padding: "24px",
        }}
      >
        <div
          style={{
            background: "#4b2d22",
            border: "1px solid rgba(211,177,135,0.35)",
            borderRadius: "16px",
            padding: "36px 40px",
            maxWidth: "480px",
            width: "100%",
            textAlign: "center",
            boxShadow: "0 8px 40px rgba(0,0,0,0.4)",
          }}
        >
          <h1
            style={{
              fontFamily: '"Cinzel", Georgia, serif',
              color: "#d3b187",
              fontSize: "22px",
              fontWeight: "700",
              margin: "0 0 12px",
            }}
          >
            Algo salió mal
          </h1>
          <p
            style={{
              color: "rgba(255,255,255,0.6)",
              fontSize: "14px",
              margin: "0 0 28px",
              lineHeight: "1.5",
            }}
          >
            Ocurrió un error inesperado en esta sección. Puedes recargar la página o volver al dashboard.
          </p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "#d3b187",
                color: "#3b241b",
                border: "none",
                borderRadius: "10px",
                padding: "10px 24px",
                fontSize: "14px",
                fontWeight: "600",
                cursor: "pointer",
                fontFamily: '"Cinzel", Georgia, serif',
              }}
            >
              Recargar
            </button>
            <a
              href="/dashboard"
              style={{
                border: "1px solid rgba(211,177,135,0.35)",
                background: "transparent",
                color: "#d3b187",
                borderRadius: "10px",
                padding: "10px 24px",
                fontSize: "14px",
                textDecoration: "none",
                fontFamily: '"Cinzel", Georgia, serif',
              }}
            >
              Ir al Dashboard
            </a>
          </div>
        </div>
      </div>
    );
  }
}
