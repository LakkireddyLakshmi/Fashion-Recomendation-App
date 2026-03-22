import { useState } from "react";
import { AuthProvider, useAuthInfo } from "@propelauth/react";
import ProfileChat from "./ProfileChat";
import Fashionai from "./Fashionai";

const AUTH_URL = import.meta.env.VITE_AUTH_URL || "https://952380306.propelauthtest.com";

function Inner() {
  const { isLoggedIn, loading, user } = useAuthInfo();
  const [profileDone, setProfileDone] = useState(false);
  const [profileData, setProfileData] = useState(null);
  const [recs, setRecs] = useState([]);

  if (loading) {
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

  if (!isLoggedIn || !user) {
    // Not actually logged in, redirect to signup
    window.location.href = AUTH_URL + "/en/signup";
    return null;
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

export default function PropelAuthApp() {
  return (
    <AuthProvider authUrl={AUTH_URL}>
      <Inner />
    </AuthProvider>
  );
}
