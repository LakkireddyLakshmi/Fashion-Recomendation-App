import { useState } from "react";
import AuthScreen from "./AuthScreen";
import ProfileChat from "./ProfileChat";
import Fashionai from "./Fashionai";

function App() {
  const [authData, setAuthData] = useState(null);
  const [profileDone, setProfileDone] = useState(false);
  const [profileData, setProfileData] = useState(null);
  const [recs, setRecs] = useState([]);

  // Step 1: Auth
  if (!authData) {
    return <AuthScreen onAuth={(data) => setAuthData(data)} />;
  }

  // Step 2: Profile collection via Xpectrum chat (only for new users)
  if (!profileDone) {
    return (
      <ProfileChat
        email={authData.email}
        name={authData.name}
        onProfileComplete={(profile, recommendations) => {
          setProfileData(profile);
          setRecs(recommendations);
          setProfileDone(true);
        }}
      />
    );
  }

  // Step 3: Recommendations (existing app)
  return (
    <Fashionai
      initialProfile={{
        email: authData.email,
        name: authData.name,
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

export default App;
