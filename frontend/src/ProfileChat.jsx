import { useState, useEffect, useRef, useCallback } from "react";

const CHAT_BASE = import.meta.env.VITE_CHAT_BASE_URL || "";
const CHAT_KEY = import.meta.env.VITE_CHAT_API_KEY || "";
const API = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

const PROFILE_STEPS = [
  "Gender", "Age", "Colors", "Categories", "Fit", "Height", "Weight", "Body Type"
];

export default function ProfileChat({ email, name, onProfileComplete }) {
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const sessionId = useRef(`${email}-${Date.now()}`);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState(undefined);
  const [saving, setSaving] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!loading && !saving) inputRef.current?.focus();
  }, [loading, saving]);

  useEffect(() => {
    const userMsgCount = messages.filter(m => m.role === "user").length;
    setCurrentStep(Math.min(userMsgCount, PROFILE_STEPS.length));
  }, [messages]);

  const extractProfile = (text) => {
    const jsonMatch = text.match(/\{[\s\S]*?"profile_complete"\s*:\s*true[\s\S]*?\}/);
    if (!jsonMatch) return null;
    try { return JSON.parse(jsonMatch[0]); } catch { return null; }
  };

  const saveProfile = async (profileData) => {
    setSaving(true);
    try {
      const token = sessionStorage.getItem("hueiq_token");
      const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
      const height = Number(profileData.height) || 0;
      const weight = Number(profileData.weight) || 0;
      const bmi = height && weight ? parseFloat((weight / (height / 100) ** 2).toFixed(1)) : null;
      const fitMap = { slim: "slim", regular: "athletic", athletic: "athletic", loose: "average", oversized: "average" };
      const fit = (profileData.fit || "regular").toLowerCase();

      const r = await fetch(`${API}/api/save-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          email, name,
          gender: profileData.gender,
          age: Number(profileData.age) || null,
          location: profileData.city,
          body_measurements: { height, weight, body_type: profileData.bodyType || "", build: fitMap[fit] || "", bmi },
          preferred_colors: (profileData.colors || []).map(c => c.toLowerCase()),
          preferred_categories: (profileData.categories || []).map(c => c.toLowerCase()),
          style_preferences: [fit].filter(Boolean),
          preferred_season: (() => {
            const m = new Date().getMonth() + 1;
            if (m >= 3 && m <= 5) return "spring";
            if (m >= 6 && m <= 8) return "summer";
            if (m >= 9 && m <= 11) return "fall";
            return "winter";
          })(),
        }),
      });
      if (!r.ok) throw new Error("Failed to save profile");
      const data = await r.json();
      if (data.token) sessionStorage.setItem("hueiq_token", data.token);

      const recToken = sessionStorage.getItem("hueiq_token");
      const recHeaders = recToken ? { Authorization: `Bearer ${recToken}` } : {};
      let recs = [];
      try {
        const rr = await fetch(`${API}/api/recommendations?limit=48&include_breakdown=true`, {
          headers: recHeaders, signal: AbortSignal.timeout(60000),
        });
        if (rr.ok) { const rd = await rr.json(); recs = rd.recommendations || rd.items || []; }
      } catch {
        try {
          const rr = await fetch(`${API}/api/recommendations/trending?limit=20`, { signal: AbortSignal.timeout(30000) });
          if (rr.ok) { const rd = await rr.json(); recs = rd.recommendations || rd.items || []; }
        } catch {}
      }
      onProfileComplete(profileData, recs);
    } catch (e) {
      console.error("Save profile error:", e);
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`, role: "assistant",
        text: "There was an issue saving your profile. Please try again.",
      }]);
    } finally { setSaving(false); }
  };

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || loading || !CHAT_BASE || !CHAT_KEY) return;
    setLoading(true);
    const userMsg = { id: `user-${Date.now()}`, role: "user", text };
    const assistantMsg = { id: `asst-${Date.now()}`, role: "assistant", text: "" };
    setMessages(prev => [...prev, userMsg, assistantMsg]);

    let fullResponse = "";
    try {
      const res = await fetch(`${CHAT_BASE}/chat-messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${CHAT_KEY}` },
        body: JSON.stringify({
          inputs: {}, query: text, response_mode: "streaming",
          conversation_id: conversationId || "", user: sessionId.current,
        }),
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          try {
            const data = JSON.parse(jsonStr);
            if (data.event === "agent_message" || data.event === "message") {
              fullResponse += data.answer || "";
              if (data.conversation_id) setConversationId(data.conversation_id);
              const currentResponse = fullResponse;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { id: data.message_id || assistantMsg.id, role: "assistant", text: currentResponse };
                return updated;
              });
            }
            if (data.event === "message_end" && data.conversation_id) setConversationId(data.conversation_id);
            if (data.event === "error") throw new Error(data.message || "Stream error");
          } catch (parseErr) {
            if (parseErr.message?.includes("Stream error") || parseErr.message?.includes("API error")) throw parseErr;
          }
        }
      }
      setLoading(false);
      const profile = extractProfile(fullResponse);
      if (profile) saveProfile(profile);
    } catch (err) {
      console.error("Chat error:", err);
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], text: "Something went wrong. Please try again." };
        return updated;
      });
      setLoading(false);
    }
  }, [conversationId, loading, email]);

  const handleSend = () => {
    if (!input.trim()) return;
    sendMessage(input);
    setInput("");
  };

  const toggleVoice = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser. Please use Chrome.");
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognitionRef.current = recognition;
    let finalText = "";

    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event) => {
      let interim = "";
      finalText = "";
      for (let i = 0; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += t;
        else interim += t;
      }
      setInput(finalText || interim);
    };
    recognition.onerror = (e) => {
      console.error("Speech error:", e.error);
      setIsListening(false);
      if (e.error === "not-allowed") {
        alert("Microphone access denied. Please allow it in browser settings.");
      } else if (e.error === "network") {
        alert("Speech recognition requires HTTPS. Please use the deployed site or Chrome with localhost.");
      }
    };
    recognition.onend = () => setIsListening(false);

    try { recognition.start(); }
    catch (e) { console.error("Speech start failed:", e); setIsListening(false); }
  };

  const cleanText = (text) => {
    return text.replace(/```json[\s\S]*?```/g, "").replace(/\{[\s\S]*?"profile_complete"[\s\S]*?\}/g, "").trim();
  };

  const progress = (currentStep / PROFILE_STEPS.length) * 100;

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "#fff",
      display: "flex", flexDirection: "column",
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: "1px solid #f0f0f0",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#111" }}>HueIQ</div>
            <div style={{ color: "#bbb", fontSize: 11 }}>Building your style profile</div>
          </div>
        </div>

        {/* Progress */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "#bbb", fontWeight: 500 }}>
            Step {currentStep} of {PROFILE_STEPS.length}
          </span>
          <div style={{
            width: 100, height: 3, borderRadius: 100,
            background: "#f0f0f0", overflow: "hidden",
          }}>
            <div style={{
              width: `${progress}%`, height: "100%", borderRadius: 100,
              background: "#111",
              transition: "width 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
            }} />
          </div>
        </div>
      </div>

      {/* Step pills */}
      <div style={{
        padding: "10px 24px", display: "flex", gap: 4, overflowX: "auto",
        borderBottom: "1px solid #f8f8f8",
      }}>
        {PROFILE_STEPS.map((step, i) => (
          <div key={step} style={{
            padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 500,
            whiteSpace: "nowrap", flexShrink: 0,
            background: i < currentStep ? "#111" : i === currentStep ? "#f5f5f5" : "#fafafa",
            color: i < currentStep ? "#fff" : i === currentStep ? "#555" : "#ddd",
            transition: "all 0.3s ease",
          }}>
            {i < currentStep ? "✓" : ""} {step}
          </div>
        ))}
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: "auto", padding: "28px 24px",
        display: "flex", flexDirection: "column", gap: 20,
        maxWidth: 720, width: "100%", margin: "0 auto",
      }}>
        {messages.length === 0 && !loading && (
          <div style={{ margin: "auto", textAlign: "center", maxWidth: 480 }}>
            <p style={{
              color: "#555", fontSize: 16, lineHeight: 1.7, margin: "0",
            }}>
              Can you please share a few details about yourself, such as your age, gender, height (cm), weight (kg), preferred categories, favorite colors, preferred fit, and body type?
            </p>
          </div>
        )}

        {messages.map((msg) => {
          const displayText = msg.role === "assistant" ? cleanText(msg.text) : msg.text;
          if (!displayText) return null;
          return (
            <div key={msg.id} style={{
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
              gap: 10, alignItems: "flex-start",
            }}>
              <div style={{
                maxWidth: "75%",
                padding: "12px 18px",
                borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                background: msg.role === "user" ? "#111" : "#f5f5f5",
                color: msg.role === "user" ? "#fff" : "#222",
                fontSize: 15, lineHeight: 1.6, whiteSpace: "pre-wrap",
              }}>
                {displayText}
              </div>
            </div>
          );
        })}

        {loading && messages.length > 0 && messages[messages.length - 1]?.text === "" && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{
              padding: "14px 18px", borderRadius: "18px 18px 18px 4px",
              background: "#f5f5f5", display: "flex", gap: 5,
            }}>
              <span style={{ ...dotStyle, animationDelay: "0s" }} />
              <span style={{ ...dotStyle, animationDelay: "0.15s" }} />
              <span style={{ ...dotStyle, animationDelay: "0.3s" }} />
            </div>
          </div>
        )}

        {saving && (
          <div style={{ textAlign: "center", padding: "28px 0" }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 10,
              background: "#f5f5f5", padding: "12px 24px", borderRadius: 100,
            }}>
              <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>
              <span style={{ color: "#666", fontSize: 14, fontWeight: 500 }}>
                Building your wardrobe...
              </span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: "16px 24px 24px",
        maxWidth: 720, width: "100%", margin: "0 auto", boxSizing: "border-box",
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 0,
          border: "1px solid #e5e5e5", borderRadius: 14,
          padding: "4px 4px 4px 18px",
          transition: "border-color 0.2s",
        }}
          onFocus={() => {}}
        >
          {/* Mic button */}
          <button onClick={toggleVoice} disabled={loading || saving}
            style={{
              width: 36, height: 36, borderRadius: 8, border: "none",
              background: isListening ? "#ef4444" : "transparent",
              color: isListening ? "#fff" : "#999",
              fontSize: 18, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.2s ease",
              flexShrink: 0, marginRight: 4,
              animation: isListening ? "micPulse 1.5s ease-in-out infinite" : "none",
            }}
            title={isListening ? "Stop listening" : "Speak your answer"}
          >
            🎤
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder={isListening ? "Listening..." : saving ? "Saving..." : "Type or speak your answer..."}
            disabled={loading || saving}
            style={{
              flex: 1, padding: "12px 0", border: "none", background: "transparent",
              color: "#111", fontSize: 15,
              fontFamily: "'Inter', system-ui, sans-serif",
              outline: "none",
            }}
          />
          <button onClick={handleSend} disabled={loading || saving || !input.trim()}
            style={{
              width: 40, height: 40, borderRadius: 10, border: "none",
              background: loading || saving || !input.trim() ? "#f0f0f0" : "#111",
              color: loading || saving || !input.trim() ? "#ccc" : "#fff",
              fontSize: 18, cursor: loading || saving ? "wait" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s ease",
            }}>
            ↑
          </button>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes micPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
          50% { box-shadow: 0 0 0 8px rgba(239,68,68,0); }
        }
      `}</style>
    </div>
  );
}

const dotStyle = {
  width: 7, height: 7, borderRadius: "50%",
  background: "#bbb", display: "inline-block",
  animation: "pulse 1s ease-in-out infinite",
};
