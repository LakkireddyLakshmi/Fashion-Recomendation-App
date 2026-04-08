import { useState, useEffect } from "react";

const STYLE_ICONS = {
  Minimal: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  Street: "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  Athleisure: "M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z",
  Formal: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2",
  Casual: "M12 2a10 10 0 100 20 10 10 0 000-20z",
  Ethnic: "M12 2L2 7l10 5 10-5-10-5z",
};

const OCCASION_EMOJIS = { Casual: "☕", Work: "💼", "Formal Event": "🎩", "Date Night": "🌹", Outdoor: "🌿" };
const FIT_DESC = { "Slim/Fitted": "Close to body, structured", "Relaxed Fit": "Comfortable, easy movement", Oversized: "Loose, extra room" };

const COLOR_GROUPS = [
  { name: "Neutrals (black, white, grey)", colors: ["#000", "#fff", "#9ca3af"], label: "Neutrals" },
  { name: "Earth Tones", colors: ["#92400e", "#d4a574", "#808000"], label: "Earth Tones" },
  { name: "Bold/Color Pop", colors: ["#ef4444", "#2563eb", "#ec4899", "#eab308"], label: "Bold Colors" },
  { name: "Patterns", colors: ["linear-gradient(45deg,#000 25%,#fff 25%,#fff 50%,#000 50%,#000 75%,#fff 75%)"], label: "Patterns" },
];

const STEPS = [
  { question: "Tell us about yourself", key: "basics", type: "basics" },
  { question: "What's your Style Identity?", subtitle: "This shapes everything we recommend", key: "style", options: ["Minimal", "Street", "Athleisure", "Formal"] },
  { question: "Where are you headed?", subtitle: "We'll match the vibe", key: "occasion", options: ["Casual", "Work", "Formal Event", "Date Night", "Outdoor"] },
  { question: "How do you like the fit?", subtitle: "Your comfort, your rules", key: "fit", options: ["Slim/Fitted", "Relaxed Fit", "Oversized"] },
  { question: "Pick your color palette", subtitle: "Select all that speak to you", key: "colors", options: ["Neutrals (black, white, grey)", "Earth Tones", "Bold/Color Pop", "Patterns"], multi: true },
  { question: "What's your budget?", key: "budget", options: ["Under $50", "$50 – $100", "$100 – $200", "$200 – $500", "$500+", "No Preference"] },
];

