import { useState } from "react";
import { SignInPage } from "./components/ui/sign-in-flow";
import ProfileChat from "./ProfileChat";
import Fashionai from "./Fashionai";

function App() {
  const [authData, setAuthData] = useState(null);
  const [profileDone, setProfileDone] = useState(false);
  const [profileData, setProfileData] = useState(null);
  const [recs, setRecs] = useState([]);

  if (!authData) {
    return <SignInPage onAuth={(data) => setAuthData(data)} />;
  }

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
