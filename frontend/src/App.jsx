import { useSelector, useDispatch } from "react-redux";
import { login, logout } from "./store/authSlice";
import { clearProfile, updateProfile } from "./store/profileSlice";
import { persistor } from "./store";
import { setProfile } from "./store/profileSlice";
import { SignInPage } from "./components/ui/sign-in-flow";
import ImageAnalysis from "./ImageAnalysis";
import Fashionai from "./Fashionai";

function App() {
  const dispatch = useDispatch();
  const { user, isLoggedIn } = useSelector((s) => s.auth);
  const { data: profileData, isComplete } = useSelector((s) => s.profile);
  const recs = useSelector((s) => s.recommendations.items);

  // Page 1: Not logged in → Sign in
  if (!isLoggedIn || !user) {
    return (
      <SignInPage
        onAuth={(data) => dispatch(login(data))}
      />
    );
  }

  // Page 2: Profile not complete → Image Upload & Analysis
  if (!isComplete) {
    return (
      <ImageAnalysis
        userEmail={user.email}
        onAnalysisComplete={(attributes) => {
          // Convert image analysis attributes to profile format
          const profile = {
            gender: attributes.gender || "",
            age: attributes.estimated_age || 25,
            colors: attributes.color_palette || attributes.preferred_colors || [],
            categories: attributes.clothing_detected || [],
            fit: attributes.recommended_fit || "Regular",
            height: 170,
            weight: 65,
            bodyType: attributes.body_type || "Average",
            skinTone: attributes.skin_tone || "",
            currentStyle: attributes.current_style || "",
            styleKeywords: attributes.style_keywords || [],
            fashionScore: attributes.fashion_score || 5,
            occasionFit: attributes.occasion_fit || "",
            seasonFit: attributes.season_fit || "",
          };
          dispatch(setProfile(profile));
        }}
      />
    );
  }

  // Page 3: Recommendations
  return (
    <Fashionai
      initialProfile={{
        email: user.email,
        name: user.name,
        gender: profileData?.gender || "",
        age: profileData?.age || "",
        city: "",
        colors: profileData?.colors || [],
        categories: profileData?.categories || [],
        fit: profileData?.fit || "Regular",
        height: profileData?.height || "",
        weight: profileData?.weight || "",
        bodyType: profileData?.bodyType || "",
      }}
      initialRecs={recs}
      skipWizard={true}
      onLogout={() => {
        dispatch(logout());
        dispatch(clearProfile());
        persistor.purge();
      }}
      onProfileUpdate={(data) => dispatch(updateProfile(data))}
    />
  );
}

export default App;