export default function StyleProfile({ onComplete, userName }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [animDir, setAnimDir] = useState("right");

  const current = STEPS[step];
  const selected = answers[current.key] || (current.multi ? [] : "");
  const progress = ((step + 1) / STEPS.length) * 100;

  const handleSelect = (option) => {
    if (current.multi) {
      const arr = Array.isArray(selected) ? selected : [];
      const updated = arr.includes(option) ? arr.filter(o => o !== option) : [...arr, option];
      setAnswers({ ...answers, [current.key]: updated });
    } else {
      setAnswers({ ...answers, [current.key]: option });
      if (step < STEPS.length - 1) {
        setTimeout(() => { setAnimDir("right"); setStep(step + 1); }, 400);
      }
    }
  };

  const canContinue = current.type === "basics"
    ? !!(answers.gender && answers.age)
    : current.multi
      ? (Array.isArray(selected) && selected.length > 0)
      : !!selected;

  const goNext = () => { if (step < STEPS.length - 1) { setAnimDir("right"); setStep(step + 1); } else onComplete(answers); };
  const goBack = () => { if (step > 0) { setAnimDir("left"); setStep(step - 1); } };

  const glassInput = {
    width: "100%", padding: "16px 20px", borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)",
    backdropFilter: "blur(10px)",
    fontSize: 18, fontFamily: "'League Spartan', sans-serif",
    fontWeight: 500,
    outline: "none", boxSizing: "border-box", color: "#ffffff",
    transition: "border-color 0.3s, box-shadow 0.3s",
    caretColor: "#a855f7",
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #0a0a1a 0%, #0f1028 40%, #0a0f1e 100%)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'League Spartan', sans-serif", padding: 24, position: "relative", overflow: "hidden",
    }}>
      {/* Ambient glow orbs */}
      <div style={{ position: "absolute", top: "10%", left: "15%", width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(168,85,247,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "15%", right: "10%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)", pointerEvents: "none" }} />

      {/* Step indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 12, zIndex: 1 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.35)", letterSpacing: 2, textTransform: "uppercase" }}>
          Step {step + 1} of {STEPS.length}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ width: "100%", maxWidth: 440, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.06)", marginBottom: 48, overflow: "hidden", zIndex: 1 }}>
        <div style={{ width: `${progress}%`, height: "100%", borderRadius: 2, background: "linear-gradient(90deg, #a855f7, #6366f1)", transition: "width 0.5s cubic-bezier(0.4,0,0.2,1)", boxShadow: "0 0 12px rgba(168,85,247,0.4)" }} />
      </div>

      {/* Question */}
      <h1 style={{
        fontSize: "clamp(28px, 4vw, 38px)", fontWeight: 700, color: "#fff", textAlign: "center", margin: "0 0 6px",
        zIndex: 1, letterSpacing: -0.5,
        animation: `fadeUp 0.4s ease both`,
        key: step,
      }}>
        {current.question}
      </h1>
      {current.subtitle && (
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", textAlign: "center", margin: "0 0 36px", zIndex: 1, fontWeight: 300 }}>
          {current.subtitle}
        </p>
      )}
      {!current.subtitle && <div style={{ height: 36 }} />}

      {/* Content */}
      <div style={{
        display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 440, zIndex: 1,
        animation: `fadeUp 0.35s ease both`,
      }} key={`step-${step}`}>
        {current.type === "basics" ? (
          <>
            {/* Gender - large visual cards */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", marginBottom: 12, letterSpacing: 1.5, textTransform: "uppercase" }}>Gender</div>
              <div style={{ display: "flex", gap: 14 }}>
                {[
                  { val: "Male", icon: "👨", gradient: "linear-gradient(135deg, #6366f1, #4f46e5)" },
                  { val: "Female", icon: "👩", gradient: "linear-gradient(135deg, #ec4899, #d946ef)" },
                ].map(g => {
                  const sel = answers.gender === g.val;
                  return (
                    <button key={g.val} onClick={() => setAnswers(a => ({ ...a, gender: g.val }))} style={{
                      flex: 1, padding: "24px 0", borderRadius: 20,
                      border: sel ? "2px solid transparent" : "1px solid rgba(255,255,255,0.08)",
                      background: sel ? g.gradient : "rgba(255,255,255,0.03)",
                      color: sel ? "#fff" : "rgba(255,255,255,0.5)",
                      fontSize: 16, fontWeight: 700, cursor: "pointer",
                      fontFamily: "'League Spartan'", transition: "all 0.35s",
                      boxShadow: sel ? `0 8px 30px ${g.val === "Male" ? "rgba(99,102,241,0.35)" : "rgba(236,72,153,0.35)"}` : "none",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                      transform: sel ? "scale(1.03)" : "scale(1)",
                    }}>
                      <span style={{ fontSize: 36 }}>{g.icon}</span>
                      {g.val}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Age - visual pill grid */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", marginBottom: 12, letterSpacing: 1.5, textTransform: "uppercase" }}>Age Group</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {["18-24", "25-30", "31-35", "36-40", "41-50", "50+"].map((range, i) => {
                  const sel = answers.age === range;
                  return (
                    <button key={range} onClick={() => setAnswers(a => ({ ...a, age: range }))} style={{
                      padding: "16px 0", borderRadius: 14,
                      border: sel ? "2px solid #a855f7" : "1px solid rgba(255,255,255,0.08)",
                      background: sel ? "linear-gradient(135deg, rgba(168,85,247,0.2), rgba(99,102,241,0.15))" : "rgba(255,255,255,0.03)",
                      color: sel ? "#fff" : "rgba(255,255,255,0.5)",
                      fontSize: 15, fontWeight: 700, cursor: "pointer",
                      fontFamily: "'League Spartan'", transition: "all 0.3s",
                      boxShadow: sel ? "0 4px 20px rgba(168,85,247,0.2)" : "none",
                      animation: `fadeUp 0.3s ease both`,
                      animationDelay: `${i * 0.05}s`,
                    }}>{range}</button>
                  );
                })}
              </div>
            </div>

            {/* Height - glass card with slider */}
            <div style={{
              background: "rgba(255,255,255,0.03)", borderRadius: 20, padding: "20px 24px",
              border: "1px solid rgba(255,255,255,0.06)", marginBottom: 12,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.35)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>Height</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>optional</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 36, fontWeight: 800, background: "linear-gradient(135deg, #a855f7, #6366f1)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{answers.height || 170}</span>
                  <span style={{ fontSize: 14, fontWeight: 400, color: "rgba(255,255,255,0.3)", marginLeft: 4 }}>cm</span>
                </div>
              </div>
              <input type="range" min="140" max="200" value={answers.height || 170}
                onChange={e => setAnswers(a => ({ ...a, height: e.target.value }))}
                style={{ width: "100%", appearance: "none", height: 6, borderRadius: 3, background: `linear-gradient(90deg, #a855f7 ${((answers.height || 170) - 140) / 60 * 100}%, rgba(255,255,255,0.08) ${((answers.height || 170) - 140) / 60 * 100}%)`, outline: "none", cursor: "pointer" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "rgba(255,255,255,0.15)", marginTop: 6 }}>
                <span>140</span><span>160</span><span>180</span><span>200</span>
              </div>
            </div>

            {/* Weight - glass card with slider */}
            <div style={{
              background: "rgba(255,255,255,0.03)", borderRadius: 20, padding: "20px 24px",
              border: "1px solid rgba(255,255,255,0.06)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.35)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>Weight</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>optional</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 36, fontWeight: 800, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{answers.weight || 65}</span>
                  <span style={{ fontSize: 14, fontWeight: 400, color: "rgba(255,255,255,0.3)", marginLeft: 4 }}>kg</span>
                </div>
              </div>
              <input type="range" min="35" max="130" value={answers.weight || 65}
                onChange={e => setAnswers(a => ({ ...a, weight: e.target.value }))}
                style={{ width: "100%", appearance: "none", height: 6, borderRadius: 3, background: `linear-gradient(90deg, #6366f1 ${((answers.weight || 65) - 35) / 95 * 100}%, rgba(255,255,255,0.08) ${((answers.weight || 65) - 35) / 95 * 100}%)`, outline: "none", cursor: "pointer" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "rgba(255,255,255,0.15)", marginTop: 6 }}>
                <span>35</span><span>60</span><span>85</span><span>110</span><span>130</span>
              </div>
            </div>
          </>
        ) : current.key === "colors" ? (
          /* Color palette cards */
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {COLOR_GROUPS.map((cg, i) => {
              const isSelected = Array.isArray(selected) && selected.includes(cg.name);
              return (
                <button key={cg.name} onClick={() => handleSelect(cg.name)} style={{
                  padding: "20px 16px", borderRadius: 16, cursor: "pointer",
                  border: isSelected ? "2px solid #a855f7" : "1px solid rgba(255,255,255,0.08)",
                  background: isSelected ? "rgba(168,85,247,0.12)" : "rgba(255,255,255,0.03)",
                  backdropFilter: "blur(10px)",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
                  transition: "all 0.3s",
                  boxShadow: isSelected ? "0 0 25px rgba(168,85,247,0.15)" : "none",
                  animation: `fadeUp 0.3s ease both`,
                  animationDelay: `${i * 0.08}s`,
                }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    {cg.colors.map((c, j) => (
                      <div key={j} style={{
                        width: 24, height: 24, borderRadius: "50%",
                        background: c, border: "2px solid rgba(255,255,255,0.15)",
                        boxShadow: `0 0 8px ${c}44`,
                      }} />
                    ))}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: isSelected ? "#c4b5fd" : "rgba(255,255,255,0.6)" }}>
                    {cg.label}
                  </span>
                  {isSelected && <div style={{ width: 20, height: 20, borderRadius: "50%", background: "linear-gradient(135deg, #a855f7, #6366f1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>}
                </button>
              );
            })}
          </div>
        ) : current.key === "style" ? (
          /* Style identity cards */
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {current.options.map((option, i) => {
              const isSelected = selected === option;
              return (
                <button key={option} onClick={() => handleSelect(option)} style={{
                  padding: "28px 16px", borderRadius: 16, cursor: "pointer",
                  border: isSelected ? "2px solid #a855f7" : "1px solid rgba(255,255,255,0.08)",
                  background: isSelected ? "rgba(168,85,247,0.12)" : "rgba(255,255,255,0.03)",
                  backdropFilter: "blur(10px)",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                  transition: "all 0.3s",
                  boxShadow: isSelected ? "0 0 25px rgba(168,85,247,0.15), inset 0 1px 0 rgba(255,255,255,0.1)" : "none",
                  fontFamily: "'League Spartan'",
                  animation: `fadeUp 0.3s ease both`,
                  animationDelay: `${i * 0.08}s`,
                }}>
                  <div style={{ fontSize: 28 }}>{option === "Minimal" ? "◇" : option === "Street" ? "⚡" : option === "Athleisure" ? "🏃" : "👔"}</div>
                  <span style={{ fontSize: 16, fontWeight: 700, color: isSelected ? "#c4b5fd" : "rgba(255,255,255,0.7)" }}>{option}</span>
                </button>
              );
            })}
          </div>
        ) : current.key === "occasion" ? (
          /* Occasion pills */
          current.options.map((option, i) => {
            const isSelected = selected === option;
            const emoji = OCCASION_EMOJIS[option] || "✨";
            return (
              <button key={option} onClick={() => handleSelect(option)} style={{
                padding: "18px 24px", borderRadius: 14, cursor: "pointer",
                border: isSelected ? "2px solid #a855f7" : "1px solid rgba(255,255,255,0.08)",
                background: isSelected ? "rgba(168,85,247,0.12)" : "rgba(255,255,255,0.03)",
                backdropFilter: "blur(10px)",
                display: "flex", alignItems: "center", gap: 14,
                transition: "all 0.3s",
                boxShadow: isSelected ? "0 0 20px rgba(168,85,247,0.12)" : "none",
                fontFamily: "'League Spartan'",
                animation: `fadeUp 0.25s ease both`,
                animationDelay: `${i * 0.06}s`,
              }}>
                <span style={{ fontSize: 22 }}>{emoji}</span>
                <span style={{ fontSize: 16, fontWeight: 600, color: isSelected ? "#c4b5fd" : "rgba(255,255,255,0.65)" }}>{option}</span>
                {isSelected && <svg style={{ marginLeft: "auto" }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>}
              </button>
            );
          })
        ) : current.key === "fit" ? (
          /* Fit cards */
          current.options.map((option, i) => {
            const isSelected = selected === option;
            return (
              <button key={option} onClick={() => handleSelect(option)} style={{
                padding: "22px 24px", borderRadius: 16, cursor: "pointer",
                border: isSelected ? "2px solid #a855f7" : "1px solid rgba(255,255,255,0.08)",
                background: isSelected ? "rgba(168,85,247,0.12)" : "rgba(255,255,255,0.03)",
                backdropFilter: "blur(10px)",
                display: "flex", flexDirection: "column", gap: 4, textAlign: "left",
                transition: "all 0.3s",
                boxShadow: isSelected ? "0 0 20px rgba(168,85,247,0.12)" : "none",
                fontFamily: "'League Spartan'",
                animation: `fadeUp 0.25s ease both`,
                animationDelay: `${i * 0.08}s`,
              }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: isSelected ? "#c4b5fd" : "rgba(255,255,255,0.7)" }}>{option}</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", fontWeight: 300 }}>{FIT_DESC[option]}</span>
              </button>
            );
          })
        ) : (
          /* Budget & other options */
          current.options.map((option, i) => {
            const isSelected = current.multi
              ? (Array.isArray(selected) && selected.includes(option))
              : selected === option;
            return (
              <button key={option} onClick={() => handleSelect(option)} style={{
                padding: "18px 24px", borderRadius: 14, cursor: "pointer",
                border: isSelected ? "2px solid #a855f7" : "1px solid rgba(255,255,255,0.08)",
                background: isSelected ? "rgba(168,85,247,0.12)" : "rgba(255,255,255,0.03)",
                backdropFilter: "blur(10px)",
                color: isSelected ? "#c4b5fd" : "rgba(255,255,255,0.6)",
                fontSize: 16, fontWeight: 600, textAlign: "left",
                fontFamily: "'League Spartan'", transition: "all 0.3s",
                boxShadow: isSelected ? "0 0 20px rgba(168,85,247,0.12)" : "none",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                animation: `fadeUp 0.25s ease both`,
                animationDelay: `${i * 0.06}s`,
              }}>
                {option}
                {isSelected && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>}
              </button>
            );
          })
        )}
      </div>

      {/* Navigation */}
      <div style={{ display: "flex", gap: 12, marginTop: 36, width: "100%", maxWidth: 440, zIndex: 1 }}>
        {step > 0 && (
          <button onClick={goBack} style={{
            flex: 1, padding: "16px 0", borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)",
            backdropFilter: "blur(10px)",
            color: "rgba(255,255,255,0.6)", fontSize: 15, fontWeight: 600,
            cursor: "pointer", fontFamily: "'League Spartan'", transition: "all 0.2s",
          }}>Back</button>
        )}
        <button onClick={goNext} disabled={!canContinue} style={{
          flex: 2, padding: "16px 0", borderRadius: 14,
          border: "none",
          background: canContinue ? "linear-gradient(135deg, #a855f7, #6366f1)" : "rgba(255,255,255,0.06)",
          color: canContinue ? "#fff" : "rgba(255,255,255,0.25)",
          fontSize: 16, fontWeight: 700,
          cursor: canContinue ? "pointer" : "default",
          fontFamily: "'League Spartan'",
          transition: "all 0.3s",
          boxShadow: canContinue ? "0 8px 30px rgba(168,85,247,0.3)" : "none",
          letterSpacing: 0.5,
        }}>
          {step === STEPS.length - 1 ? "✦ Find My Style" : "Continue"}
        </button>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=League+Spartan:wght@300;400;500;600;700;800&display=swap');
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        input::placeholder{color:rgba(255,255,255,0.25);font-family:'League Spartan',sans-serif;font-weight:300;}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#a855f7,#6366f1);cursor:pointer;border:3px solid #0a0a1a;box-shadow:0 0 12px rgba(168,85,247,0.5);}
        input[type=range]::-moz-range-thumb{width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#a855f7,#6366f1);cursor:pointer;border:3px solid #0a0a1a;box-shadow:0 0 12px rgba(168,85,247,0.5);}
      `}</style>
    </div>
  );
}
