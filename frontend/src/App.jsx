import { useState, useEffect } from "react";
import { AuthProvider, useAuthInfo } from "@propelauth/react";
import ProfileChat from "./ProfileChat";
import Fashionai from "./Fashionai";

const AUTH_URL = import.meta.env.VITE_AUTH_URL || "https://952380306.propelauthtest.com";

function AuthenticatedApp() {
  const { isLoggedIn, user } = useAuthInfo();
  const [profileDone, setProfileDone] = useState(false);
  const [profileData, setProfileData] = useState(null);
  const [recs, setRecs] = useState([]);

  if (isLoggedIn && user) {
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

  // Still loading or not logged in inside AuthProvider
  return null;
}

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
        <a href={AUTH_URL + "/en/signup"} style={{
          display: "block", padding: "14px 0", borderRadius: 12,
          background: "#111", color: "#fff",
          fontSize: 15, fontWeight: 600, marginBottom: 12,
          textDecoration: "none", textAlign: "center",
        }}>
          Get Started
        </a>
        <a href={AUTH_URL + "/en/login"} style={{
          display: "block", padding: "14px 0", borderRadius: 12,
          background: "#fff", color: "#111", border: "1px solid #e0e0e0",
          fontSize: 15, fontWeight: 600,
          textDecoration: "none", textAlign: "center",
        }}>
          I already have an account
        </a>
      </div>
    </div>
  );
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Quick check if user has a valid session
    fetch(AUTH_URL + "/api/v1/refresh_token", {
      method: "GET",
      credentials: "include",
    })
      .then(res => {
        setIsLoggedIn(res.ok);
        setChecking(false);
      })
      .catch(() => {
        setIsLoggedIn(false);
        setChecking(false);
      });

    // Never wait more than 2 seconds
    const t = setTimeout(() => setChecking(false), 2000);
    return () => clearTimeout(t);
  }, []);

  if (checking) {
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

  if (!isLoggedIn) {
    return <LoginPage />;
  }

  return (
    <AuthProvider authUrl={AUTH_URL}>
      <AuthenticatedApp />
    </AuthProvider>
  );
}

export default App;
