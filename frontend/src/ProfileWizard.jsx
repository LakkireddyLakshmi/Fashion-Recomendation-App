import React, { useState, useEffect } from "react";
import Recommendations from "./Recommendations";
import "./wizard.css";

const steps = ["👤 Basic Info", "🎨 Style", "📏 Measurements", "✨ Finish"];

export default function ProfileWizard() {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [form, setForm] = useState({
    name: "",
    gender: "",
    age: "",
    location: "",
    skin_tone: "",
    preferred_colors: [],
    preferred_fit: [],
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
  });

  // Pure CSS animations only - NO Framer Motion
  const currentStepStyle = {
    opacity: 1,
    transform: `translateX(${step * 10}px)`,
    transition: "all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
  };

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleMultiSelect = (e, field) => {
    const values = Array.from(e.target.selectedOptions, (o) => o.value);
    setForm({ ...form, [field]: values });
  };

  const validateStep = () => {
    if (step === 0 && (!form.name || !form.gender || !form.age || !userEmail)) {
      setError("Please fill all fields");
      return false;
    }
    if (step === 2 && (!form.height || !form.weight)) {
      setError("Height & Weight required");
      return false;
    }
    setError("");
    return true;
  };

  const nextStep = () => {
    if (validateStep()) setStep((s) => Math.min(s + 1, 3));
  };
  const prevStep = () => setStep((s) => Math.max(s - 1, 0));

  const submitProfile = async () => {
    if (!validateStep()) return;

    setLoading(true);
    setError("");

    const payload = {
      email: userEmail,
      name: form.name,
      gender: form.gender,
      age: Number(form.age),
      location: form.location,
      body_measurements: {
        height: Number(form.height),
        weight: Number(form.weight),
        body_shape: form.body_shape,
        shoulder_width: Number(form.shoulder_width) || 0,
        hip_width: Number(form.hip_width) || 0,
        torso_length: Number(form.torso_length) || 0,
        shoe_size: form.shoe_size,
        shirt_size: form.shirt_size,
        pants_size: form.pants_size,
      },
      style_profile: {
        skin_tone: form.skin_tone,
        preferred_colors: form.preferred_colors,
        preferred_fit: form.preferred_fit,
        occasions: form.occasions,
        style_notes: form.style_notes,
      },
    };

    try {
      const res = await fetch(
        "https://hueiq-main-site-1.purplesand-63becfba.westus2.azurecontainerapps.io/test-integration/save-profile",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Registration failed");
      }

      localStorage.setItem("email", userEmail);
      setCompleted(true);
      setStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="wizard-container">
      {/* Netflix Progress - Pure CSS */}
      <div className="progress-container">
        {steps.map((label, i) => (
          <div key={i} className={`progress-step ${i <= step ? "active" : ""}`}>
            <div className="step-circle">{i + 1}</div>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* Animated Card - Pure CSS */}
      <div className="wizard-card" style={{ ...currentStepStyle }}>
        {error && <div className="error-banner">⚠️ {error}</div>}

        {/* STEP 0: Basic Info */}
        {step === 0 && (
          <div className="step-content">
            <h1>👋 Welcome to FashionAI</h1>
            <div className="input-grid">
              <input
                name="email"
                placeholder="📧 Your Email"
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
              />
              <input
                name="name"
                placeholder="👤 Full Name"
                onChange={handleChange}
              />
              <select name="gender" onChange={handleChange}>
                <option value="">Gender</option>
                <option>female</option>
                <option>male</option>
              </select>
              <input
                name="age"
                type="number"
                placeholder="🎂 Age"
                onChange={handleChange}
              />
              <input
                name="location"
                placeholder="📍 City"
                onChange={handleChange}
              />
            </div>
            <div className="nav-buttons">
              <button className="next-btn" onClick={nextStep}>
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* STEP 1: Style */}
        {step === 1 && (
          <div className="step-content">
            <h1>🎨 Your Style Preferences</h1>
            <div className="input-grid">
              <select name="skin_tone" onChange={handleChange}>
                <option>Skin Tone</option>
                <option>fair</option>
                <option>medium</option>
                <option>dark</option>
              </select>
              <div className="multi-select-group">
                <label>Preferred Colors</label>
                <select
                  multiple
                  onChange={(e) => handleMultiSelect(e, "preferred_colors")}
                >
                  <option>black</option>
                  <option>white</option>
                  <option>blue</option>
                  <option>green</option>
                  <option>beige</option>
                  <option>red</option>
                </select>
              </div>
              <div className="multi-select-group">
                <label>Preferred Fit</label>
                <select
                  multiple
                  onChange={(e) => handleMultiSelect(e, "preferred_fit")}
                >
                  <option>slim</option>
                  <option>regular</option>
                  <option>loose</option>
                  <option>oversized</option>
                </select>
              </div>
            </div>
            <div className="nav-buttons">
              <button className="back-btn" onClick={prevStep}>
                ← Back
              </button>
              <button className="next-btn" onClick={nextStep}>
                Next →
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Measurements */}
        {step === 2 && (
          <div className="step-content">
            <h1>📏 Perfect Measurements</h1>
            <div className="input-grid">
              <select name="body_shape" onChange={handleChange}>
                <option>Body Shape</option>
                <option>pear</option>
                <option>hourglass</option>
                <option>rectangle</option>
                <option>apple</option>
              </select>
              <input
                name="height"
                placeholder="Height (cm)"
                onChange={handleChange}
              />
              <input
                name="weight"
                placeholder="Weight (kg)"
                onChange={handleChange}
              />
              <input
                name="shoulder_width"
                placeholder="Shoulder Width (cm)"
                onChange={handleChange}
              />
              <input
                name="shirt_size"
                placeholder="Shirt Size"
                onChange={handleChange}
              />
              <input
                name="pants_size"
                placeholder="Pants Size"
                onChange={handleChange}
              />
              <textarea
                name="style_notes"
                placeholder="Any style notes..."
                onChange={handleChange}
              />
            </div>
            <div className="nav-buttons">
              <button className="back-btn" onClick={prevStep}>
                ← Back
              </button>
              <button
                className="submit-btn"
                onClick={submitProfile}
                disabled={loading}
              >
                {loading ? "Saving..." : "✨ Get My Recommendations"}
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Success */}
        {step === 3 && (
          <div className="success-screen">
            <div className="success-content">
              <div className="success-checkmark">✅</div>
              <h1>Welcome {form.name}! 🎉</h1>
              <p>Your personalized recommendations are loading...</p>
              <Recommendations />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
