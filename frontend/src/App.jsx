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

  // Page 1: Not logged in → Sign in
  if (!isLoggedIn || !user) {
    return (
      <SignInPage
        onAuth={(data) => dispatch(login(data))}
      />
    );
  }

  // Page 2: Upload image → analyze → go directly to recommendations (no attributes page)
  if (!isComplete) {
    return (
      <ImageAnalysis
        onAnalysisComplete={(attributes) => {
          dispatch(setProfile({
            gender: attributes.gender || "",
            age: attributes.estimated_age || 25,
            colors: attributes.color_palette || attributes.preferred_colors || [],
            categories: attributes.clothing_detected || [],
            fit: attributes.recommended_fit || "Regular",
            height: 170,
            weight: 65,
            bodyType: attributes.body_type || "Average",
          }));
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
      initialRecs={[]}
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
