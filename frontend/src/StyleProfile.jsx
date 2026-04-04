import { useState } from "react";

const STEPS = [
  {
    question: "Tell us about yourself",
    key: "basics",
    type: "basics",
  },
  {
    question: "What's your Style Identity?",
    key: "style",
    options: ["Minimal", "Street", "Athleisure", "Formal"],
  },
  {
    question: "Where are you going?",
    subtitle: "Context = Accuracy",
    key: "occasion",
    options: ["Casual", "Work", "Formal Event", "Date Night", "Outdoor"],
  },
  {
    question: "What Fit Do You Like?",
    subtitle: "Silhouette + Sizing Preference",
    key: "fit",
    options: ["Slim/Fitted", "Relaxed Fit", "Oversized"],
  },
  {
    question: "Pick Your Colors",
    key: "colors",
    options: ["Neutrals (black, white, grey)", "Earth Tones", "Bold/Color Pop", "Patterns"],
    multi: true,
  },
  {
    question: "What's your Budget?",
    key: "budget",
    options: ["Under ₹1,000", "₹1,000 – ₹3,000", "₹3,000 – ₹5,000", "₹5,000 – ₹10,000", "₹10,000+", "No Preference"],
  },
];

export default function StyleProfile({ onComplete, userName }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});

  const current = STEPS[step];
  const selected = answers[current.key] || (current.multi ? [] : "");

  const handleSelect = (option) => {
    if (current.multi) {
      const arr = Array.isArray(selected) ? selected : [];
      const updated = arr.includes(option) ? arr.filter(o => o !== option) : [...arr, option];
      setAnswers({ ...answers, [current.key]: updated });
    } else {
      setAnswers({ ...answers, [current.key]: option });
      if (step < STEPS.length - 1) {
        setTimeout(() => setStep(step + 1), 300);
      }
    }
  };

  const canContinue = current.type === "basics"
    ? !!(answers.gender && answers.age)
    : current.multi
      ? (Array.isArray(selected) && selected.length > 0)
      : !!selected;

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      onComplete(answers);
    }
  };

  const inputStyle = {
    width: "100%", padding: "14px 18px", borderRadius: 12,
    border: "1px solid #e5e7eb", background: "#fff",
    fontSize: 16, fontFamily: "'League Spartan', system-ui, sans-serif",
    outline: "none", boxSizing: "border-box",
    transition: "border-color 0.2s",
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#fff",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'League Spartan', system-ui, sans-serif", padding: 24,
    }}>
      {/* Progress */}
      <div style={{ display: "flex", gap: 6, marginBottom: 40 }}>
        {STEPS.map((_, i) => (
          <div key={i} style={{
            width: i === step ? 32 : 10, height: 4, borderRadius: 2,
            background: i <= step ? "#1a1a1a" : "#e5e7eb",
            transition: "all 0.3s",
          }} />
        ))}
      </div>

      {/* Question */}
      <h1 style={{ fontSize: 32, fontWeight: 700, color: "#1a1a1a", textAlign: "center", margin: "0 0 8px" }}>
        {current.question}
      </h1>
      {current.subtitle && (
        <p style={{ fontSize: 14, color: "#999", textAlign: "center", margin: "0 0 32px" }}>
          {current.subtitle}
        </p>
      )}
      {!current.subtitle && <div style={{ height: 32 }} />}

      {/* Content */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: 400 }}>
        {current.type === "basics" ? (
          <>
            {/* Gender */}
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#888", marginBottom: 6, letterSpacing: 1, textTransform: "uppercase" }}>Gender</div>
              <div style={{ display: "flex", gap: 10 }}>
                {["Male", "Female"].map(g => {
                  const sel = answers.gender === g;
                  return (
                    <button key={g} onClick={() => setAnswers(a => ({ ...a, gender: g }))} style={{
                      flex: 1, padding: "14px 0", borderRadius: 12,
                      border: sel ? "2px solid #1a1a1a" : "1px solid #e5e7eb",
                      background: sel ? "#1a1a1a" : "#fff",
                      color: sel ? "#fff" : "#1a1a1a",
                      fontSize: 16, fontWeight: 600, cursor: "pointer",
                      fontFamily: "'League Spartan'", transition: "all 0.2s",
                    }}>{g}</button>
                  );
                })}
              </div>
            </div>
            {/* Age */}
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#888", marginBottom: 6, letterSpacing: 1, textTransform: "uppercase" }}>Age</div>
              <input
                type="number" placeholder="Enter your age" min="10" max="100"
                value={answers.age || ""}
                onChange={e => setAnswers(a => ({ ...a, age: e.target.value }))}
                style={inputStyle}
              />
            </div>
            {/* Height (optional) */}
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#888", marginBottom: 6, letterSpacing: 1, textTransform: "uppercase" }}>
                Height <span style={{ fontWeight: 400, color: "#bbb" }}>(cm, optional)</span>
              </div>
              <input
                type="number" placeholder="e.g. 170" min="100" max="250"
                value={answers.height || ""}
                onChange={e => setAnswers(a => ({ ...a, height: e.target.value }))}
                style={inputStyle}
              />
            </div>
            {/* Weight (optional) */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#888", marginBottom: 6, letterSpacing: 1, textTransform: "uppercase" }}>
                Weight <span style={{ fontWeight: 400, color: "#bbb" }}>(kg, optional)</span>
              </div>
              <input
                type="number" placeholder="e.g. 65" min="30" max="200"
                value={answers.weight || ""}
                onChange={e => setAnswers(a => ({ ...a, weight: e.target.value }))}
                style={inputStyle}
              />
            </div>
          </>
        ) : (
          current.options.map(option => {
            const isSelected = current.multi
              ? (Array.isArray(selected) && selected.includes(option))
              : selected === option;
            return (
              <button key={option} onClick={() => handleSelect(option)} style={{
                padding: "16px 24px",
                borderRadius: 12,
                border: isSelected ? "2px solid #1a1a1a" : "1px solid #e5e7eb",
                background: isSelected ? "#1a1a1a" : "#fff",
                color: isSelected ? "#fff" : "#1a1a1a",
                fontSize: 16, fontWeight: 600,
                cursor: "pointer",
                fontFamily: "'League Spartan'",
                transition: "all 0.2s",
                textAlign: "left",
              }}>
                {option}
              </button>
            );
          })
        )}
      </div>

      {/* Navigation */}
      <div style={{ display: "flex", gap: 12, marginTop: 32, width: "100%", maxWidth: 400 }}>
        {step > 0 && (
          <button onClick={() => setStep(step - 1)} style={{
            flex: 1, padding: "14px 0", borderRadius: 10,
            border: "1px solid #e5e7eb", background: "#fff",
            color: "#555", fontSize: 15, fontWeight: 600,
            cursor: "pointer", fontFamily: "'League Spartan'",
          }}>Back</button>
        )}
        <button onClick={handleNext} disabled={!canContinue} style={{
          flex: 2, padding: "14px 0", borderRadius: 10,
          border: "none",
          background: canContinue ? "#1a1a1a" : "#e5e7eb",
          color: canContinue ? "#fff" : "#999",
          fontSize: 15, fontWeight: 700,
          cursor: canContinue ? "pointer" : "default",
          fontFamily: "'League Spartan'",
          transition: "all 0.2s",
        }}>
          {step === STEPS.length - 1 ? "Find My Style" : "Continue"}
        </button>
      </div>
    </div>
  );
}
