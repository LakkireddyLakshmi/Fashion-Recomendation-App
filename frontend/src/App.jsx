import { useState, useEffect } from "react";
import { AuthProvider, useAuthInfo } from "@propelauth/react";
import ProfileChat from "./ProfileChat";
import Fashionai from "./Fashionai";

const AUTH_URL = import.meta.env.VITE_AUTH_URL || "https://952380306.propelauthtest.com";

function AppInner() {
  const authInfo = useAuthInfo();
  const [profileDone, setProfileDone] = useState(false);
  const [profileData, setProfileData] = useState(null);
  const [recs, setRecs] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Give PropelAuth max 2 seconds to resolve, then show UI anyway
    const t = setTimeout(() => setReady(true), 2000);
    const check = setInterval(() => {
      if (!authInfo.loading) { setReady(true); clearInterval(check); }
    }, 100);
    return () => { clearTimeout(t); clearInterval(check); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Not ready yet — show brief loading
  if (!ready) {
    return (
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
    );
  }

  // Logged in via PropelAuth
  if (authInfo.isLoggedIn && authInfo.user) {
    if (!profileDone) {
      return (
        <ProfileChat
          email={authInfo.user.email}
          name={authInfo.user.firstName || authInfo.user.email.split("@")[0]}
          onProfileComplete={(profile, recommendations) => {
            setProfileData(profile);
            setRecs(recommendations);
            setProfileDone(true);
          }}
        />
      );
    }

    return (
      <Fashionai
        initialProfile={{
          email: authInfo.user.email,
          name: authInfo.user.firstName || authInfo.user.email.split("@")[0],
          gender: profileData?.gender || "",
          age: profileData?.age || "",
          city: profileData?.city || "",
          colors: profileData?.colors || [],
          categories: profileData?.categories || [],
          fit: profileData?.fit || "Regular",
          height: profileData?.height || "",
          weight: profileData?.weight || "",
          bodyType: profileData?.bodyType || "",
        }}
        initialRecs={recs}
        skipWizard={true}
      />
    );
  }

  // Not logged in — show login page
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
        <a href={AUTH_URL + "/en/signup"} style={{
          display: "block", width: "100%", padding: "14px 0", borderRadius: 12,
          background: "#111", color: "#fff", border: "none",
          fontSize: 15, fontWeight: 600, cursor: "pointer", marginBottom: 12,
          textDecoration: "none", textAlign: "center", boxSizing: "border-box",
        }}>
          Get Started
        </a>
        <a href={AUTH_URL + "/en/login"} style={{
          display: "block", width: "100%", padding: "14px 0", borderRadius: 12,
          background: "#fff", color: "#111", border: "1px solid #e0e0e0",
          fontSize: 15, fontWeight: 600, cursor: "pointer",
          textDecoration: "none", textAlign: "center", boxSizing: "border-box",
        }}>
          I already have an account
        </a>
      </div>
    </div>
  );
}

function App() {
  return (
    <AuthProvider authUrl={AUTH_URL}>
      <AppInner />
    </AuthProvider>
  );
}

export default App;
