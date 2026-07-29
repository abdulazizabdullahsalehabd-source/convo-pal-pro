import { useCallback, useEffect, useRef, useState } from "react";

// ---------- Recording (Web Audio PCM → WAV → /api/transcribe) ----------

type RecStatus = "idle" | "recording" | "transcribing";

function getAudioContextClass() {
  if (typeof window === "undefined") return null;
  return window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext || null;
}

function concatPcm(chunks: Float32Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function downsamplePcm(input: Float32Array, inputRate: number, outputRate: number) {
  if (outputRate === inputRate) return input;
  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += input[j];
      count++;
    }
    output[i] = count ? sum / count : input[start] ?? 0;
  }
  return output;
}

function encodeWav(chunks: Float32Array[], inputRate: number) {
  const sampleRate = 16000;
  const pcm = downsamplePcm(concatPcm(chunks), inputRate, sampleRate);
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, pcm.length * 2, true);

  let offset = 44;
  for (let i = 0; i < pcm.length; i++) {
    const sample = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function useVoiceRecorder(onTranscript: (text: string, audioUrl?: string) => void) {
  const [status, setStatus] = useState<RecStatus>("idle");
  const [supported, setSupported] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmRef = useRef<Float32Array[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSupported(
      !!getAudioContextClass() && !!navigator.mediaDevices?.getUserMedia,
    );
  }, []);

  const cleanupStream = () => {
    try { processorRef.current?.disconnect(); } catch {}
    try { sourceRef.current?.disconnect(); } catch {}
    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx && ctx.state !== "closed") {
      try { void ctx.close(); } catch {}
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const start = useCallback(async () => {
    if (status !== "idle") return;
    setError(null);
    try {
      const AudioContextClass = getAudioContextClass();
      if (!AudioContextClass) throw new Error("unsupported");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      streamRef.current = stream;
      const ctx = new AudioContextClass();
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      pcmRef.current = [];
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        pcmRef.current.push(new Float32Array(input));
      };
      source.connect(processor);
      processor.connect(ctx.destination);
      audioCtxRef.current = ctx;
      sourceRef.current = source;
      processorRef.current = processor;
      startedAtRef.current = Date.now();
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 250);
      if (ctx.state === "suspended") {
        try { await ctx.resume(); } catch {}
      }
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

  const stop = useCallback(async () => {
    if (status !== "recording") {
      cleanupStream();
      setStatus("idle");
      return;
    }

    const ctx = audioCtxRef.current;
    const inputRate = ctx?.sampleRate ?? 48000;
    const chunks = [...pcmRef.current];
    cleanupStream();

    const duration = (Date.now() - startedAtRef.current) / 1000;
    const blob = encodeWav(chunks, inputRate);
    const audioUrl = URL.createObjectURL(blob);
    if (duration < 0.45 || blob.size < 2048) {
      URL.revokeObjectURL(audioUrl);
      setStatus("idle");
      setError("التسجيل قصير جداً — حاول مرة أخرى.");
      return;
    }

    setStatus("transcribing");
    try {
      const form = new FormData();
      form.append("file", blob, "recording.wav");
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `HTTP ${res.status}`);
      }
      const { text } = (await res.json()) as { text?: string };
      if (text && text.trim()) onTranscript(text.trim(), audioUrl);
      else {
        URL.revokeObjectURL(audioUrl);
        setError("لم أتمكن من فهم الصوت — حاول مجدداً.");
      }
    } catch (e) {
      URL.revokeObjectURL(audioUrl);
      setError(e instanceof Error ? e.message : "فشل التحويل الصوتي");
    } finally {
      setStatus("idle");
    }
  }, [status, onTranscript]);

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
let currentDoneTimer: ReturnType<typeof setTimeout> | null = null;
let currentPlaybackToken = 0;

function stopCurrentPlayback() {
  currentPlaybackToken++;
  if (currentDoneTimer) {
    clearTimeout(currentDoneTimer);
    currentDoneTimer = null;
  }
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

function friendlyAudioError(status: number, message: string) {
  if (status === 402 || message.includes("payment_required") || message.includes("Not enough credits")) {
    return "نفد رصيد الصوت المجاني مؤقتاً — أوقف القراءة التلقائية أو حاول لاحقاً.";
  }
  return message || "تعذّر تشغيل الصوت.";
}

export async function speak(text: string, lang: "en" | "ar", voice?: string, onEnded?: () => void) {
  if (typeof window === "undefined") return;
  if (!text || !text.trim()) return;
  stopCurrentPlayback();
  const token = ++currentPlaybackToken;

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
  if (!res.ok || !res.body) {
    const msg = await res.text().catch(() => "");
    throw new Error(friendlyAudioError(res.status, msg));
  }

  // Gemini-TTS PCM = 24kHz mono s16le.
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
    if (token !== currentPlaybackToken) return;
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
      if (done || token !== currentPlaybackToken) break;
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

  if (token !== currentPlaybackToken) return;
  const remaining = Math.max(0, playhead - ctx.currentTime + 0.25);
  currentDoneTimer = setTimeout(() => {
    if (token !== currentPlaybackToken) return;
    try { ctx.close(); } catch {}
    currentAudioCtx = null;
    currentAbort = null;
    currentDoneTimer = null;
    onEnded?.();
  }, Math.ceil(remaining * 1000));
}

export function stopSpeaking() {
  stopCurrentPlayback();
}