import { createFileRoute } from "@tanstack/react-router";

type SpeakBody = { text?: string; lang?: "ar" | "en" };

// Strip emoji, symbols, and decoration so TTS reads only actual words.
function cleanForTTS(input: string): string {
  return input
    // Emoji + pictographs + symbols + dingbats
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, " ")
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, " ")
    .replace(/[\u2600-\u27BF]/g, " ")
    // Variation selectors + ZWJ
    .replace(/[\uFE00-\uFE0F\u200D]/g, "")
    // Markdown-y decoration
    .replace(/[*_`~#>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const Route = createFileRoute("/api/speak")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const { text, lang } = (await request.json()) as SpeakBody;
        const clean = cleanForTTS(text ?? "");
        if (!clean) return new Response("Empty text", { status: 400 });

        const isArabic = lang === "ar";

        // Arabic: Gemini-TTS (natural Arabic pronunciation).
        // English: OpenAI gpt-4o-mini-tts (natural English).
        const body = isArabic
          ? {
              model: "google/gemini-2.5-flash-tts",
              stream_format: "sse",
              contents: [{ role: "user", parts: [{ text: `اقرأ النص التالي بلهجة عربية فصيحة واضحة وطبيعية: ${clean}` }] }],
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
                },
              },
            }
          : {
              model: "openai/gpt-4o-mini-tts",
              input: clean,
              voice: "alloy",
              stream_format: "sse",
              response_format: "pcm",
              instructions: "Speak clearly and naturally, at a friendly conversational pace.",
            };

        const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!res.ok || !res.body) {
          const err = await res.text().catch(() => "");
          return new Response(err || `TTS failed: ${res.status}`, { status: res.status });
        }

        return new Response(res.body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "X-TTS-Provider": isArabic ? "gemini" : "openai",
          },
        });
      },
    },
  },
});