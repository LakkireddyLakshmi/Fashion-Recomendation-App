import { useSelector, useDispatch } from "react-redux";
import { login, logout } from "./store/authSlice";
import { clearProfile, updateProfile } from "./store/profileSlice";
import { persistor } from "./store";
import { setProfile } from "./store/profileSlice";
import { SignInPage } from "./components/ui/sign-in-flow";
import StyleProfile from "./StyleProfile";
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

  // Page 2: Style Profile questions
  if (!isComplete) {
    return (
      <StyleProfile
        onComplete={(answers) => {
          // Map answers to profile format
          const colorMap = {
            "Neutrals (black, white, grey)": ["black", "white", "grey"],
            "Earth Tones": ["brown", "beige", "olive", "tan"],
            "Bold/Color Pop": ["red", "blue", "pink", "yellow", "orange"],
            "Patterns": ["multicolor"],
          };
          const categoryMap = {
            "Minimal": ["shirt", "trousers", "blazer"],
            "Street": ["t-shirt", "jeans", "joggers", "cargo"],
            "Athleisure": ["t-shirt", "joggers", "shorts"],
            "Formal": ["shirt", "blazer", "trousers"],
          };
          const fitMap = {
            "Slim/Fitted": "slim",
            "Relaxed Fit": "regular",
            "Oversized": "oversized",
          };

          const colors = (answers.colors || []).flatMap(c => colorMap[c] || []);
          const categories = categoryMap[answers.style] || ["shirt", "jeans"];
          const fit = fitMap[answers.fit] || "regular";

          // Budget mapping
          const budgetMap = {
            "Under ₹1,000":       { budgetId: "under1000", budgetMin: 0,     budgetMax: 1000  },
            "₹1,000 – ₹3,000":   { budgetId: "1k_3k",    budgetMin: 1000,  budgetMax: 3000  },
            "₹3,000 – ₹5,000":   { budgetId: "3k_5k",    budgetMin: 3000,  budgetMax: 5000  },
            "₹5,000 – ₹10,000":  { budgetId: "5k_10k",   budgetMin: 5000,  budgetMax: 10000 },
            "₹10,000+":           { budgetId: "above10k",  budgetMin: 10000, budgetMax: 50000 },
            "No Preference":       { budgetId: "any",       budgetMin: 0,     budgetMax: 50000 },
          };
          const budget = budgetMap[answers.budget] || budgetMap["No Preference"];

          dispatch(setProfile({
            gender: answers.gender || "",
            age: answers.age || "",
            height: answers.height || "",
            weight: answers.weight || "",
            style: answers.style,
            styleIdentity: (answers.style || "").toLowerCase(),
            occasion: answers.occasion,
            fit,
            colors,
            categories,
            ...budget,
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
        style: profileData?.style || "",
        styleIdentity: profileData?.styleIdentity || "",
        occasion: profileData?.occasion || "",
        budgetId: profileData?.budgetId || "any",
        budgetMin: profileData?.budgetMin || 0,
        budgetMax: profileData?.budgetMax || 50000,
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
