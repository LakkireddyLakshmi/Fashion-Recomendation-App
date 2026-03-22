import { useState } from "react";
import { AuthProvider, useAuthInfo, useRedirectFunctions } from "@propelauth/react";
import ProfileChat from "./ProfileChat";
import Fashionai from "./Fashionai";

const AUTH_URL = import.meta.env.VITE_AUTH_URL || "https://952380306.propelauthtest.com";

function AppInner() {
  const { isLoggedIn, loading, user } = useAuthInfo();
  const { redirectToLoginPage, redirectToSignupPage } = useRedirectFunctions();
  const [profileDone, setProfileDone] = useState(false);
  const [profileData, setProfileData] = useState(null);
  const [recs, setRecs] = useState([]);

  if (loading) {
    return (
      <div style={{
        position: "fixed", inset: 0, background: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 48, height: 48, border: "3px solid #f0f0f0",
            borderTopColor: "#111", borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
            margin: "0 auto 16px",
          }} />
          <p style={{ color: "#888", fontSize: 14 }}>Loading...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!isLoggedIn) {
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
          <button onClick={() => redirectToSignupPage()} style={{
            width: "100%", padding: "14px 0", borderRadius: 12,
            background: "#111", color: "#fff", border: "none",
            fontSize: 15, fontWeight: 600, cursor: "pointer", marginBottom: 12,
          }}>
            Get Started
          </button>
          <button onClick={() => redirectToLoginPage()} style={{
            width: "100%", padding: "14px 0", borderRadius: 12,
            background: "#fff", color: "#111", border: "1px solid #e0e0e0",
            fontSize: 15, fontWeight: 600, cursor: "pointer",
          }}>
            I already have an account
          </button>
        </div>
      </div>
    );
  }

  if (!profileDone) {
    return (
      <ProfileChat
        email={user.email}
        name={user.firstName || user.email.split("@")[0]}
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
        email: user.email,
        name: user.firstName || user.email.split("@")[0],
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

function App() {
  return (
    <AuthProvider authUrl={AUTH_URL}>
      <AppInner />
    </AuthProvider>
  );
}

export default App;
