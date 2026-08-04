// Free, unlimited neural text-to-speech using Microsoft Edge's read-aloud service.
// No API key, no quota, dozens of natural male/female Arabic + English voices.

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_BASE =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
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

export const hasEdgeTTS = () =>
  typeof window !== "undefined" &&
  typeof WebSocket !== "undefined" &&
  !!window.crypto?.subtle;

async function secMsGec(): Promise<string> {
  // Windows file-time ticks, rounded down to the nearest 5 minutes.
  const seconds = Math.floor(Date.now() / 1000) + 11644473600;
  const ticks = Math.floor(seconds / 300) * 300 * 10000000;
  const payload = `${ticks}${TRUSTED_CLIENT_TOKEN}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function uuid() {
  return (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/-/g, "");
}

function escapeXml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Synthesize speech with Edge TTS. Resolves with MP3 bytes. */
export async function synthesizeEdge(
  text: string,
  lang: "ar" | "en",
  voiceId: string | undefined,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!hasEdgeTTS()) throw new Error("edge-tts unsupported");
  const voice = edgeVoiceFor(voiceId, lang);
  const gec = await secMsGec();
  const url =
    `${WSS_BASE}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=1-${CHROMIUM_VERSION}` +
    `&ConnectionId=${uuid()}`;

  return await new Promise<Uint8Array>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    const chunks: Uint8Array[] = [];
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      try { ws.close(); } catch {}
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };
    const onAbort = () => fail("aborted");
    signal?.addEventListener("abort", onAbort);

    const timeout = setTimeout(() => fail("edge-tts timeout"), 20000);

    ws.onopen = () => {
      const now = new Date().toString();
      ws.send(
        `X-Timestamp:${now}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: {
                    sentenceBoundaryEnabled: "false",
                    wordBoundaryEnabled: "false",
                  },
                  outputFormat: "audio-24khz-48kbitrate-mono-mp3",
                },
              },
            },
          }),
      );
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang === "ar" ? "ar-SA" : "en-US"}'>` +
        `<voice name='${voice}'><prosody rate='-4%' pitch='+0Hz'>${escapeXml(text)}</prosody></voice></speak>`;
      ws.send(
        `X-RequestId:${uuid()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${now}Z\r\nPath:ssml\r\n\r\n${ssml}`,
      );
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        if (event.data.includes("Path:turn.end")) {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          cleanup();
          const total = chunks.reduce((n, c) => n + c.length, 0);
          if (!total) return reject(new Error("edge-tts returned no audio"));
          const out = new Uint8Array(total);
          let offset = 0;
          for (const c of chunks) {
            out.set(c, offset);
            offset += c.length;
          }
          resolve(out);
        }
        return;
      }
      const view = new DataView(event.data as ArrayBuffer);
      const headerLength = view.getUint16(0);
      chunks.push(new Uint8Array(event.data as ArrayBuffer, 2 + headerLength));
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      fail("edge-tts connection failed");
    };
    ws.onclose = () => {
      clearTimeout(timeout);
      fail("edge-tts closed early");
    };
  });
}
