import React, { useState } from "react";

const API = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

const fieldDefs = [
  { key: "name", label: "Name", type: "text" },
  { key: "email", label: "Email", type: "text", readOnly: true },
  { key: "gender", label: "Gender", type: "select", options: ["Male", "Female", "Non-binary"] },
  { key: "age", label: "Age", type: "number" },
  { key: "height", label: "Height (cm)", type: "number" },
  { key: "weight", label: "Weight (kg)", type: "number" },
  { key: "bodyType", label: "Body Type", type: "select", options: ["Slim", "Athletic", "Average", "Curvy", "Plus"] },
  { key: "fit", label: "Preferred Fit", type: "select", options: ["Slim", "Regular", "Loose", "Oversized"] },
  { key: "styleIdentity", label: "Style Identity", type: "select", options: ["Minimal", "Street", "Athleisure", "Formal", "Casual", "Ethnic"] },
  { key: "budgetId", label: "Budget Range", type: "select", options: [
    { value: "under1000", label: "Under ₹1K" },
    { value: "1k_3k", label: "₹1K – 3K" },
    { value: "3k_5k", label: "₹3K – 5K" },
    { value: "5k_10k", label: "₹5K – 10K" },
    { value: "above10k", label: "₹10K+" },
    { value: "any", label: "Any Budget" },
  ]},
];

const tagFieldDefs = [
  { key: "colors", label: "Preferred Colors" },
  { key: "categories", label: "Preferred Categories" },
];

