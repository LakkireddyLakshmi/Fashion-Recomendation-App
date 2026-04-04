import { useEffect, useRef } from "react";
import { ChatWidget } from "@xpectrum/sdk";

export default function XpectrumChatWidget() {
  const widgetRef = useRef(null);

  useEffect(() => {
    widgetRef.current = new ChatWidget({
      apiKey: import.meta.env.VITE_CHAT_API_KEY,
      baseUrl: import.meta.env.VITE_CHAT_BASE_URL,
      position: "bottom-right",
      buttonColor: "#7C3AED",
      theme: "dark",
      windowWidth: 400,
      windowHeight: 600,
    });

    return () => widgetRef.current?.destroy();
  }, []);

  return null;
}
