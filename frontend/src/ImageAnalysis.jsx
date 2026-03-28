import { useState, useRef } from "react";

const API = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

export default function ImageAnalysis({ onAnalysisComplete }) {
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [gender, setGender] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState(null);
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

      // Step 5: Pass to parent
      setTimeout(() => {
        onAnalysisComplete(attributes);
      }, 500);

    } catch (err) {
      console.error("Analysis error:", err);
      setError(err.message || "Analysis failed. Please try again.");
      setAnalyzing(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#000",
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
          background: "#7c3aed", display: "flex", alignItems: "center",
          justifyContent: "center", margin: "0 auto 16px",
          fontSize: 20, fontWeight: 800, color: "#fff",
        }}>H</div>
        <h1 style={{ color: "#fff", fontSize: 32, fontWeight: 700, margin: 0 }}>
          {analyzing ? progress : "Let's analyze your style"}
        </h1>
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 16, marginTop: 8 }}>
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
                border: gender === g.toLowerCase() ? "2px solid #7c3aed" : "2px solid rgba(255,255,255,0.15)",
                background: gender === g.toLowerCase() ? "rgba(124,58,237,0.2)" : "rgba(255,255,255,0.05)",
                color: gender === g.toLowerCase() ? "#a78bfa" : "rgba(255,255,255,0.6)",
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
          border: "2px dashed rgba(255,255,255,0.15)",
          background: "rgba(255,255,255,0.03)",
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
                    background: "rgba(124,58,237,0.8)",
                    cursor: "pointer",
                  }}
                />
                <button
                  onClick={closeCamera}
                  style={{
                    width: 48, height: 48, borderRadius: "50%",
                    border: "none",
                    background: "rgba(255,255,255,0.2)",
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
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" style={{ marginBottom: 16 }}>
                <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, margin: 0 }}>
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
                border: "4px solid #7c3aed",
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
                background: "#7c3aed",
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
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.05)",
              color: "#fff",
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
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.05)",
              color: "#fff",
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
            background: "linear-gradient(135deg, #7c3aed, #a855f7)",
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
