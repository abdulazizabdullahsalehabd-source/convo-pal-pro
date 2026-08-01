import { createFileRoute } from "@tanstack/react-router";

type SpeakBody = { text?: string; lang?: "ar" | "en"; voice?: string };

// Curated Gemini prebuilt voices (support both Arabic and English).
const VOICES = new Set([
  "Kore", "Aoede", "Leda", "Callirrhoe", "Autonoe", "Despina", "Erinome", "Laomedeia", // female
  "Puck", "Charon", "Fenrir", "Orus", "Enceladus", "Iapetus", "Algenib", "Sadaltager", // male
]);

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
    // Collapse repeated punctuation that makes TTS stumble
    .replace(/([!?،,.])\1+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// Arabic-specific normalization so pronunciation stays accurate.
function normalizeArabic(input: string): string {
  return input
    // Remove existing diacritics/tatweel: the model reads undiacritized MSA better than half-marked text.
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    // Arabic-Indic digits -> Western digits (read more reliably)
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    // Latin punctuation that breaks Arabic prosody
    .replace(/;/g, "،")
    .replace(/\s*([،.!؟?])\s*/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

export const Route = createFileRoute("/api/speak")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const { text, lang, voice } = (await request.json()) as SpeakBody;
        let clean = cleanForTTS(text ?? "");
        if (!clean) return new Response("Empty text", { status: 400 });

        const isArabic = lang === "ar";
        if (isArabic) clean = normalizeArabic(clean);
        const voiceName = voice && VOICES.has(voice) ? voice : "Kore";
        // Keep the direction short: long instructions make Gemini-TTS drift or read them aloud.
        const prompt = isArabic
          ? `اقرأ بالعربية الفصحى، نطقاً سليماً وإعراباً صحيحاً، بهدوء ووضوح وسرعة معتدلة:\n${clean}`
          : `Read in clear, natural English with correct pronunciation and a moderate pace:\n${clean}`;

        // Use Gemini TTS for BOTH Arabic and English — same voice catalog, consistent quality.
        const buildBody = (model: string) => ({
          model,
          stream_format: "sse",
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName } },
            },
          },
        });

        // Arabic gets the higher-quality model first for correct grammar/pronunciation.
        const models = isArabic
          ? [
              "google/gemini-2.5-pro-tts",
              "google/gemini-3.1-flash-tts-preview",
              "google/gemini-2.5-flash-tts",
              "google/gemini-2.5-flash-lite-preview-tts",
            ]
          : [
              "google/gemini-2.5-flash-tts",
              "google/gemini-3.1-flash-tts-preview",
              "google/gemini-2.5-pro-tts",
            ];

        let res: Response | null = null;
        let lastErr = "";
        for (const model of models) {
          res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(buildBody(model)),
          });
          if (res.ok && res.body) break;
          lastErr = await res.text().catch(() => "");
          if (res.status === 402) break;
        }

        if (!res || !res.ok || !res.body) {
          const err = lastErr;
          const status = res?.status ?? 500;
          if (status === 402 || err.includes("payment_required") || err.includes("Not enough credits")) {
            return new Response("نفد رصيد النطق الصوتي المجاني مؤقتاً — أوقف القراءة التلقائية أو حاول لاحقاً.", { status: 402 });
          }
          return new Response(err || `TTS failed: ${status}`, { status });
        }

        return new Response(res.body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "X-TTS-Provider": "gemini",
          },
        });
      },
    },
  },
});