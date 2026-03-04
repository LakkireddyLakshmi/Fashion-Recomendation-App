import React, { useState, useEffect } from "react";
import Recommendations from "./Recommendations";
import "./wizard.css";

// ============================================================================
// ADVANCED CONFIGURATION - USING LOCAL PROXY TO AVOID CORS
// ============================================================================
// Change this to use your local backend as a proxy
const API_BASE_URL = "http://127.0.0.1:8000";

const steps = ["👤 Basic Info", "🎨 Style", "📏 Measurements", "✨ Finish"];

export default function ProfileWizard() {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [userEmail, setUserEmail] = useState("");
  // State to manage the ID returned from the backend after profile creation
  const [userId, setUserId] = useState(null);
  const [form, setForm] = useState({
    name: "",
    gender: "",
    age: "",
    location: "",
    password: "", // Added password field
    skin_tone: "",
    preferred_colors: [],
    preferred_fit: [],
    occasions: [],
    height: "",
    weight: "",
    body_shape: "",
    shoulder_width: "",
    hip_width: "",
    torso_length: "",
    shoe_size: "",
    shirt_size: "",
    pants_size: "",
    style_notes: "",
    chest: "",
    waist: "",
    inseam: "",
  });

  // ============================================================================
  // ADVANCED VALIDATION AND HELPER FUNCTIONS
  // ============================================================================
  const validateStep = () => {
    setError(""); // Clear previous errors
    switch (step) {
      case 0:
        if (!userEmail?.trim()) return "Email is required";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail))
          return "Invalid email format";
        if (!form.name?.trim()) return "Name is required";
        if (!form.gender) return "Gender is required";
        if (!form.age) return "Age is required";
        if (form.age && (form.age < 18 || form.age > 120))
          return "Age must be between 18 and 120";
        if (!form.password?.trim()) return "Password is required";
        if (form.password && form.password.length < 6)
          return "Password must be at least 6 characters";
        break;
      case 2:
        if (!form.height) return "Height is required";
        if (form.height && (form.height < 100 || form.height > 250))
          return "Height must be between 100cm and 250cm";
        if (!form.weight) return "Weight is required";
        if (form.weight && (form.weight < 30 || form.weight > 200))
          return "Weight must be between 30kg and 200kg";
        break;
      default:
        break;
    }
    return null; // No errors
  };

  const handleNext = () => {
    const validationError = validateStep();
    if (validationError) {
      setError(validationError);
      return;
    }
    setStep((prev) => Math.min(prev + 1, steps.length - 1));
  };

  const handlePrev = () => setStep((prev) => Math.max(prev - 1, 0));

  // ============================================================================
  // PROFILE SUBMISSION - USING LOCAL PROXY TO AVOID CORS
  // ============================================================================
  const submitProfile = async () => {
    const validationError = validateStep();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError("");

    // Construct payload exactly as the real backend expects
    const payload = {
      email: userEmail,
      name: form.name,
      password: form.password, // Added password field to payload
      gender: form.gender,
      age: form.age ? Number(form.age) : null,
      location: form.location || null,
      body_measurements: {
        height: form.height ? Number(form.height) : null,
        weight: form.weight ? Number(form.weight) : null,
        body_shape: form.body_shape || null,
        shoulder_width: form.shoulder_width
          ? Number(form.shoulder_width)
          : null,
        hip_width: form.hip_width ? Number(form.hip_width) : null,
        torso_length: form.torso_length ? Number(form.torso_length) : null,
        shoe_size: form.shoe_size || null,
        shirt_size: form.shirt_size || null,
        pants_size: form.pants_size || null,
        chest: form.chest ? Number(form.chest) : null,
        waist: form.waist ? Number(form.waist) : null,
        inseam: form.inseam ? Number(form.inseam) : null,
      },
      style_profile: {
        skin_tone: form.skin_tone || null,
        preferred_colors: form.preferred_colors,
        preferred_fit: form.preferred_fit,
        occasions: form.occasions.length ? form.occasions : ["casual"],
        style_notes: form.style_notes || null,
      },
    };

    console.log("📤 Submitting profile via proxy to LIVE API:", payload);

    try {
      // USING THE PROXY ENDPOINT TO AVOID CORS
      const response = await fetch(`${API_BASE_URL}/proxy/hueiq/api/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error("❌ API Error:", response.status, data);
        // Check if it's a validation error and provide better message
        if (data.detail && Array.isArray(data.detail)) {
          const missingFields = data.detail
            .map((d) => d.loc.join("."))
            .join(", ");
          throw new Error(`Missing required fields: ${missingFields}`);
        }
        throw new Error(
          data?.detail ||
            data?.message ||
            `Registration failed (${response.status})`,
        );
      }

      console.log("✅ Profile saved to live backend via proxy:", data);

      // Store essential data from the real backend response
      localStorage.setItem("userEmail", userEmail);

      // The API returns 'id' field (not user_id) as we saw in the curl response
      if (data?.id) {
        localStorage.setItem("userId", String(data.id));
        setUserId(data.id);
        console.log("✅ User ID stored:", data.id);
      } else if (data?.user_id) {
        localStorage.setItem("userId", String(data.user_id));
        setUserId(data.user_id);
      } else {
        // Fallback or generate a temporary one if not provided
        const tempId = Date.now();
        localStorage.setItem("userId", String(tempId));
        setUserId(tempId);
        console.log("⚠️ Using temporary user ID:", tempId);
      }

      // Move to the final success/recommendations step
      setStep(steps.length - 1);
    } catch (err) {
      console.error("❌ Error submitting profile:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // FORM HANDLERS
  // ============================================================================
  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setError(""); // Clear error on change
  };

  const handleMultiSelect = (e, field) => {
    const values = Array.from(
      e.target.selectedOptions,
      (option) => option.value,
    );
    setForm({ ...form, [field]: values });
    setError("");
  };

  // ============================================================================
  // RENDER UI
  // ============================================================================
  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="step-content">
            <h1>👋 Welcome to HueIQ FashionAI</h1>
            <p className="step-description">
              Let's start by getting to know you.
            </p>
            <div className="input-grid">
              <input
                type="email"
                name="email"
                placeholder="📧 Your Email *"
                value={userEmail}
                onChange={(e) => {
                  setUserEmail(e.target.value);
                  setError("");
                }}
                className={error?.includes("Email") ? "input-error" : ""}
                required
              />
              <input
                name="name"
                placeholder="👤 Full Name *"
                value={form.name}
                onChange={handleChange}
                className={error?.includes("Name") ? "input-error" : ""}
                required
              />
              <input
                name="password"
                type="password"
                placeholder="🔐 Password *"
                value={form.password}
                onChange={handleChange}
                className={error?.includes("Password") ? "input-error" : ""}
                required
                minLength="6"
              />
              <select
                name="gender"
                value={form.gender}
                onChange={handleChange}
                className={error?.includes("Gender") ? "input-error" : ""}
                required
              >
                <option value="">Select Gender *</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="non-binary">Non-binary</option>
                <option value="prefer-not-to-say">Prefer not to say</option>
              </select>
              <input
                name="age"
                type="number"
                placeholder="🎂 Age *"
                value={form.age}
                onChange={handleChange}
                min="18"
                max="120"
                className={error?.includes("Age") ? "input-error" : ""}
                required
              />
              <input
                name="location"
                placeholder="📍 City (optional)"
                value={form.location}
                onChange={handleChange}
              />
            </div>
          </div>
        );

      case 1:
        return (
          <div className="step-content">
            <h1>🎨 Your Style Preferences</h1>
            <p className="step-description">Tell us what you love.</p>
            <div className="input-grid">
              <select
                name="skin_tone"
                value={form.skin_tone}
                onChange={handleChange}
              >
                <option value="">Skin Tone (optional)</option>
                <option value="fair">Fair</option>
                <option value="medium">Medium</option>
                <option value="olive">Olive</option>
                <option value="tan">Tan</option>
                <option value="dark">Dark</option>
                <option value="deep">Deep</option>
              </select>
              <div className="multi-select-group">
                <label>Preferred Colors</label>
                <select
                  multiple
                  value={form.preferred_colors}
                  onChange={(e) => handleMultiSelect(e, "preferred_colors")}
                  size="5"
                >
                  <option value="black">Black</option>
                  <option value="white">White</option>
                  <option value="gray">Gray</option>
                  <option value="navy">Navy</option>
                  <option value="blue">Blue</option>
                  <option value="red">Red</option>
                  <option value="green">Green</option>
                  <option value="yellow">Yellow</option>
                  <option value="purple">Purple</option>
                  <option value="pink">Pink</option>
                  <option value="brown">Brown</option>
                  <option value="beige">Beige</option>
                </select>
              </div>
              <div className="multi-select-group">
                <label>Preferred Fit</label>
                <select
                  multiple
                  value={form.preferred_fit}
                  onChange={(e) => handleMultiSelect(e, "preferred_fit")}
                  size="4"
                >
                  <option value="slim">Slim</option>
                  <option value="tailored">Tailored</option>
                  <option value="regular">Regular</option>
                  <option value="relaxed">Relaxed</option>
                  <option value="loose">Loose</option>
                  <option value="oversized">Oversized</option>
                </select>
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="step-content">
            <h1>📏 Your Measurements</h1>
            <p className="step-description">For the perfect fit.</p>
            <div className="input-grid">
              <select
                name="body_shape"
                value={form.body_shape}
                onChange={handleChange}
              >
                <option value="">Body Shape (optional)</option>
                <option value="hourglass">Hourglass</option>
                <option value="pear">Pear</option>
                <option value="apple">Apple</option>
                <option value="rectangle">Rectangle</option>
                <option value="inverted_triangle">Inverted Triangle</option>
                <option value="athletic">Athletic</option>
              </select>
              <input
                name="height"
                type="number"
                placeholder="Height (cm) *"
                value={form.height}
                onChange={handleChange}
                required
                step="0.1"
                className={error?.includes("Height") ? "input-error" : ""}
              />
              <input
                name="weight"
                type="number"
                placeholder="Weight (kg) *"
                value={form.weight}
                onChange={handleChange}
                required
                step="0.1"
                className={error?.includes("Weight") ? "input-error" : ""}
              />
              <input
                name="shoulder_width"
                type="number"
                placeholder="Shoulder Width (cm)"
                value={form.shoulder_width}
                onChange={handleChange}
                step="0.1"
              />
              <input
                name="chest"
                placeholder="Chest (cm)"
                value={form.chest}
                onChange={handleChange}
                type="number"
                step="0.1"
              />
              <input
                name="waist"
                placeholder="Waist (cm)"
                value={form.waist}
                onChange={handleChange}
                type="number"
                step="0.1"
              />
              <input
                name="hip_width"
                type="number"
                placeholder="Hip Width (cm)"
                value={form.hip_width}
                onChange={handleChange}
                step="0.1"
              />
              <input
                name="inseam"
                placeholder="Inseam (cm)"
                value={form.inseam}
                onChange={handleChange}
                type="number"
                step="0.1"
              />
              <input
                name="shoe_size"
                placeholder="Shoe Size (EU)"
                value={form.shoe_size}
                onChange={handleChange}
              />
              <input
                name="shirt_size"
                placeholder="Shirt Size (e.g., M, L)"
                value={form.shirt_size}
                onChange={handleChange}
              />
              <input
                name="pants_size"
                placeholder="Pants Size (e.g., 32, 34)"
                value={form.pants_size}
                onChange={handleChange}
              />
              <textarea
                name="style_notes"
                placeholder="Any style notes or preferences..."
                value={form.style_notes}
                onChange={handleChange}
                rows="3"
              />
            </div>
          </div>
        );

      case 3:
        return (
          <div className="success-screen">
            <div className="success-content">
              <div className="success-checkmark">✨</div>
              <h1>Welcome, {form.name || "Fashion Enthusiast"}! 🎉</h1>
              <p>
                Your style profile is complete. Generating your personalized
                recommendations...
              </p>
              {/* The Recommendations component will now use the REAL userId/email from localStorage */}
              <Recommendations />
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="wizard-container">
      {/* Progress Bar */}
      <div className="progress-container">
        {steps.map((label, i) => (
          <div
            key={i}
            className={`progress-step ${i <= step ? "active" : ""} ${i === step ? "current" : ""}`}
          >
            <div className="step-circle">{i + 1}</div>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* Main Card */}
      <div className="wizard-card">
        {error && <div className="error-banner">⚠️ {error}</div>}
        {renderStep()}

        {/* Navigation Buttons (conditionally rendered) */}
        {step < steps.length - 1 && step !== 2 && (
          <div className="nav-buttons">
            {step > 0 && (
              <button
                className="back-btn"
                onClick={handlePrev}
                disabled={loading}
              >
                ← Back
              </button>
            )}
            <button
              className="next-btn"
              onClick={handleNext}
              disabled={loading}
            >
              Continue →
            </button>
          </div>
        )}

        {/* Special navigation for the Measurements step (Submit) */}
        {step === 2 && (
          <div className="nav-buttons">
            <button
              className="back-btn"
              onClick={handlePrev}
              disabled={loading}
            >
              ← Back
            </button>
            <button
              className="submit-btn"
              onClick={submitProfile}
              disabled={loading}
            >
              {loading
                ? "⏳ Creating Profile..."
                : "✨ Complete & Get Recommendations"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
