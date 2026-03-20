import React, { useState } from "react";
import { BG1 } from "./Fashionai";

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
      backgroundImage: `url(${BG1})`, backgroundSize: "cover", backgroundPosition: "center",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'League Spartan', sans-serif",
    }}>
      <div style={{
        width: "min(420px, 90vw)",
        background: "linear-gradient(105.88deg, rgba(250,183,251,0.15) 0%, rgba(198,148,249,0.1) 50%, rgba(124,58,237,0.08) 100%)",
        backdropFilter: "blur(50px)",
        borderRadius: 30,
        padding: "48px 36px",
        border: "1px solid rgba(255,255,255,0.12)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontWeight: 300, fontSize: 28, color: "#fff", lineHeight: 1.15 }}>
            Welcome to
          </div>
          <div style={{ fontWeight: 700, fontSize: 64, color: "#fff", letterSpacing: -1, lineHeight: 1.1 }}>
            HUEIQ
          </div>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 16, marginTop: 8 }}>
            {isLogin ? "Sign in to continue" : "Create your account"}
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {!isLogin && (
            <input
              type="text"
              placeholder="Full Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />

          {error && (
            <div style={{ color: "#fca5a5", fontSize: 14, marginBottom: 14, textAlign: "center" }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "14px 0",
              borderRadius: 100,
              border: "none",
              background: "linear-gradient(135deg, #7c3aed, #a855f7)",
              color: "#fff",
              fontSize: 18,
              fontWeight: 700,
              fontFamily: "'League Spartan', sans-serif",
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.6 : 1,
              marginBottom: 18,
              transition: "opacity 0.2s",
            }}
          >
            {loading ? "Please wait..." : isLogin ? "Sign In" : "Create Account"}
          </button>
        </form>

        <div style={{ textAlign: "center" }}>
          <button
            onClick={() => { setIsLogin(!isLogin); setError(""); }}
            style={{
              background: "none", border: "none", color: "rgba(255,255,255,0.6)",
              fontSize: 15, cursor: "pointer", fontFamily: "'League Spartan', sans-serif",
            }}
          >
            {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "14px 20px",
  borderRadius: 100,
  border: "none",
  background: "rgba(255,255,255,0.12)",
  backdropFilter: "blur(50px)",
  color: "#fff",
  fontSize: 17,
  fontWeight: 300,
  fontFamily: "'League Spartan', sans-serif",
  outline: "none",
  marginBottom: 14,
  boxSizing: "border-box",
};
