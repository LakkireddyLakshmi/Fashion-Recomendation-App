import React, { useState } from "react";

const API = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

export default function AuthScreen({ onAuth }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    if (!isLogin && !name.trim()) return;

    setLoading(true);
    setError("");

    try {
      if (isLogin) {
        const r = await fetch(`${API}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.detail || "Login failed");
        }
        const data = await r.json();
        if (data.token) sessionStorage.setItem("hueiq_token", data.token);
        onAuth({ email: email.trim(), name: data.name || email.split("@")[0], token: data.token, isNewUser: false });
      } else {
        const r = await fetch(`${API}/api/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password, name: name.trim() }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.detail || "Registration failed");
        }
        const data = await r.json();
        if (data.token) sessionStorage.setItem("hueiq_token", data.token);
        onAuth({ email: email.trim(), name: name.trim(), token: data.token, isNewUser: true });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    }}>
      <div style={{
        width: "min(440px, 90vw)",
        padding: "48px 40px",
      }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 56, height: 56, borderRadius: 16,
            background: "linear-gradient(135deg, #7c3aed, #a855f7)",
            marginBottom: 20,
          }}>
            <span style={{ color: "#fff", fontSize: 24, fontWeight: 700 }}>H</span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#111", letterSpacing: -0.5 }}>
            HueIQ
          </div>
          <div style={{ color: "#888", fontSize: 15, marginTop: 6 }}>
            {isLogin ? "Welcome back! Sign in to continue" : "Create your account to get started"}
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {!isLogin && (
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Full Name</label>
              <input
                type="text"
                placeholder="Enter your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={inputStyle}
              />
            </div>
          )}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
            />
          </div>

          {error && (
            <div style={{
              color: "#dc2626", fontSize: 14, marginBottom: 16, textAlign: "center",
              background: "#fef2f2", padding: "10px 14px", borderRadius: 10,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "14px 0",
              borderRadius: 12,
              border: "none",
              background: "#111",
              color: "#fff",
              fontSize: 16,
              fontWeight: 600,
              fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.6 : 1,
              marginBottom: 20,
              transition: "opacity 0.2s, transform 0.1s",
            }}
          >
            {loading ? "Please wait..." : isLogin ? "Sign In" : "Create Account"}
          </button>
        </form>

        <div style={{ textAlign: "center" }}>
          <button
            onClick={() => { setIsLogin(!isLogin); setError(""); }}
            style={{
              background: "none", border: "none", color: "#7c3aed",
              fontSize: 14, cursor: "pointer", fontWeight: 500,
              fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
            }}
          >
            {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}

const labelStyle = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "#444",
  marginBottom: 6,
};

const inputStyle = {
  width: "100%",
  padding: "12px 16px",
  borderRadius: 10,
  border: "1px solid #e0e0e0",
  background: "#fafafa",
  color: "#111",
  fontSize: 15,
  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color 0.2s",
};
