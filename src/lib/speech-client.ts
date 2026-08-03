// Direct-from-browser speech services (no backend required).
// Keys come from Vite env vars so the app works on Vercel/static hosting.

const GROQ_KEY = import.meta.env.VITE_GROQ_API_KEY as string | undefined;
const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
const OPENAI_KEY = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;

export const hasClientSTT = () => !!GROQ_KEY || !!OPENAI_KEY;
export const hasClientTTS = () => !!GEMINI_KEY || !!OPENAI_KEY;

// ---------------- Speech to text ----------------

const STT_PROMPT =
  "Transcribe the user's speech accurately. The user may speak English or Arabic. Preserve the spoken language, use correct spelling, and do not translate.";

export async function transcribeDirect(blob: Blob): Promise<string> {
  const attempts: { url: string; key: string; model: string }[] = [];
  if (GROQ_KEY) {
    attempts.push({
      url: "https://api.groq.com/openai/v1/audio/transcriptions",
      key: GROQ_KEY,
      model: "whisper-large-v3-turbo",
    });
    attempts.push({
      url: "https://api.groq.com/openai/v1/audio/transcriptions",
      key: GROQ_KEY,
      model: "whisper-large-v3",
    });
  }
  if (OPENAI_KEY) {
    attempts.push({
      url: "https://api.openai.com/v1/audio/transcriptions",
      key: OPENAI_KEY,
      model: "gpt-4o-mini-transcribe",
    });
  }

  let lastErr = "";
  for (const attempt of attempts) {
    try {
      const form = new FormData();
      form.append("file", blob, "recording.wav");
      form.append("model", attempt.model);
      form.append("prompt", STT_PROMPT);
      const res = await fetch(attempt.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${attempt.key}` },
        body: form,
      });
      if (res.ok) {
        const json = (await res.json()) as { text?: string };
        return (json.text ?? "").trim();
      }
      lastErr = await res.text().catch(() => "");
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(lastErr || "client transcription unavailable");
}

// ---------------- Text to speech ----------------

export function cleanForTTS(input: string): string {
  return input
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, " ")
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, " ")
    .replace(/[\u2600-\u27BF]/g, " ")
    .replace(/[\uFE00-\uFE0F\u200D]/g, "")
    .replace(/[*_`~#>|]/g, " ")
    .replace(/([!?،,.])\1+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeArabic(input: string): string {
  return input
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/;/g, "،")
    .replace(/\s*([،.!؟?])\s*/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

const GEMINI_VOICES = new Set([
  "Kore", "Aoede", "Leda", "Callirrhoe", "Autonoe", "Despina", "Erinome", "Laomedeia",
  "Puck", "Charon", "Fenrir", "Orus", "Enceladus", "Iapetus", "Algenib", "Sadaltager",
]);

const OPENAI_VOICE_MAP: Record<string, string> = {
  Kore: "shimmer", Aoede: "nova", Leda: "coral", Callirrhoe: "sage",
  Autonoe: "alloy", Despina: "nova", Erinome: "shimmer", Laomedeia: "coral",
  Puck: "verse", Charon: "onyx", Fenrir: "ash", Orus: "echo",
  Enceladus: "onyx", Iapetus: "ash", Algenib: "echo", Sadaltager: "verse",
};

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type DirectAudio =
  | { kind: "pcm"; bytes: Uint8Array; sampleRate: number }
  | { kind: "file"; bytes: Uint8Array };

/** Fetch synthesized speech directly from the provider. Throws if unavailable. */
export async function synthesizeDirect(
  text: string,
  lang: "en" | "ar",
  voice: string | undefined,
  signal?: AbortSignal,
): Promise<DirectAudio> {
  let clean = cleanForTTS(text);
  if (!clean) throw new Error("Empty text");
  const isArabic = lang === "ar";
  if (isArabic) clean = normalizeArabic(clean);
  const voiceName = voice && GEMINI_VOICES.has(voice) ? voice : "Kore";
  const prompt = isArabic
    ? `اقرأ بالعربية الفصحى، نطقاً سليماً وإعراباً صحيحاً، بهدوء ووضوح وسرعة معتدلة:\n${clean}`
    : `Read in clear, natural English with correct pronunciation and a moderate pace:\n${clean}`;

  let lastErr = "";

  if (GEMINI_KEY) {
    const models = isArabic
      ? ["gemini-2.5-pro-preview-tts", "gemini-2.5-flash-preview-tts"]
      : ["gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts"];
    for (const model of models) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": GEMINI_KEY,
            },
            signal,
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: { prebuiltVoiceConfig: { voiceName } },
                },
              },
            }),
          },
        );
        if (res.ok) {
          const json: any = await res.json();
          const part = json?.candidates?.[0]?.content?.parts?.find?.(
            (p: any) => p?.inlineData?.data,
          );
          const data = part?.inlineData?.data as string | undefined;
          if (data) {
            const mime: string = part?.inlineData?.mimeType ?? "audio/L16;rate=24000";
            const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
            return { kind: "pcm", bytes: b64ToBytes(data), sampleRate: rate };
          }
        }
        lastErr = await res.text().catch(() => "");
      } catch (e) {
        if (signal?.aborted) throw e;
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
  }

  if (OPENAI_KEY) {
    try {
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`,
          "Content-Type": "application/json",
        },
        signal,
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          input: clean,
          voice: OPENAI_VOICE_MAP[voiceName] ?? "alloy",
          response_format: "wav",
          instructions: isArabic
            ? "اقرأ بالعربية الفصحى بنطق سليم وهدوء ووضوح."
            : "Read in clear, natural English with a moderate pace.",
        }),
      });
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        return { kind: "file", bytes: buf };
      }
      lastErr = await res.text().catch(() => "");
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }

  throw new Error(lastErr || "client TTS unavailable");
}