export default function UserProfile({ profile, onUpdate, onClose }) {
  // Normalize gender to match dropdown options
  const normalizeGender = (g) => {
    const l = (g || "").toLowerCase();
    if (["male", "men", "man", "m"].includes(l)) return "Male";
    if (["female", "women", "woman", "f", "ladies"].includes(l)) return "Female";
    if (l === "non-binary") return "Non-binary";
    return g || "";
  };
  const normalizeFit = (f) => {
    const l = (f || "").toLowerCase();
    if (l === "slim") return "Slim";
    if (l === "regular") return "Regular";
    if (l === "loose") return "Loose";
    if (l === "oversized") return "Oversized";
    return f || "";
  };
  const normalizeBodyType = (b) => {
    const l = (b || "").toLowerCase();
    if (l === "slim") return "Slim";
    if (l === "athletic") return "Athletic";
    if (l === "average") return "Average";
    if (l === "curvy") return "Curvy";
    if (l === "plus" || l === "plus size") return "Plus";
    return b || "";
  };
  const normalizeStyle = (s) => {
    const l = (s || "").toLowerCase();
    const map = { minimal:"Minimal", street:"Street", athleisure:"Athleisure", formal:"Formal", casual:"Casual", ethnic:"Ethnic" };
    return map[l] || s || "";
  };
  const [form, setForm] = useState({
    ...profile,
    gender: normalizeGender(profile?.gender),
    fit: normalizeFit(profile?.fit),
    bodyType: normalizeBodyType(profile?.bodyType),
    styleIdentity: normalizeStyle(profile?.styleIdentity),
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tagInput, setTagInput] = useState({});

  const set = (k, v) => {
    if (k === "budgetId") {
      const budgetRanges = { under1000: [0,1000], "1k_3k": [1000,3000], "3k_5k": [3000,5000], "5k_10k": [5000,10000], above10k: [10000,50000], any: [0,50000] };
      const [min, max] = budgetRanges[v] || [0, 50000];
      setForm((p) => ({ ...p, budgetId: v, budgetMin: min, budgetMax: max }));
    } else {
      setForm((p) => ({ ...p, [k]: v }));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = sessionStorage.getItem("hueiq_token") || localStorage.getItem("hueiq_token");
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      await fetch(`${API}/api/save-profile`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: form.email,
          name: form.name,
          gender: form.gender,
          age: form.age ? parseInt(form.age) : null,
          body_measurements: {
            height: form.height,
            weight: form.weight,
            bodyType: form.bodyType,
          },
          preferred_colors: form.colors || [],
          preferred_categories: form.categories || [],
          style_preferences: [form.styleIdentity, form.fit].filter(Boolean),
        }),
      });
      // Persist to localStorage
      localStorage.setItem("hueiq_profile", JSON.stringify(form));
      onUpdate && onUpdate(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Save profile failed:", e);
    } finally {
      setSaving(false);
    }
  };

  const addTag = (key) => {
    const val = (tagInput[key] || "").trim();
    if (!val) return;
    const arr = form[key] || [];
    if (!arr.includes(val)) set(key, [...arr, val]);
    setTagInput((p) => ({ ...p, [key]: "" }));
  };

  const removeTag = (key, val) => {
    set(key, (form[key] || []).filter((t) => t !== val));
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 400, backdropFilter: "blur(4px)" }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "min(480px, 96vw)",
        background: "#0f0f1a", borderLeft: "1px solid rgba(255,255,255,0.1)",
        zIndex: 401, display: "flex", flexDirection: "column",
        fontFamily: "'League Spartan', sans-serif",
        boxShadow: "-8px 0 40px rgba(0,0,0,0.5)",
        animation: "slideInRight 0.28s ease both",
      }}>
        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>Your Profile</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>Manage your preferences</div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 8, width: 34, height: 34, color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
            x
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Avatar / initials */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
            <div style={{
              width: 64, height: 64, borderRadius: "50%",
              background: "linear-gradient(135deg, #7c3aed, #a855f7)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 26, fontWeight: 700, color: "#fff",
            }}>
              {(form.name || "U").charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>{form.name || "User"}</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>{form.email}</div>
            </div>
          </div>

          {/* Fields */}
          {fieldDefs.map(({ key, label, type, options, readOnly }) => (
            <div key={key}>
              <label style={{ display: "block", fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>
                {label}
              </label>
              {type === "select" ? (
                <select
                  value={form[key] || ""}
                  onChange={(e) => set(key, e.target.value)}
                  style={{
                    width: "100%", padding: "12px 16px", borderRadius: 12,
                    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                    color: "#fff", fontSize: 15, fontFamily: "'League Spartan'",
                    outline: "none", appearance: "none",
                  }}
                >
                  <option value="" style={{ background: "#1a1a2e" }}>Select...</option>
                  {options.map((o) => {
                    const val = typeof o === "object" ? o.value : o;
                    const lbl = typeof o === "object" ? o.label : o;
                    return <option key={val} value={val} style={{ background: "#1a1a2e" }}>{lbl}</option>;
                  })}
                </select>
              ) : (
                <input
                  type={type}
                  value={form[key] || ""}
                  readOnly={readOnly}
                  onChange={(e) => set(key, e.target.value)}
                  style={{
                    width: "100%", padding: "12px 16px", borderRadius: 12,
                    background: readOnly ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: readOnly ? "rgba(255,255,255,0.4)" : "#fff",
                    fontSize: 15, fontFamily: "'League Spartan'",
                    outline: "none", boxSizing: "border-box",
                  }}
                />
              )}
            </div>
          ))}

          {/* Tag fields */}
          {tagFieldDefs.map(({ key, label }) => (
            <div key={key}>
              <label style={{ display: "block", fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>
                {label}
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {(form[key] || []).map((tag) => (
                  <span key={tag} style={{
                    background: "rgba(168,85,247,0.2)", border: "1px solid rgba(168,85,247,0.3)",
                    borderRadius: 20, padding: "4px 12px", fontSize: 13, color: "#c084fc",
                    display: "flex", alignItems: "center", gap: 6,
                  }}>
                    {tag}
                    <button onClick={() => removeTag(key, tag)} style={{ background: "none", border: "none", color: "#c084fc", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}>x</button>
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={tagInput[key] || ""}
                  onChange={(e) => setTagInput((p) => ({ ...p, [key]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag(key))}
                  placeholder={`Add ${label.toLowerCase()}...`}
                  style={{
                    flex: 1, padding: "10px 14px", borderRadius: 10,
                    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                    color: "#fff", fontSize: 14, fontFamily: "'League Spartan'",
                    outline: "none",
                  }}
                />
                <button onClick={() => addTag(key)} style={{
                  background: "rgba(168,85,247,0.2)", border: "1px solid rgba(168,85,247,0.3)",
                  borderRadius: 10, padding: "0 16px", color: "#c084fc",
                  fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'League Spartan'",
                }}>
                  Add
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 24px 24px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              width: "100%",
              background: saved ? "#16a34a" : "linear-gradient(135deg, #7c3aed, #a855f7)",
              border: "none", borderRadius: 14, padding: "14px 0",
              color: "#fff", fontSize: 16, fontWeight: 700,
              cursor: saving ? "wait" : "pointer",
              fontFamily: "'League Spartan'", letterSpacing: 0.5,
              boxShadow: saved ? "0 4px 20px rgba(22,163,74,0.4)" : "0 4px 20px rgba(124,58,237,0.4)",
              transition: "all 0.3s",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving..." : saved ? "Saved!" : "Save Profile"}
          </button>
        </div>
      </div>
    </>
  );
}
