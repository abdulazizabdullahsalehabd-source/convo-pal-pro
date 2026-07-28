import { useCallback, useEffect, useRef, useState } from "react";

// ---------- Recording (MediaRecorder → /api/transcribe) ----------

type RecStatus = "idle" | "recording" | "transcribing";

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const t of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {}
  }
  return "";
}

export function useVoiceRecorder(onTranscript: (text: string) => void) {
  const [status, setStatus] = useState<RecStatus>("idle");
  const [supported, setSupported] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSupported(
      typeof MediaRecorder !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia,
    );
  }, []);

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const start = useCallback(async () => {
    if (status !== "idle") return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const type = rec.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        cleanupStream();
        if (blob.size < 1200) {
          setStatus("idle");
          setError("التسجيل قصير جداً — حاول مرة أخرى.");
          return;
        }
        setStatus("transcribing");
        try {
          const form = new FormData();
          form.append("file", blob, "recording");
          const res = await fetch("/api/transcribe", { method: "POST", body: form });
          if (!res.ok) {
            const msg = await res.text().catch(() => "");
            throw new Error(msg || `HTTP ${res.status}`);
          }
          const { text } = (await res.json()) as { text?: string };
          if (text && text.trim()) onTranscript(text.trim());
          else setError("لم أتمكن من فهم الصوت — حاول مجدداً.");
        } catch (e) {
          setError(e instanceof Error ? e.message : "فشل التحويل الصوتي");
        } finally {
          setStatus("idle");
        }
      };
      rec.start();
      mediaRef.current = rec;
      startedAtRef.current = Date.now();
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 250);
      setStatus("recording");
    } catch (e) {
      cleanupStream();
      setStatus("idle");
      setError(
        e instanceof Error && e.name === "NotAllowedError"
          ? "يجب السماح بالوصول للميكروفون."
          : "تعذّر تشغيل الميكروفون.",
      );
    }
  }, [status, onTranscript]);

  const stop = useCallback(() => {
    const rec = mediaRef.current;
    if (rec && rec.state !== "inactive") {
      try { rec.stop(); } catch {}
    } else {
      cleanupStream();
      setStatus("idle");
    }
  }, []);

  const toggle = useCallback(() => {
    if (status === "recording") stop();
    else if (status === "idle") start();
  }, [status, start, stop]);

  useEffect(() => () => cleanupStream(), []);

  return { status, supported, elapsed, error, start, stop, toggle };
}

// ---------- Playback (SSE PCM/WAV from /api/speak) ----------

let currentAudioCtx: AudioContext | null = null;
let currentAbort: AbortController | null = null;

function stopCurrentPlayback() {
  try { currentAbort?.abort(); } catch {}
  currentAbort = null;
  try { currentAudioCtx?.close(); } catch {}
  currentAudioCtx = null;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function speak(text: string, lang: "en" | "ar", voice?: string) {
  if (typeof window === "undefined") return;
  if (!text || !text.trim()) return;
  stopCurrentPlayback();

  const abort = new AbortController();
  currentAbort = abort;

  let res: Response;
  try {
    res = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang, voice }),
      signal: abort.signal,
    });
  } catch {
    return;
  }
  if (!res.ok || !res.body) return;

  const provider = res.headers.get("X-TTS-Provider") ?? (lang === "ar" ? "gemini" : "openai");
  // OpenAI gpt-4o-mini-tts PCM = 24kHz mono s16le.
  // Gemini-TTS PCM = 24kHz mono s16le as well (per Gemini live/tts spec).
  const sampleRate = 24000;
  const AC: typeof AudioContext =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) return;
  const ctx = new AC({ sampleRate });
  currentAudioCtx = ctx;
  if (ctx.state === "suspended") {
    try { await ctx.resume(); } catch {}
  }
  let playhead = 0;
  let pending = new Uint8Array(0);

  const scheduleChunk = (incoming: Uint8Array) => {
    const bytes = new Uint8Array(pending.length + incoming.length);
    bytes.set(pending);
    bytes.set(incoming, pending.length);
    const usable = bytes.length - (bytes.length % 2);
    pending = bytes.slice(usable);
    if (usable === 0) return;
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, usable / 2);
    const floats = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) floats[i] = samples[i] / 32768;
    const buffer = ctx.createBuffer(1, floats.length, sampleRate);
    buffer.copyToChannel(floats, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const now = ctx.currentTime;
    if (playhead === 0) playhead = now + 0.06;
    else playhead = Math.max(playhead, now);
    source.start(playhead);
    playhead += buffer.duration;
  };

  // Gemini returns entire audio (WAV) sometimes; handle both PCM stream and WAV.
  const handleGeminiPayload = async (bytes: Uint8Array) => {
    // Detect RIFF/WAV header
    if (
      bytes.length > 44 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    ) {
      try {
        const buf = await ctx.decodeAudioData(bytes.slice().buffer);
        const source = ctx.createBufferSource();
        source.buffer = buf;
        source.connect(ctx.destination);
        const now = ctx.currentTime;
        if (playhead === 0) playhead = now + 0.06;
        else playhead = Math.max(playhead, now);
        source.start(playhead);
        playhead += buf.duration;
      } catch {}
    } else {
      scheduleChunk(bytes);
    }
  };

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let idx: number;
      // eslint-disable-next-line no-cond-assign
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const lines = raw.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          let payload: any;
          try { payload = JSON.parse(data); } catch { continue; }
          // OpenAI shape
          if (payload.type === "speech.audio.delta" && typeof payload.audio === "string") {
            scheduleChunk(b64ToBytes(payload.audio));
            continue;
          }
          if (payload.type === "speech.audio.done") continue;
          // Gemini shape: inlineData with base64
          const inline =
            payload?.candidates?.[0]?.content?.parts?.find?.((p: any) => p?.inlineData?.data)?.inlineData?.data ??
            payload?.data ??
            payload?.audio;
          if (typeof inline === "string") {
            await handleGeminiPayload(b64ToBytes(inline));
          }
        }
      }
    }
  } catch {
    // aborted or network error
  }
}

export function stopSpeaking() {
  stopCurrentPlayback();
}