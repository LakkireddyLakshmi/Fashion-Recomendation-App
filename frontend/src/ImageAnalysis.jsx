import { useState, useRef } from "react";

const API = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

export default function ImageAnalysis({ onAnalysisComplete }) {
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [gender, setGender] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null); // Store analysis results
  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const streamRef = useRef(null);

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImage(file);
    setPreview(URL.createObjectURL(file));
    setError(null);
  };

  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = stream;
      setCameraOpen(true);
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      }, 100);
    } catch (err) {
      setError("Camera access denied. Please allow camera permissions.");
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      setImage(new File([blob], "capture.jpg", { type: "image/jpeg" }));
      setPreview(canvas.toDataURL("image/jpeg"));
      closeCamera();
    }, "image/jpeg", 0.9);
  };

  const closeCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  };

  const analyzeImage = async () => {
    if (!image || !gender) {
      setError(!gender ? "Please select your gender" : "Please upload or capture an image");
      return;
    }

    setAnalyzing(true);
    setError(null);
    setProgress("Uploading image...");

    try {
      // Send image to backend for Claude Vision analysis
      const formData = new FormData();
      formData.append("file", image);

      setProgress("Analyzing your style with AI...");

      const res = await fetch(`${API}/api/analyze-image?gender=${gender}`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Analysis failed");
      const attributes = await res.json();
      attributes.gender = gender;
      attributes.image_analysis = true;
      console.log("Claude Vision result:", attributes);

      setProgress("Done!");
      setResults(attributes);
      setAnalyzing(false);

    } catch (err) {
      console.error("Analysis error:", err);
      setError(err.message || "Analysis failed. Please try again.");
      setAnalyzing(false);
    }
  };

  // ── RESULTS VIEW ──
  if (results) {
    const fields = [
      { label: "Gender", value: results.gender },
      { label: "Age", value: results.estimated_age },
      { label: "Skin Tone", value: results.skin_tone },
      { label: "Body Type", value: results.body_type },
      { label: "Style", value: results.current_style },
      { label: "Hair", value: results.hair_color },
      { label: "Fit", value: results.recommended_fit },
      { label: "Occasion", value: results.occasion_fit },
      { label: "Season", value: results.season_fit },
      { label: "Score", value: results.fashion_score ? `${results.fashion_score}/10` : null },
    ].filter(f => f.value);
    const colors = results.color_palette || results.preferred_colors || [];
    const clothing = results.clothing_detected || [];
    const keywords = results.style_keywords || [];

    return (
      <div style={{ minHeight: "100vh", background: "#fff", fontFamily: "'League Spartan', system-ui, sans-serif", padding: "32px 20px", display: "flex", flexDirection: "column", alignItems: "center" }}>
        {/* Photo + Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 32, maxWidth: 500, width: "100%" }}>
          {preview && (
            <img src={preview} alt="" style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover", border: "3px solid #1a1a1a" }} />
          )}
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1a1a1a", margin: "0 0 4px" }}>Your Style Profile</h1>
            <p style={{ fontSize: 13, color: "#999", margin: 0 }}>AI-detected from your photo</p>
          </div>
        </div>

        {/* Attributes Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 500, width: "100%", marginBottom: 20 }}>
          {fields.map((f, i) => (
            <div key={i} style={{ background: "#f8f9fa", borderRadius: 10, padding: "12px 14px", border: "1px solid #f0f0f0" }}>
              <div style={{ fontSize: 10, color: "#999", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 }}>{f.label}</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1a", textTransform: "capitalize" }}>{String(f.value).replace(/_/g, " ")}</div>
            </div>
          ))}
        </div>

        {/* Colors */}
        {colors.length > 0 && (
          <div style={{ maxWidth: 500, width: "100%", marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Recommended Colors</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {colors.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, background: "#f8f9fa", borderRadius: 16, padding: "4px 10px", border: "1px solid #f0f0f0", fontSize: 12, color: "#555" }}>
                  <div style={{ width: 12, height: 12, borderRadius: "50%", background: c.toLowerCase().replace(/\s/g, ""), border: "1px solid #ddd" }} />
                  {c}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Clothing Detected */}
        {clothing.length > 0 && (
          <div style={{ maxWidth: 500, width: "100%", marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Detected Clothing</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {clothing.map((c, i) => (
                <span key={i} style={{ background: "#1a1a1a", color: "#fff", borderRadius: 16, padding: "5px 12px", fontSize: 12, fontWeight: 600 }}>{c}</span>
              ))}
            </div>
          </div>
        )}

        {/* Style Keywords */}
        {keywords.length > 0 && (
          <div style={{ maxWidth: 500, width: "100%", marginBottom: 32 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Style Keywords</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {keywords.map((k, i) => (
                <span key={i} style={{ background: "#f3f0ff", color: "#7c3aed", borderRadius: 16, padding: "5px 12px", fontSize: 12, fontWeight: 500, border: "1px solid #e9e0ff" }}>{k}</span>
              ))}
            </div>
          </div>
        )}

        {/* Continue Button */}
        <button onClick={() => onAnalysisComplete(results)} style={{
          width: "100%", maxWidth: 500, padding: "16px 0",
          background: "#1a1a1a", color: "#fff", border: "none",
          borderRadius: 12, fontSize: 16, fontWeight: 700,
          cursor: "pointer", fontFamily: "'League Spartan'",
        }}>
          Find My Perfect Matches
        </button>
      </div>
    );
  }

  // ── UPLOAD VIEW ──
  return (
    <div style={{
      minHeight: "100vh",
      background: "#fff",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      fontFamily: "'League Spartan', system-ui, sans-serif",
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: "#1a1a1a", display: "flex", alignItems: "center",
          justifyContent: "center", margin: "0 auto 16px",
          fontSize: 20, fontWeight: 800, color: "#fff",
        }}>H</div>
        <h1 style={{ color: "#1a1a1a", fontSize: 32, fontWeight: 700, margin: 0 }}>
          {analyzing ? progress : "Let's analyze your style"}
        </h1>
        <p style={{ color: "#999", fontSize: 16, marginTop: 8 }}>
          {analyzing ? "This takes a few seconds..." : "Upload or capture a photo for personalized recommendations"}
        </p>
      </div>

      {/* Gender Selection */}
      {!analyzing && (
        <div style={{ display: "flex", gap: 16, marginBottom: 32 }}>
          {["Male", "Female"].map(g => (
            <button
              key={g}
              onClick={() => setGender(g.toLowerCase())}
              style={{
                padding: "12px 32px",
                borderRadius: 30,
                border: gender === g.toLowerCase() ? "2px solid #1a1a1a" : "2px solid #e5e7eb",
                background: gender === g.toLowerCase() ? "#1a1a1a" : "#fff",
                color: gender === g.toLowerCase() ? "#fff" : "#555",
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "'League Spartan'",
                transition: "all 0.2s",
              }}
            >
              {g}
            </button>
          ))}
        </div>
      )}

      {/* Image Area */}
      {!analyzing && (
        <div style={{
          width: "100%",
          maxWidth: 400,
          aspectRatio: "3/4",
          borderRadius: 20,
          overflow: "hidden",
          border: "2px dashed #e5e7eb",
          background: "#f8f9fa",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          marginBottom: 24,
        }}>
          {cameraOpen ? (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <div style={{
                position: "absolute",
                bottom: 20,
                display: "flex",
                gap: 12,
              }}>
                <button
                  onClick={capturePhoto}
                  style={{
                    width: 64, height: 64, borderRadius: "50%",
                    border: "4px solid #fff",
                    background: "#1a1a1a",
                    cursor: "pointer",
                  }}
                />
                <button
                  onClick={closeCamera}
                  style={{
                    width: 48, height: 48, borderRadius: "50%",
                    border: "none",
                    background: "rgba(0,0,0,0.4)",
                    color: "#fff",
                    fontSize: 20,
                    cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >x</button>
              </div>
            </>
          ) : preview ? (
            <>
              <img
                src={preview}
                alt="Preview"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <button
                onClick={() => { setImage(null); setPreview(null); }}
                style={{
                  position: "absolute",
                  top: 12,
                  right: 12,
                  width: 32, height: 32,
                  borderRadius: "50%",
                  border: "none",
                  background: "rgba(0,0,0,0.6)",
                  color: "#fff",
                  fontSize: 16,
                  cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >x</button>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: 40 }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5" style={{ marginBottom: 16 }}>
                <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p style={{ color: "#999", fontSize: 14, margin: 0 }}>
                Upload a photo or take a selfie
              </p>
            </div>
          )}
        </div>
      )}

      {/* Analyzing Animation */}
      {analyzing && (
        <div style={{
          width: "100%",
          maxWidth: 400,
          padding: 40,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
        }}>
          {preview && (
            <img
              src={preview}
              alt="Analyzing"
              style={{
                width: 200,
                height: 200,
                borderRadius: "50%",
                objectFit: "cover",
                border: "4px solid #1a1a1a",
                animation: "pulse 2s ease-in-out infinite",
              }}
            />
          )}
          <div style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 10, height: 10,
                borderRadius: "50%",
                background: "#1a1a1a",
                animation: `bounce 1.4s ease-in-out ${i * 0.2}s infinite`,
              }} />
            ))}
          </div>
          <style>{`
            @keyframes pulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.05);opacity:0.8} }
            @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
          `}</style>
        </div>
      )}

      {/* Action Buttons */}
      {!analyzing && (
        <div style={{ display: "flex", gap: 12, width: "100%", maxWidth: 400 }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            style={{ display: "none" }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            style={{
              flex: 1,
              padding: "14px 0",
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: "#fff",
              color: "#1a1a1a",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "'League Spartan'",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            Upload
          </button>
          <button
            onClick={openCamera}
            style={{
              flex: 1,
              padding: "14px 0",
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: "#fff",
              color: "#1a1a1a",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "'League Spartan'",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            Camera
          </button>
        </div>
      )}

      {/* Analyze Button */}
      {!analyzing && preview && gender && (
        <button
          onClick={analyzeImage}
          style={{
            width: "100%",
            maxWidth: 400,
            padding: "16px 0",
            borderRadius: 12,
            border: "none",
            background: "#1a1a1a",
            color: "#fff",
            fontSize: 17,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "'League Spartan'",
            marginTop: 16,
            letterSpacing: 0.5,
          }}
        >
          Analyze My Style
        </button>
      )}

      {/* Error */}
      {error && (
        <p style={{ color: "#ef4444", fontSize: 14, marginTop: 12 }}>{error}</p>
      )}
    </div>
  );
}
