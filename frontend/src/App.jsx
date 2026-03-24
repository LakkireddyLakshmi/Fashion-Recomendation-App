import { useSelector, useDispatch } from "react-redux";
import { login, logout } from "./store/authSlice";
import { clearProfile, updateProfile } from "./store/profileSlice";
import { persistor } from "./store";
import { setProfile } from "./store/profileSlice";
import { setRecommendations } from "./store/recommendationsSlice";
import { SignInPage } from "./components/ui/sign-in-flow";
import ProfileChat from "./ProfileChat";
import Fashionai from "./Fashionai";

function App() {
  const dispatch = useDispatch();
  const { user, isLoggedIn } = useSelector((s) => s.auth);
  const { data: profileData, isComplete } = useSelector((s) => s.profile);
  const recs = useSelector((s) => s.recommendations.items);

  // Step 1: Not logged in → Sign in
  if (!isLoggedIn || !user) {
    return (
      <SignInPage
        onAuth={(data) => dispatch(login(data))}
      />
    );
  }

  // Step 2: Profile not complete → Profile chat
  if (!isComplete) {
    return (
      <ProfileChat
        email={user.email}
        name={user.name}
        onProfileComplete={(profile, recommendations) => {
          dispatch(setProfile(profile));
          if (recommendations?.length) dispatch(setRecommendations(recommendations));
        }}
      />
    );
  }

  // Step 3: Recommendations
  return (
    <Fashionai
      initialProfile={{
        email: user.email,
        name: user.name,
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
