import { useState, lazy, Suspense } from "react";

const AUTH_URL = import.meta.env.VITE_AUTH_URL || "https://952380306.propelauthtest.com";

function LoginPage() {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <div style={{ textAlign: "center", maxWidth: 400, padding: "0 24px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "#111", margin: "0 0 8px" }}>
          Welcome to HueIQ
        </h1>
        <p style={{ color: "#888", fontSize: 15, lineHeight: 1.6, margin: "0 0 32px" }}>
          AI-powered fashion recommendations, personalized for you.
        </p>
        <a
          href={AUTH_URL + "/en/signup"}
          onClick={() => localStorage.setItem("hueiq_auth_pending", "1")}
          style={{
            display: "block", padding: "14px 0", borderRadius: 12,
            background: "#111", color: "#fff",
            fontSize: 15, fontWeight: 600, marginBottom: 12,
            textDecoration: "none", textAlign: "center",
          }}
        >
          Get Started
        </a>
        <a
          href={AUTH_URL + "/en/login"}
          onClick={() => localStorage.setItem("hueiq_auth_pending", "1")}
          style={{
            display: "block", padding: "14px 0", borderRadius: 12,
            background: "#fff", color: "#111", border: "1px solid #e0e0e0",
            fontSize: 15, fontWeight: 600,
            textDecoration: "none", textAlign: "center",
          }}
        >
          I already have an account
        </a>
      </div>
    </div>
  );
}

const PropelAuthApp = lazy(() => import("./PropelAuthApp"));

function App() {
  const [showAuth, setShowAuth] = useState(
    () => localStorage.getItem("hueiq_auth_pending") === "1"
  );

  if (showAuth) {
    return (
      <Suspense fallback={
        <div style={{
          position: "fixed", inset: 0, background: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            width: 40, height: 40, border: "3px solid #f0f0f0",
            borderTopColor: "#111", borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      }>
        <PropelAuthApp onLogout={() => {
          localStorage.removeItem("hueiq_auth_pending");
          setShowAuth(false);
        }} />
      </Suspense>
    );
  }

  return <LoginPage />;
}

export default App;
