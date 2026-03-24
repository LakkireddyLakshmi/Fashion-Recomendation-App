import { useState } from "react";

const API = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

export default function TryOnModal({ item, onClose }) {
  const [userImage, setUserImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUserImage(file);
    setPreview(URL.createObjectURL(file));
    setResult(null);
    setError("");
  };

  const handleGenerate = async () => {
    if (!userImage) return;
    setLoading(true);
    setError("");
    try {
      const reader = new FileReader();
      const base64 = await new Promise((resolve) => {
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(userImage);
      });
      const productImg = item?.primary_image_url || item?.images?.[0]?.image_url || "";
      const r = await fetch(`${API}/api/tryon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_image: base64,
          product_image: productImg,
          catalog_item_id: item?.catalog_item_id || item?.id || "",
          category: item?.category || "",
        }),
      });
      const data = await r.json();
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data.result_image || data.image_url || data.output || data.session_id);
      }
    } catch (err) {
      setError("Try-on service unavailable. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 300,
      background: "rgba(0,0,0,0.9)", backdropFilter: "blur(20px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
    }}>
      <div style={{
        background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 24, maxWidth: 700, width: "100%", padding: 32,
        maxHeight: "90vh", overflowY: "auto",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <h2 style={{ color: "#fff", fontSize: 22, fontWeight: 700, margin: 0, fontFamily: "'League Spartan',sans-serif" }}>
              Virtual Try-On
            </h2>
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, margin: "4px 0 0" }}>
              See how this looks on you
            </p>
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.1)", border: "none", color: "#fff",
            borderRadius: "50%", width: 36, height: 36, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
          }}>×</button>
        </div>

        {/* Product being tried on */}
        <div style={{ display: "flex", gap: 12, marginBottom: 24, alignItems: "center" }}>
          <img src={item?.primary_image_url || item?.images?.[0]?.image_url} alt=""
            style={{ width: 60, height: 80, objectFit: "cover", borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)" }} />
          <div>
            <p style={{ color: "#fff", fontSize: 14, fontWeight: 500, margin: 0 }}>{item?.name}</p>
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, margin: "2px 0 0" }}>{item?.category}</p>
          </div>
        </div>

        {/* Upload area */}
        {!preview ? (
          <label style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            border: "2px dashed rgba(255,255,255,0.15)", borderRadius: 16,
            padding: "48px 24px", cursor: "pointer",
            transition: "all 0.2s", background: "rgba(255,255,255,0.02)",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(168,85,247,0.4)"; e.currentTarget.style.background = "rgba(168,85,247,0.05)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 15, marginTop: 12, fontWeight: 500 }}>
              Upload your photo
            </p>
            <p style={{ color: "rgba(255,255,255,0.25)", fontSize: 12, marginTop: 4 }}>
              Full body photo works best
            </p>
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
          </label>
        ) : (
          <div>
            {/* Preview + Result */}
            <div style={{ display: "grid", gridTemplateColumns: result ? "1fr 1fr" : "1fr", gap: 16, marginBottom: 20 }}>
              <div style={{ position: "relative" }}>
                <img src={preview} alt="Your photo" style={{
                  width: "100%", borderRadius: 16, border: "1px solid rgba(255,255,255,0.1)",
                  maxHeight: 400, objectFit: "cover",
                }} />
                <span style={{
                  position: "absolute", bottom: 8, left: 8, background: "rgba(0,0,0,0.7)",
                  color: "#fff", fontSize: 11, padding: "4px 10px", borderRadius: 8,
                }}>Your photo</span>
              </div>
              {result && (
                <div style={{ position: "relative" }}>
                  <img src={result} alt="Try-on result" style={{
                    width: "100%", borderRadius: 16, border: "1px solid rgba(168,85,247,0.3)",
                    maxHeight: 400, objectFit: "cover",
                  }} />
                  <span style={{
                    position: "absolute", bottom: 8, left: 8, background: "rgba(124,58,237,0.8)",
                    color: "#fff", fontSize: 11, padding: "4px 10px", borderRadius: 8,
                  }}>Try-On Result</span>
                </div>
              )}
            </div>

            {error && (
              <div style={{
                color: "#f87171", fontSize: 13, background: "rgba(248,113,113,0.1)",
                border: "1px solid rgba(248,113,113,0.2)", borderRadius: 12,
                padding: "10px 16px", marginBottom: 16,
              }}>{error}</div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => { setPreview(null); setUserImage(null); setResult(null); setError(""); }}
                style={{
                  padding: "12px 20px", borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.1)", background: "transparent",
                  color: "#fff", fontSize: 14, cursor: "pointer", fontFamily: "inherit",
                }}>
                Change Photo
              </button>
              <button onClick={handleGenerate} disabled={loading}
                style={{
                  flex: 1, padding: "12px 20px", borderRadius: 12, border: "none",
                  background: loading ? "rgba(168,85,247,0.3)" : "linear-gradient(135deg, #7c3aed, #a855f7)",
                  color: "#fff", fontSize: 14, fontWeight: 600, cursor: loading ? "wait" : "pointer",
                  fontFamily: "inherit",
                  boxShadow: loading ? "none" : "0 4px 16px rgba(124,58,237,0.3)",
                }}>
                {loading ? "Generating..." : result ? "Try Again" : "Generate Try-On"}
              </button>
            </div>
          </div>
        )}

        {typeof result === "string" && result.length < 100 && !result.startsWith("http") && !result.startsWith("data:") && (
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginTop: 16, textAlign: "center" }}>
            Session ID: {result} — Processing may take a moment
          </div>
        )}
      </div>
    </div>
  );
}
