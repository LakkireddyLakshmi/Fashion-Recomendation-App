import { useState, useEffect, useRef, useCallback } from "react";

const CHAT_BASE = import.meta.env.VITE_CHAT_BASE_URL || "";
const CHAT_KEY = import.meta.env.VITE_CHAT_API_KEY || "";
const API = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";


export default function ProfileChat({ email, name, onProfileComplete }) {
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const sessionId = useRef(`${email}-${Date.now()}`);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState(undefined);
  const [saving, setSaving] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  const toggleMic = () => {
    if (isListening) {
      if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; }
      setIsListening(false);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Speech recognition not supported. Use Chrome."); return; }
    const isSecure = location.protocol === "https:" || location.hostname === "localhost";
    if (!isSecure) { alert("Voice requires HTTPS. Use the deployed site."); return; }
    const rec = new SR();
    rec.lang = "en-US"; rec.interimResults = true; rec.continuous = true;
    recognitionRef.current = rec;
    rec.onresult = (e) => {
      let final = "", interim = "";
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      setInput(final || interim);
    };
    rec.onerror = (e) => {
      setIsListening(false); recognitionRef.current = null;
      if (e.error === "not-allowed") alert("Microphone access denied.");
      else if (e.error === "network") alert("Voice requires HTTPS.");
    };
    rec.onend = () => { if (isListening && recognitionRef.current) try { rec.start(); } catch(_){} };
    try { rec.start(); setIsListening(true); } catch(_) {}
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!loading && !saving) inputRef.current?.focus();
  }, [loading, saving]);

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
          password: sessionStorage.getItem("hueiq_password") || email + "_hueiq2024",
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

  const cleanText = (text) => {
    return text.replace(/```json[\s\S]*?```/g, "").replace(/\{[\s\S]*?"profile_complete"[\s\S]*?\}/g, "").trim();
  };


  const hasMessages = messages.length > 0;

  const inputBar = (
    <div style={{
      maxWidth: 680, width: "100%", margin: "0 auto", boxSizing: "border-box",
    }}>
      <div style={{
        display: "flex", alignItems: "flex-end", gap: 0,
        background: "#f4f4f4", borderRadius: 24,
        padding: "6px 6px 6px 20px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
        transition: "box-shadow 0.2s",
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
          }}
          placeholder={isListening ? "\uD83C\uDF99 Listening..." : saving ? "Saving..." : "Message HueIQ..."}
          disabled={loading || saving}
          rows={1}
          style={{
            flex: 1, padding: "10px 0", border: "none", background: "transparent",
            color: "#111", fontSize: 15, lineHeight: 1.5,
            fontFamily: "'Inter', system-ui, sans-serif",
            outline: "none", resize: "none",
            maxHeight: 120, overflowY: "auto",
          }}
          onInput={(e) => {
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
          }}
        />
        {/* Mic button — inline, glows when listening */}
        <button onClick={toggleMic} disabled={loading || saving}
          style={{
            width: 40, height: 40, borderRadius: "50%", border: "none",
            background: isListening ? "rgba(99,102,241,0.15)" : "transparent",
            color: isListening ? "#6366f1" : "#999",
            fontSize: 17, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.2s ease",
            flexShrink: 0,
            boxShadow: isListening ? "0 0 0 4px rgba(99,102,241,0.2)" : "none",
            animation: isListening ? "micPulse 2s ease-in-out infinite" : "none",
          }}
          title={isListening ? "Stop listening" : "Speak"}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill={isListening ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
        </button>
        {/* Send button */}
        <button onClick={handleSend} disabled={loading || saving || !input.trim()}
          style={{
            width: 36, height: 36, borderRadius: "50%", border: "none",
            background: loading || saving || !input.trim() ? "transparent" : "#111",
            color: loading || saving || !input.trim() ? "#bbb" : "#fff",
            fontSize: 16, cursor: loading || saving ? "wait" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.15s ease",
            flexShrink: 0,
          }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    </div>
  );

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "#fff",
      display: "flex", flexDirection: "column",
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      {/* Centered layout when no messages */}
      {!hasMessages && !saving ? (
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          padding: "40px 24px",
          gap: 32,
        }}>
          <div style={{ textAlign: "center", maxWidth: 520 }}>
            <p style={{ color: "#888", fontSize: 15, lineHeight: 1.6, margin: 0 }}>
              Tell me about yourself — your age, gender, style preferences, favorite colors, and body type — so I can find your perfect fashion matches.
            </p>
          </div>

          {inputBar}
        </div>
      ) : (
        <>
          {/* Messages area */}
          <div style={{
            flex: 1, overflowY: "auto", padding: "28px 24px",
            display: "flex", flexDirection: "column", gap: 24,
            maxWidth: 720, width: "100%", margin: "0 auto",
          }}>
            {messages.map((msg) => {
              const displayText = msg.role === "assistant" ? cleanText(msg.text) : msg.text;
              if (!displayText) return null;
              return (
                <div key={msg.id} style={{
                  display: "flex",
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                  gap: 12, alignItems: "flex-start",
                }}>
                  {msg.role === "assistant" && (
                    <div style={{
                      width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                      background: "#111", display: "flex", alignItems: "center", justifyContent: "center",
                      marginTop: 2,
                    }}>
                      <span style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>H</span>
                    </div>
                  )}
                  <div style={{
                    maxWidth: "75%",
                    padding: msg.role === "user" ? "12px 18px" : "0",
                    borderRadius: msg.role === "user" ? "20px 20px 4px 20px" : "0",
                    background: msg.role === "user" ? "#111" : "transparent",
                    color: msg.role === "user" ? "#fff" : "#333",
                    fontSize: 15, lineHeight: 1.7, whiteSpace: "pre-wrap",
                  }}>
                    {displayText}
                  </div>
                </div>
              );
            })}

            {loading && messages.length > 0 && messages[messages.length - 1]?.text === "" && (
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  background: "#111", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <span style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>H</span>
                </div>
                <div style={{ display: "flex", gap: 5, paddingTop: 8 }}>
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
                  background: "#f5f5f5", padding: "14px 28px", borderRadius: 100,
                }}>
                  <span style={{ display: "inline-block", animation: "spin 1s linear infinite", fontSize: 18 }}>⟳</span>
                  <span style={{ color: "#555", fontSize: 14, fontWeight: 500 }}>
                    Building your wardrobe...
                  </span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Bottom input */}
          <div style={{ padding: "12px 24px 20px" }}>
            {inputBar}
          </div>
        </>
      )}

      <style>{`
        @keyframes micPulse {
          0%, 100% { box-shadow: 0 0 0 4px rgba(99,102,241,0.2); }
          50% { box-shadow: 0 0 0 8px rgba(99,102,241,0.1); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
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
