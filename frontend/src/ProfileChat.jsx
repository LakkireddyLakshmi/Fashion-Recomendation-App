import React, { useState, useEffect, useRef, useCallback } from "react";
import { XpectrumChat } from "@xpectrum/sdk";
import { BG1 } from "./Fashionai";

const API = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

export default function ProfileChat({ email, name, onProfileComplete }) {
  const chatRef = useRef(null);
  const bottomRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState(undefined);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    chatRef.current = new XpectrumChat({
      baseUrl: import.meta.env.VITE_CHAT_BASE_URL,
      apiKey: import.meta.env.VITE_CHAT_API_KEY,
      user: email,
    });
    return () => chatRef.current?.destroy();
  }, [email]);

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

      // Fetch recommendations
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

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || loading || !chatRef.current) return;

    setLoading(true);
    const userMsg = { id: `user-${Date.now()}`, role: "user", text };
    const assistantMsg = { id: `asst-${Date.now()}`, role: "assistant", text: "" };
    setMessages(prev => [...prev, userMsg, assistantMsg]);

    let fullResponse = "";

    await chatRef.current.sendMessage(text, {
      conversationId,
      onMessage: (responseText, messageId, convId) => {
        setConversationId(convId);
        fullResponse = responseText;
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { id: messageId, role: "assistant", text: responseText };
          return updated;
        });
      },
      onError: (err) => {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            text: "Sorry, something went wrong. Please try again.",
          };
          return updated;
        });
        setLoading(false);
      },
      onCompleted: () => {
        setLoading(false);
        const profile = extractProfile(fullResponse);
        if (profile) {
          saveProfile(profile);
        }
      },
    });
  }, [conversationId, loading]);

  const handleSend = () => {
    if (!input.trim()) return;
    sendMessage(input);
    setInput("");
  };

  // Clean display text — remove the JSON block from visible messages
  const cleanText = (text) => {
    return text.replace(/```json[\s\S]*?```/g, "").replace(/\{[\s\S]*?"profile_complete"[\s\S]*?\}/g, "").trim();
  };

  return (
    <div style={{
      position: "fixed", inset: 0,
      backgroundImage: `url(${BG1})`, backgroundSize: "cover", backgroundPosition: "center",
      display: "flex", flexDirection: "column",
      fontFamily: "'League Spartan', sans-serif",
    }}>
      {/* Header */}
      <div style={{
        padding: "18px 28px",
        display: "flex", alignItems: "center", gap: 12,
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}>
        <div style={{
          background: "linear-gradient(135deg, #7c3aed, #a855f7)",
          borderRadius: 12, padding: "8px 14px",
          color: "#fff", fontWeight: 700, fontSize: 16,
        }}>
          ✦ HueIQ
        </div>
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 15 }}>
          Style Profile Setup
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: "auto", padding: "20px 28px",
        display: "flex", flexDirection: "column", gap: 14,
      }}>
        {messages.length === 0 && !loading && (
          <div style={{ margin: "auto", textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 10 }}>✦</div>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 20 }}>
              Let's build your style profile
            </div>
            <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 14, marginTop: 6 }}>
              Type "hi" to get started
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
            }}>
              <div style={{
                maxWidth: "80%",
                padding: "12px 18px",
                borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                background: msg.role === "user"
                  ? "linear-gradient(135deg, #7c3aed, #a855f7)"
                  : "rgba(255,255,255,0.08)",
                color: "#fff",
                fontSize: 15,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                backdropFilter: msg.role === "assistant" ? "blur(20px)" : "none",
                border: msg.role === "assistant" ? "1px solid rgba(255,255,255,0.08)" : "none",
              }}>
                {displayText || "..."}
              </div>
            </div>
          );
        })}

        {saving && (
          <div style={{
            textAlign: "center", padding: "20px 0",
            color: "rgba(255,255,255,0.6)", fontSize: 16,
          }}>
            <div style={{ marginBottom: 8, fontSize: 24 }}>✦</div>
            Saving your profile & finding your perfect matches...
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: "16px 28px 24px",
        borderTop: "1px solid rgba(255,255,255,0.08)",
      }}>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder={saving ? "Saving your profile..." : "Type a message..."}
            disabled={loading || saving}
            style={{
              flex: 1,
              padding: "14px 22px",
              borderRadius: 100,
              border: "none",
              background: "rgba(255,255,255,0.1)",
              backdropFilter: "blur(50px)",
              color: "#fff",
              fontSize: 16,
              fontWeight: 300,
              fontFamily: "'League Spartan', sans-serif",
              outline: "none",
            }}
          />
          <button
            onClick={handleSend}
            disabled={loading || saving || !input.trim()}
            style={{
              padding: "14px 24px",
              borderRadius: 100,
              border: "none",
              background: "linear-gradient(135deg, #7c3aed, #a855f7)",
              color: "#fff",
              fontSize: 16,
              fontWeight: 700,
              fontFamily: "'League Spartan', sans-serif",
              cursor: loading || saving ? "wait" : "pointer",
              opacity: loading || saving || !input.trim() ? 0.5 : 1,
              transition: "opacity 0.2s",
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
