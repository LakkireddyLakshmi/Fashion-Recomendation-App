import React, { useState, useEffect, useRef } from "react";

const API = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

export default function AuthScreen({ onAuth }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);
  const googleBtnRef = useRef(null);

  useEffect(() => { setMounted(true); }, []);

  // Load Google Identity Services
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      if (window.google && googleBtnRef.current) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleResponse,
        });
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: "outline",
          size: "large",
          width: "100%",
          text: "continue_with",
          shape: "rectangular",
          logo_alignment: "center",
        });
      }
    };
    document.body.appendChild(script);
    return () => { try { document.body.removeChild(script); } catch(e) { /* ignore */ } };
  }, []);

  const handleGoogleResponse = async (response) => {
    setLoading(true);
    setError("");
    try {
      // Decode the JWT to get user info
      const payload = JSON.parse(atob(response.credential.split(".")[1]));
      const googleEmail = payload.email;
      const googleName = payload.name || payload.given_name || googleEmail.split("@")[0];

      // Try to register/login with the backend
      try {
        const googlePassword = response.credential.slice(0, 32);
        const r = await fetch(`${API}/api/auth/register`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: googleEmail, password: googlePassword, name: googleName }),
          signal: AbortSignal.timeout(15000),
        });
        const data = await r.json();
        if (data.token) sessionStorage.setItem("hueiq_token", data.token);
        sessionStorage.setItem("hueiq_password", googlePassword);
        onAuth({ email: googleEmail, name: googleName, token: data.token, isNewUser: true });
      } catch (regErr) {
        // If register fails (user exists), try login
        const r = await fetch(`${API}/api/auth/login`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: googleEmail, password: response.credential.slice(0, 32) }),
          signal: AbortSignal.timeout(15000),
        });
        if (r.ok) {
          const data = await r.json();
          if (data.token) sessionStorage.setItem("hueiq_token", data.token);
          onAuth({ email: googleEmail, name: googleName, token: data.token, isNewUser: false });
        } else {
          // Backend doesn't have this user — just proceed without backend auth
          onAuth({ email: googleEmail, name: googleName, token: null, isNewUser: true });
        }
      }
    } catch (err) {
      setError("Google sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    if (!isLogin && !name.trim()) return;
    setLoading(true);
    setError("");
    try {
      if (isLogin) {
        const r = await fetch(`${API}/api/auth/login`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || "Login failed"); }
        const data = await r.json();
        if (data.token) sessionStorage.setItem("hueiq_token", data.token);
        sessionStorage.setItem("hueiq_password", password);
        onAuth({ email: email.trim(), name: data.name || email.split("@")[0], token: data.token, isNewUser: false });
      } else {
        const r = await fetch(`${API}/api/auth/register`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password, name: name.trim() }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || "Registration failed"); }
        const data = await r.json();
        if (data.token) sessionStorage.setItem("hueiq_token", data.token);
        sessionStorage.setItem("hueiq_password", password);
        onAuth({ email: email.trim(), name: name.trim(), token: data.token, isNewUser: true });
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "#fff",
      display: "flex",
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      {/* Left — Brand panel */}
      <div style={{
        flex: 1, background: "#000", color: "#fff",
        display: "flex", flexDirection: "column", justifyContent: "center",
        padding: "60px 70px", position: "relative", overflow: "hidden",
        opacity: mounted ? 1 : 0, transform: mounted ? "translateX(0)" : "translateX(-20px)",
        transition: "all 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
      }}>
        {/* Subtle gradient accent */}
        <div style={{
          position: "absolute", top: 0, right: 0, width: "60%", height: "100%",
          background: "linear-gradient(180deg, rgba(124,58,237,0.08) 0%, transparent 50%, rgba(99,102,241,0.05) 100%)",
          pointerEvents: "none",
        }} />

        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 48,
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: "#fff", color: "#000",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, fontWeight: 800,
            }}>H</div>
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>HueIQ</span>
          </div>

          <h1 style={{
            fontSize: 48, fontWeight: 700, lineHeight: 1.1,
            letterSpacing: -1.5, margin: "0 0 20px",
          }}>
            Your personal<br />AI stylist
          </h1>
          <p style={{
            fontSize: 16, color: "rgba(255,255,255,0.5)", lineHeight: 1.7,
            maxWidth: 380, margin: 0,
          }}>
            Get AI-powered fashion recommendations tailored to your unique style, body type, and preferences.
          </p>

          <div style={{
            display: "flex", gap: 40, marginTop: 56,
            borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 32,
          }}>
            {[
              { num: "184+", label: "Curated items" },
              { num: "7", label: "Style signals" },
              { num: "AI", label: "Powered" },
            ].map((s) => (
              <div key={s.label}>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{s.num}</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right — Form */}
      <div style={{
        width: 500, display: "flex", alignItems: "center", justifyContent: "center",
        padding: "40px 56px",
        opacity: mounted ? 1 : 0, transform: mounted ? "translateY(0)" : "translateY(15px)",
        transition: "all 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.15s",
      }}>
        <div style={{ width: "100%" }}>
          <h2 style={{
            fontSize: 26, fontWeight: 700, color: "#111", margin: "0 0 6px",
            letterSpacing: -0.5,
          }}>
            {isLogin ? "Welcome back" : "Get started"}
          </h2>
          <p style={{ fontSize: 14, color: "#999", margin: "0 0 32px" }}>
            {isLogin ? "Sign in to your account" : "Create a new account"}
          </p>

          {/* Google Sign-In */}
          <div ref={googleBtnRef} style={{ marginBottom: 20 }} />

          <div style={{
            display: "flex", alignItems: "center", gap: 12, marginBottom: 20,
          }}>
            <div style={{ flex: 1, height: 1, background: "#e5e5e5" }} />
            <span style={{ fontSize: 12, color: "#aaa", fontWeight: 500 }}>OR</span>
            <div style={{ flex: 1, height: 1, background: "#e5e5e5" }} />
          </div>

          <form onSubmit={handleSubmit}>
            {!isLogin && (
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>Name</label>
                <input type="text" placeholder="Your full name" value={name}
                  onChange={(e) => setName(e.target.value)} style={inputStyle}
                  onFocus={(e) => e.target.style.borderColor = "#111"}
                  onBlur={(e) => e.target.style.borderColor = "#e5e5e5"}
                />
              </div>
            )}
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Email</label>
              <input type="email" placeholder="you@example.com" value={email}
                onChange={(e) => setEmail(e.target.value)} style={inputStyle}
                onFocus={(e) => e.target.style.borderColor = "#111"}
                onBlur={(e) => e.target.style.borderColor = "#e5e5e5"}
              />
            </div>
            <div style={{ marginBottom: 28 }}>
              <label style={labelStyle}>Password</label>
              <input type="password" placeholder="••••••••" value={password}
                onChange={(e) => setPassword(e.target.value)} style={inputStyle}
                onFocus={(e) => e.target.style.borderColor = "#111"}
                onBlur={(e) => e.target.style.borderColor = "#e5e5e5"}
              />
            </div>

            {error && (
              <div style={{
                color: "#dc2626", fontSize: 13, marginBottom: 20,
                background: "#fef2f2", padding: "10px 16px", borderRadius: 10,
                border: "1px solid #fee2e2",
              }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              width: "100%", padding: "14px 0", borderRadius: 10, border: "none",
              background: "#111", color: "#fff", fontSize: 15, fontWeight: 600,
              cursor: loading ? "wait" : "pointer",
              fontFamily: "'Inter', system-ui, sans-serif",
              transition: "opacity 0.2s",
              opacity: loading ? 0.6 : 1,
            }}>
              {loading ? "Processing..." : isLogin ? "Sign in" : "Create account"}
            </button>
          </form>

          <p style={{
            marginTop: 24, textAlign: "center", fontSize: 14, color: "#999",
          }}>
            {isLogin ? "Don't have an account? " : "Already have an account? "}
            <button onClick={() => { setIsLogin(!isLogin); setError(""); }}
              style={{
                background: "none", border: "none", color: "#111",
                fontSize: 14, fontWeight: 600, cursor: "pointer",
                textDecoration: "underline", fontFamily: "'Inter', system-ui, sans-serif",
              }}>
              {isLogin ? "Sign up" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

const labelStyle = {
  display: "block", fontSize: 13, fontWeight: 600,
  color: "#333", marginBottom: 6,
};

const inputStyle = {
  width: "100%", padding: "12px 16px", borderRadius: 10,
  border: "1px solid #e5e5e5", background: "#fff",
  color: "#111", fontSize: 15,
  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
  outline: "none", boxSizing: "border-box",
  transition: "border-color 0.2s",
};
