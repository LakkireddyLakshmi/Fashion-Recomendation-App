import { Mic } from "lucide-react";
import { useState, useEffect, useRef } from "react";
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

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setSubmitted(false);
    // Send final transcript
    if (transcript) {
      onTranscript?.(transcript);
    }
  };

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert("Speech recognition not supported in this browser.");
      return;
    }

    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      let finalText = "", interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += t;
        else interim += t;
      }
      const text = finalText || interim;
      setTranscript(text);
      onTranscript?.(text);
    };

    recognition.onerror = (e) => {
      console.warn("Speech error:", e.error);
      setSubmitted(false);
      recognitionRef.current = null;
      if (e.error === "not-allowed") {
        alert("Microphone access denied. Please allow it in browser settings.");
      }
    };

    recognition.onend = () => {
      // If continuous mode ends unexpectedly, restart
      if (submitted && recognitionRef.current) {
        try { recognition.start(); } catch (_) { /* ignore */ }
      }
    };

    try {
      recognition.start();
      setSubmitted(true);
      setTranscript("");
    } catch (err) {
      console.error("Speech failed:", err);
    }
  };

  const handleClick = () => {
    if (submitted) {
      stopListening();
    } else {
      startListening();
    }
  };

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
