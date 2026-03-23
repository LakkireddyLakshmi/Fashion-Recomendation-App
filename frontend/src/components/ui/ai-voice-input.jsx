import { Mic, MicOff } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "../../lib/utils";

export function AIVoiceInput({
  onStart,
  onStop,
  onTranscript,
  visualizerBars = 48,
  className,
}) {
  const [submitted, setSubmitted] = useState(false);
  const [time, setTime] = useState(0);
  const [isClient, setIsClient] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef(null);

  useEffect(() => { setIsClient(true); }, []);

  useEffect(() => {
    let intervalId;
    if (submitted) {
      onStart?.();
      intervalId = setInterval(() => setTime((t) => t + 1), 1000);
    } else {
      if (time > 0) onStop?.(time);
      setTime(0);
    }
    return () => clearInterval(intervalId);
  }, [submitted]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Use ref to track listening state (avoids stale closure in onend)
  const isListeningRef = useRef(false);
  const transcriptRef = useRef("");

  const stopListening = useCallback(() => {
    isListeningRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (_) { /* ignore */ }
      recognitionRef.current = null;
    }
    setSubmitted(false);
  }, []);

  const startListening = useCallback(() => {
    // Check HTTPS (Web Speech API requires secure context)
    const isSecure = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert("Speech recognition is not supported in this browser. Please use Chrome.");
      return;
    }
    if (!isSecure) {
      alert("Voice input requires HTTPS. Please use the deployed site.");
      return;
    }

    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;
    isListeningRef.current = true;

    recognition.onresult = (event) => {
      let finalText = "", interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += t;
        else interim += t;
      }
      const text = finalText || interim;
      transcriptRef.current = text;
      setTranscript(text);
      onTranscript?.(text);
    };

    recognition.onerror = (e) => {
      console.warn("Speech error:", e.error);
      isListeningRef.current = false;
      recognitionRef.current = null;
      setSubmitted(false);
      if (e.error === "not-allowed") {
        alert("Microphone access denied. Please allow it in browser settings.");
      } else if (e.error === "network") {
        alert("Speech recognition requires HTTPS. Please use the deployed site.");
      }
    };

    recognition.onend = () => {
      // Auto-restart if still listening (continuous mode can stop unexpectedly)
      if (isListeningRef.current && recognitionRef.current) {
        try { recognition.start(); } catch (_) { /* ignore */ }
      } else {
        setSubmitted(false);
      }
    };

    try {
      recognition.start();
      setSubmitted(true);
      setTranscript("");
      transcriptRef.current = "";
    } catch (err) {
      console.error("Speech start failed:", err);
      isListeningRef.current = false;
    }
  }, [onTranscript]);

  const handleClick = useCallback(() => {
    if (submitted) {
      stopListening();
    } else {
      startListening();
    }
  }, [submitted, stopListening, startListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    };
  }, []);

  return (
    <div className={cn("w-full py-4", className)}>
      <div className="relative max-w-xl w-full mx-auto flex items-center flex-col gap-4">
        <button
          className={cn(
            "group w-20 h-20 rounded-2xl flex items-center justify-center transition-colors cursor-pointer",
            submitted ? "bg-white/10" : "bg-none hover:bg-white/10"
          )}
          type="button"
          onClick={handleClick}
        >
          {submitted ? (
            <div
              className="w-7 h-7 rounded-sm animate-spin bg-white cursor-pointer"
              style={{ animationDuration: "3s" }}
            />
          ) : (
            <Mic className="w-8 h-8 text-white/70" />
          )}
        </button>

        <span className={cn(
          "font-mono text-lg transition-opacity duration-300",
          submitted ? "text-white/70" : "text-white/30"
        )}>
          {formatTime(time)}
        </span>

        <div className="h-8 w-72 flex items-center justify-center gap-0.5">
          {[...Array(visualizerBars)].map((_, i) => (
            <div
              key={i}
              className={cn(
                "w-0.5 rounded-full transition-all duration-300",
                submitted
                  ? "bg-white/50 animate-pulse"
                  : "bg-white/10 h-1"
              )}
              style={
                submitted && isClient
                  ? { height: `${20 + Math.random() * 80}%`, animationDelay: `${i * 0.05}s` }
                  : undefined
              }
            />
          ))}
        </div>

        {transcript && (
          <p className="text-sm text-white/60 max-w-xs text-center mt-2">
            "{transcript}"
          </p>
        )}

        <p className="text-xs text-white/40 mt-2">
          {submitted ? "Listening... click to stop" : "Click to speak"}
        </p>
      </div>
    </div>
  );
}
