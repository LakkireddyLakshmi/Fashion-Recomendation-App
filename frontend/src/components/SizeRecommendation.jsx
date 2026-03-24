import React from "react";

/**
 * Maps height (cm) + weight (kg) + bodyType to a recommended size.
 */
function getRecommendedSize(height, weight, bodyType) {
  const h = parseFloat(height);
  const w = parseFloat(weight);
  if (!h || !w) return null;

  const bmi = w / ((h / 100) ** 2);
  const bt = (bodyType || "").toLowerCase();

  // Base size from BMI
  let size;
  if (bmi < 18.5) size = "S";
  else if (bmi < 22) size = "M";
  else if (bmi < 27) size = "L";
  else if (bmi < 32) size = "XL";
  else size = "XXL";

  // Adjust for height
  if (h > 185 && size === "M") size = "L";
  if (h > 185 && size === "S") size = "M";
  if (h < 160 && size === "L") size = "M";

  // Adjust for body type
  if (bt === "athletic" || bt === "curvy") {
    if (size === "S") size = "M";
    else if (size === "M") size = "L";
  }
  if (bt === "slim") {
    if (size === "L") size = "M";
    else if (size === "XL") size = "L";
  }
  if (bt === "plus") {
    if (size === "L") size = "XL";
    else if (size === "M") size = "L";
  }

  return size;
}

export default function SizeRecommendation({ height, weight, bodyType }) {
  const recommended = getRecommendedSize(height, weight, bodyType);
  if (!recommended) return null;

  return (
    <div style={{
      background: "linear-gradient(135deg, rgba(168,85,247,0.15), rgba(99,102,241,0.1))",
      border: "1px solid rgba(168,85,247,0.3)",
      borderRadius: 14,
      padding: "12px 18px",
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginBottom: 4,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: "linear-gradient(135deg, #7c3aed, #a855f7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 15, fontWeight: 800, color: "#fff",
        fontFamily: "'League Spartan', sans-serif",
        flexShrink: 0,
      }}>
        {recommended}
      </div>
      <div>
        <div style={{
          fontSize: 14, fontWeight: 700, color: "#c084fc",
          fontFamily: "'League Spartan', sans-serif",
        }}>
          We recommend size {recommended} for you
        </div>
        <div style={{
          fontSize: 11, color: "rgba(255,255,255,0.4)",
          fontFamily: "'League Spartan', sans-serif",
          marginTop: 2,
        }}>
          Based on your height, weight & body type
        </div>
      </div>
    </div>
  );
}

export { getRecommendedSize };
