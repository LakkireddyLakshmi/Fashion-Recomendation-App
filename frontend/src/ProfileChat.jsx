import React, { useState, useEffect, useRef, useCallback } from "react";

const CHAT_BASE = import.meta.env.VITE_CHAT_BASE_URL || "";
const CHAT_KEY = import.meta.env.VITE_CHAT_API_KEY || "";
const API = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

export default function ProfileChat({ email, name, onProfileComplete }) {
  const bottomRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState(undefined);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const extractProfile = (text) => {
    const jsonMatch = text.match(/\{[\s\S]*?"profile_complete"\s*:\s*true[\s\S]*?\}/);
    if (!jsonMatch) return null;
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
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
          email,
          name,
          gender: profileData.gender,
          age: Number(profileData.age) || null,
          location: profileData.city,
          body_measurements: {
            height, weight,
            body_type: profileData.bodyType || "",
            build: fitMap[fit] || "",
            bmi,
          },
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
          headers: recHeaders,
          signal: AbortSignal.timeout(60000),
        });
        if (rr.ok) {
          const rd = await rr.json();
          recs = rd.recommendations || rd.items || [];
        }
      } catch {
        try {
          const rr = await fetch(`${API}/api/recommendations/trending?limit=20`, {
            signal: AbortSignal.timeout(30000),
          });
          if (rr.ok) {
            const rd = await rr.json();
            recs = rd.recommendations || rd.items || [];
          }
        } catch {}
      }

      onProfileComplete(profileData, recs);
    } catch (e) {
      console.error("Save profile error:", e);
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`, role: "assistant",
        text: "There was an issue saving your profile. Don't worry, let me try again...",
      }]);
    } finally {
      setSaving(false);
    }
  };

  // Direct fetch-based streaming (handles agent_message events)
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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CHAT_KEY}`,
        },
        body: JSON.stringify({
          inputs: {},
          query: text,
          response_mode: "streaming",
          conversation_id: conversationId || "",
          user: email,
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
                updated[updated.length - 1] = {
                  id: data.message_id || assistantMsg.id,
                  role: "assistant",
                  text: currentResponse,
                };
                return updated;
              });
            }

            if (data.event === "message_end") {
              if (data.conversation_id) setConversationId(data.conversation_id);
            }

            if (data.event === "error") {
              throw new Error(data.message || "Stream error");
            }
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
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          text: "Sorry, something went wrong. Please try again.",
        };
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

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "#fff",
      display: "flex", flexDirection: "column",
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    }}>
      {/* Header */}
      <div style={{
        padding: "16px 28px",
        display: "flex", alignItems: "center", gap: 12,
        borderBottom: "1px solid #f0f0f0",
      }}>
        <div style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 36, height: 36, borderRadius: 10,
          background: "linear-gradient(135deg, #7c3aed, #a855f7)",
        }}>
          <span style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>H</span>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#111" }}>HueIQ</div>
          <div style={{ color: "#999", fontSize: 12 }}>Style Profile Setup</div>
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: "auto", padding: "24px 28px",
        display: "flex", flexDirection: "column", gap: 16,
      }}>
        {messages.length === 0 && !loading && (
          <div style={{ margin: "auto", textAlign: "center", maxWidth: 460 }}>
            <div style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 64, height: 64, borderRadius: 18,
              background: "linear-gradient(135deg, #7c3aed, #a855f7)",
              marginBottom: 20,
            }}>
              <span style={{ color: "#fff", fontSize: 28, fontWeight: 700 }}>H</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#111", marginBottom: 8 }}>
              Welcome to HueIQ
            </div>
            <div style={{ color: "#888", fontSize: 15, lineHeight: 1.5, marginBottom: 24 }}>
              I'll help you build your style profile so we can find your perfect fashion matches.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              {["👋 Say hi to get started", "🎨 I love fashion", "👗 Help me find my style"].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => { setInput(""); sendMessage(suggestion.replace(/^[^\s]+ /, "")); }}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 100,
                    border: "1px solid #e8e8e8",
                    background: "#fafafa",
                    color: "#555",
                    fontSize: 14,
                    cursor: "pointer",
                    transition: "all 0.2s",
                    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
                  }}
                  onMouseEnter={(e) => { e.target.style.background = "#f0f0f0"; e.target.style.borderColor = "#ccc"; }}
                  onMouseLeave={(e) => { e.target.style.background = "#fafafa"; e.target.style.borderColor = "#e8e8e8"; }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const displayText = msg.role === "assistant" ? cleanText(msg.text) : msg.text;
          if (!displayText) return null;
          return (
            <div key={msg.id} style={{
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
              gap: 10, alignItems: "flex-end",
            }}>
              {msg.role === "assistant" && (
                <div style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  background: "linear-gradient(135deg, #7c3aed, #a855f7)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>H</span>
                </div>
              )}
              <div style={{
                maxWidth: "70%",
                padding: "12px 18px",
                borderRadius: msg.role === "user" ? "20px 20px 4px 20px" : "20px 20px 20px 4px",
                background: msg.role === "user" ? "#111" : "#f5f5f5",
                color: msg.role === "user" ? "#fff" : "#222",
                fontSize: 15,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}>
                {displayText || "..."}
              </div>
            </div>
          );
        })}

        {loading && messages.length > 0 && messages[messages.length - 1]?.text === "" && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: "linear-gradient(135deg, #7c3aed, #a855f7)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>H</span>
            </div>
            <div style={{
              padding: "12px 18px", borderRadius: "20px 20px 20px 4px",
              background: "#f5f5f5", color: "#999", fontSize: 14,
            }}>
              <span className="typing-dots">Thinking...</span>
            </div>
          </div>
        )}

        {saving && (
          <div style={{
            textAlign: "center", padding: "24px 0",
            color: "#888", fontSize: 15,
          }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: "#f5f5f5", padding: "12px 24px", borderRadius: 100,
            }}>
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
              Saving your profile & finding matches...
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input Bar */}
      <div style={{
        padding: "16px 28px 24px",
        borderTop: "1px solid #f0f0f0",
      }}>
        <div style={{
          display: "flex", gap: 10, alignItems: "center",
          background: "#f5f5f5", borderRadius: 100,
          padding: "6px 6px 6px 22px",
        }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder={saving ? "Saving your profile..." : "Type a message..."}
            disabled={loading || saving}
            style={{
              flex: 1,
              padding: "10px 0",
              border: "none",
              background: "transparent",
              color: "#111",
              fontSize: 15,
              fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
              outline: "none",
            }}
          />
          <button
            onClick={handleSend}
            disabled={loading || saving || !input.trim()}
            style={{
              width: 40, height: 40,
              borderRadius: "50%",
              border: "none",
              background: loading || saving || !input.trim() ? "#ddd" : "#111",
              color: "#fff",
              fontSize: 18,
              cursor: loading || saving ? "wait" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.2s",
            }}
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
