import { useState } from "react";

export default function AttributesSummary({ attributes, userEmail, onContinue }) {
  const [expanded, setExpanded] = useState(false);

  const fields = [
    { label: "Gender", value: attributes.gender, icon: "👤" },
    { label: "Estimated Age", value: attributes.estimated_age || attributes.age, icon: "🎂" },
    { label: "Skin Tone", value: attributes.skin_tone || attributes.skinTone, icon: "🎨" },
    { label: "Body Type", value: attributes.body_type || attributes.bodyType, icon: "📐" },
    { label: "Current Style", value: attributes.current_style || attributes.currentStyle, icon: "👔" },
    { label: "Hair Color", value: attributes.hair_color, icon: "💇" },
    { label: "Preferred Fit", value: attributes.recommended_fit || attributes.fit, icon: "📏" },
    { label: "Occasion", value: attributes.occasion_fit || attributes.occasionFit, icon: "🎯" },
    { label: "Season", value: attributes.season_fit || attributes.seasonFit, icon: "🌤" },
    { label: "Fashion Score", value: attributes.fashion_score || attributes.fashionScore, icon: "⭐" },
  ].filter(f => f.value);

  const colors = attributes.color_palette || attributes.preferred_colors || attributes.colors || [];
  const categories = attributes.clothing_detected || attributes.categories || [];
  const keywords = attributes.style_keywords || attributes.styleKeywords || [];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#fff",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "40px 20px",
      fontFamily: "'League Spartan', system-ui, sans-serif",
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 32, maxWidth: 500 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: "#1a1a1a", display: "flex", alignItems: "center",
          justifyContent: "center", margin: "0 auto 16px",
          fontSize: 20, fontWeight: 800, color: "#fff",
        }}>H</div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "#1a1a1a", margin: "0 0 8px" }}>
          Your Style Profile
        </h1>
        <p style={{ fontSize: 14, color: "#999", margin: 0 }}>
          Here's what our AI detected from your photo
        </p>
      </div>

      {/* User Info */}
      <div style={{
        width: "100%", maxWidth: 500,
        background: "#f8f9fa", borderRadius: 16,
        padding: "20px 24px", marginBottom: 20,
        border: "1px solid #e5e7eb",
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
          User Info
        </div>
        <div style={{ fontSize: 15, color: "#1a1a1a", fontWeight: 500 }}>
          {userEmail}
        </div>
      </div>

      {/* Detected Attributes Grid */}
      <div style={{
        width: "100%", maxWidth: 500,
        background: "#fff", borderRadius: 16,
        padding: "20px 24px", marginBottom: 20,
        border: "1px solid #e5e7eb",
        boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>
          Detected Attributes ({fields.length})
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {fields.slice(0, expanded ? fields.length : 6).map((f, i) => (
            <div key={i} style={{
              background: "#f8f9fa", borderRadius: 10,
              padding: "12px 14px",
              border: "1px solid #f0f0f0",
            }}>
              <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>
                {f.icon} {f.label}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1a", textTransform: "capitalize" }}>
                {String(f.value).replace(/_/g, " ")}
              </div>
            </div>
          ))}
        </div>
        {fields.length > 6 && (
          <button onClick={() => setExpanded(!expanded)} style={{
            marginTop: 12, background: "none", border: "none",
            color: "#7c3aed", fontSize: 13, fontWeight: 600,
            cursor: "pointer", fontFamily: "'League Spartan'",
          }}>
            {expanded ? "Show less" : `Show all ${fields.length} attributes`}
          </button>
        )}
      </div>

      {/* Colors */}
      {colors.length > 0 && (
        <div style={{
          width: "100%", maxWidth: 500,
          background: "#fff", borderRadius: 16,
          padding: "20px 24px", marginBottom: 20,
          border: "1px solid #e5e7eb",
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
            Recommended Colors
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {colors.map((c, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "#f8f9fa", borderRadius: 20,
                padding: "6px 12px", border: "1px solid #f0f0f0",
              }}>
                <div style={{
                  width: 14, height: 14, borderRadius: "50%",
                  background: c.toLowerCase().replace(/\s/g, ""),
                  border: "1px solid #e5e7eb",
                }} />
                <span style={{ fontSize: 12, color: "#555" }}>{c}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Categories */}
      {categories.length > 0 && (
        <div style={{
          width: "100%", maxWidth: 500,
          background: "#fff", borderRadius: 16,
          padding: "20px 24px", marginBottom: 20,
          border: "1px solid #e5e7eb",
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
            Detected Clothing
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {categories.map((c, i) => (
              <span key={i} style={{
                background: "#1a1a1a", color: "#fff",
                borderRadius: 20, padding: "6px 14px",
                fontSize: 12, fontWeight: 600,
              }}>{c}</span>
            ))}
          </div>
        </div>
      )}

      {/* Style Keywords */}
      {keywords.length > 0 && (
        <div style={{
          width: "100%", maxWidth: 500,
          background: "#fff", borderRadius: 16,
          padding: "20px 24px", marginBottom: 32,
          border: "1px solid #e5e7eb",
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
            Style Keywords
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {keywords.map((k, i) => (
              <span key={i} style={{
                background: "#f3f0ff", color: "#7c3aed",
                borderRadius: 20, padding: "6px 14px",
                fontSize: 12, fontWeight: 500,
                border: "1px solid #e9e0ff",
              }}>{k}</span>
            ))}
          </div>
        </div>
      )}

      {/* Continue Button */}
      <button onClick={onContinue} style={{
        width: "100%", maxWidth: 500,
        padding: "16px 0", background: "#1a1a1a",
        color: "#fff", border: "none", borderRadius: 12,
        fontSize: 16, fontWeight: 700, cursor: "pointer",
        fontFamily: "'League Spartan'", letterSpacing: 0.5,
      }}>
        Find My Perfect Matches
      </button>

      <p style={{ fontSize: 12, color: "#ccc", marginTop: 12 }}>
        Powered by Claude Vision AI
      </p>
    </div>
  );
}
