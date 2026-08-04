import { createFileRoute } from "@tanstack/react-router";

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

function edgeVoiceFor(voiceId: string | undefined, lang: "ar" | "en") {
  const entry = (voiceId && VOICE_MAP[voiceId]) || VOICE_MAP.Kore;
  return entry[lang];
}

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_URL = "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1";
const CHROMIUM_VERSION = "130.0.2849.68";

async function secMsGec() {
  const seconds = Math.floor(Date.now() / 1000) + 11644473600;
  const ticks = Math.floor(seconds / 300) * 300 * 10000000;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ticks}${TRUSTED_CLIENT_TOKEN}`),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

const id = () => crypto.randomUUID().replace(/-/g, "");

function escapeXml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Microsoft Edge read-aloud voices: free, unlimited, no API key.
// Browsers can't set the required Origin header, so the socket is opened here.
export const Route = createFileRoute("/api/edge-speak")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
        const { text, lang, voice } = (await request.json()) as {
          text?: string;
          lang?: "ar" | "en";
          voice?: string;
        };
        const clean = (text ?? "").trim();
        if (!clean) return new Response("Empty text", { status: 400 });
        const language: "ar" | "en" = lang === "ar" ? "ar" : "en";
        const voiceName = edgeVoiceFor(voice, language);

        const url =
          `${WSS_URL}?Ocp-Apim-Subscription-Key=${TRUSTED_CLIENT_TOKEN}` +
          `&ConnectionId=${id()}` +
          `&Sec-MS-GEC=${await secMsGec()}&Sec-MS-GEC-Version=1-${CHROMIUM_VERSION}`;

        let ws: WebSocket;
        // Worker runtimes open outbound sockets through fetch(); Node/Bun use the ctor.
        const upgraded = await fetch(url.replace(/^wss:/, "https:"), {
          headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": "synthesize" },
        }).catch((e) => { console.error("upgrade fetch failed", e); return null; });
        const socket = (upgraded as unknown as { webSocket?: WebSocket } | null)?.webSocket;
        if (!socket) {
          return new Response(
            "diag: status=" + (upgraded ? upgraded.status : "null") + " hdrs=" + (upgraded ? JSON.stringify(Object.fromEntries(upgraded.headers)) : ""),
            { status: 599 },
          );
        }
        if (socket) {
          (socket as unknown as { accept: () => void }).accept();
          ws = socket;
        } else {
          try { ws = new WebSocket(url, "synthesize"); } catch (e) { throw new Error("ctor:" + (e instanceof Error ? e.message : String(e))); }
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(() => reject(new Error("edge-tts timeout")), 15000);
            ws.addEventListener("open", () => { clearTimeout(t); resolve(); }, { once: true });
            ws.addEventListener("error", () => { clearTimeout(t); reject(new Error("ws-open-failed")); }, { once: true });
          });
        }
        ws.binaryType = "arraybuffer";

        const audio = await new Promise<Uint8Array | null>((resolve) => {
          const chunks: Uint8Array[] = [];
          let done = false;
          const finish = (ok: boolean) => {
            if (done) return;
            done = true;
            try { ws.close(); } catch {}
            if (!ok || !chunks.length) return resolve(null);
            const total = chunks.reduce((n, c) => n + c.length, 0);
            const out = new Uint8Array(total);
            let offset = 0;
            for (const c of chunks) {
              out.set(c, offset);
              offset += c.length;
            }
            resolve(out);
          };
          const timer = setTimeout(() => finish(false), 25000);
          ws.addEventListener("message", (event: MessageEvent) => {
            const data = event.data;
            if (typeof data === "string") {
              if (data.includes("Path:turn.end")) {
                clearTimeout(timer);
                finish(true);
              }
              return;
            }
            const bytes = new Uint8Array(data as ArrayBuffer);
            const headerLength = (bytes[0] << 8) | bytes[1];
            chunks.push(bytes.subarray(2 + headerLength));
          });
          ws.addEventListener("error", () => { clearTimeout(timer); finish(false); });
          ws.addEventListener("close", () => { clearTimeout(timer); finish(chunks.length > 0); });

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
            `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${language === "ar" ? "ar-SA" : "en-US"}'>` +
            `<voice name='${voiceName}'><prosody rate='-4%' pitch='+0Hz'>${escapeXml(clean)}</prosody></voice></speak>`;
          ws.send(
            `X-RequestId:${id()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${now}Z\r\nPath:ssml\r\n\r\n${ssml}`,
          );
        });

        if (!audio) return new Response("edge-tts failed", { status: 502 });
        return new Response(audio as unknown as BodyInit, {
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-cache",
            "X-TTS-Provider": "edge",
          },
        });
        } catch (e) {
          return new Response(
            `edge-tts error: ${e instanceof Error ? e.message : String(e)}`,
            { status: 502 },
          );
        }
      },
    },
  },
});
