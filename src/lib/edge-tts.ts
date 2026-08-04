// Free, unlimited neural text-to-speech using Microsoft Edge's read-aloud service.
// No API key, no quota, dozens of natural male/female Arabic + English voices.

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_BASE = "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1";
const CHROMIUM_VERSION = "130.0.2849.68";

// App voice id -> Edge neural voice per language (kept in the same order as the UI list).
const VOICE_MAP: Record<string, { ar: string; en: string }> = {
  Kore: { ar: "ar-SA-ZariyahNeural", en: "en-US-AvaNeural" },
  Aoede: { ar: "ar-EG-SalmaNeural", en: "en-US-JennyNeural" },
  Leda: { ar: "ar-AE-FatimaNeural", en: "en-US-AriaNeural" },
  Callirrhoe: { ar: "ar-KW-NouraNeural", en: "en-US-EmmaNeural" },
  Autonoe: { ar: "ar-MA-MounaNeural", en: "en-GB-SoniaNeural" },
  Erinome: { ar: "ar-JO-SanaNeural", en: "en-US-MichelleNeural" },
  Laomedeia: { ar: "ar-DZ-AminaNeural", en: "en-AU-NatashaNeural" },
  Puck: { ar: "ar-EG-ShakirNeural", en: "en-US-AndrewNeural" },
  Charon: { ar: "ar-SA-HamedNeural", en: "en-US-GuyNeural" },
  Fenrir: { ar: "ar-AE-HamdanNeural", en: "en-US-BrianNeural" },
  Orus: { ar: "ar-KW-FahedNeural", en: "en-US-ChristopherNeural" },
  Enceladus: { ar: "ar-IQ-BasselNeural", en: "en-GB-RyanNeural" },
  Iapetus: { ar: "ar-JO-TaimNeural", en: "en-US-EricNeural" },
  Algenib: { ar: "ar-QA-MoazNeural", en: "en-US-RogerNeural" },
  Sadaltager: { ar: "ar-BH-AliNeural", en: "en-US-SteffanNeural" },
};

export function edgeVoiceFor(voiceId: string | undefined, lang: "ar" | "en") {
  const entry = (voiceId && VOICE_MAP[voiceId]) || VOICE_MAP.Kore;
  return entry[lang];
}

export const hasEdgeTTS = () => typeof window !== "undefined";

/**
 * Synthesize speech with Microsoft Edge neural voices (free, no key, no quota).
 * The service refuses browser Origins, so the request goes through our own
 * /api/edge-speak route which opens the socket server-side and returns MP3.
 */
export async function synthesizeEdge(
  text: string,
  lang: "ar" | "en",
  voiceId: string | undefined,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const res = await fetch("/api/edge-speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, lang, voice: voiceId }),
    signal,
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "edge-tts failed"));
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!buf.length) throw new Error("edge-tts empty audio");
  return buf;
}
