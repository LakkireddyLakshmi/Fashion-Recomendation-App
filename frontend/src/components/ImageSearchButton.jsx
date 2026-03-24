import { useState, useRef } from "react";

const API = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

export default function ImageSearchButton({ onResults, onLoading }) {
  const fileRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onLoading?.(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`${API}/api/image-search`, { method: "POST", body: fd });
      if (r.ok) {
        const data = await r.json();
        onResults?.(data.items || [], file);
      }
    } catch (err) {
      console.error("Image search failed:", err);
    } finally {
      onLoading?.(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <label style={{
      cursor: "pointer", display: "flex", alignItems: "center",
      padding: "8px 10px", borderRadius: 10,
      background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)",
      transition: "all 0.2s",
    }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.15)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
      title="Search by image"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
      </svg>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
    </label>
  );
}
