import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Mic, Send, Square, Volume2, VolumeX, Sparkles } from "lucide-react";
import { listMessages, sendMessage } from "@/lib/chat.functions";
import { useVoiceRecorder, speak, stopSpeaking } from "@/hooks/use-speech";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const VOICES: { id: string; label: string; gender: "male" | "female" }[] = [
  { id: "Kore", label: "كور — أنثى دافئة", gender: "female" },
  { id: "Aoede", label: "أويدي — أنثى هادئة", gender: "female" },
  { id: "Leda", label: "ليدا — أنثى شابة", gender: "female" },
  { id: "Callirrhoe", label: "كاليروي — أنثى واثقة", gender: "female" },
  { id: "Autonoe", label: "أوتونوي — أنثى ناعمة", gender: "female" },
  { id: "Puck", label: "باك — ذكر مرح", gender: "male" },
  { id: "Charon", label: "كارون — ذكر عميق", gender: "male" },
  { id: "Fenrir", label: "فينرير — ذكر قوي", gender: "male" },
  { id: "Orus", label: "أوروس — ذكر واضح", gender: "male" },
  { id: "Enceladus", label: "إنسيلادوس — ذكر هادئ", gender: "male" },
  { id: "Iapetus", label: "إيابيتوس — ذكر ثابت", gender: "male" },
];
const VOICE_KEY = "cf-voice";
const AUTO_SPEAK_KEY = "cf-auto-speak";

function friendlyError(message: string) {
  if (message.includes("402") || message.includes("payment_required") || message.includes("Not enough credits") || message.includes("رصيد")) {
    return "نفد رصيد الذكاء الاصطناعي المجاني مؤقتاً. رسالتك محفوظة هنا؛ حاول لاحقاً أو أضف رصيداً من إعدادات Lovable.";
  }
  return message;
}

export const Route = createFileRoute("/_authenticated/conversations/$id")({
  head: () => ({
    meta: [
      { title: "محادثة — صديق المحادثة" },
      { name: "description", content: "تدرّب صوتياً ونصياً مع صديق المحادثة واحصل على ردود وتصحيحات واضحة." },
      { property: "og:title", content: "محادثة — صديق المحادثة" },
      { property: "og:description", content: "واجهة محادثة صوتية ونصية لتطوير الإنجليزية بالعربية والإنجليزية." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChatScreen,
});

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  language: string;
  correction: null | { wrong: string; correct: string; hint: string };
  audioUrl?: string;
  created_at: string;
};

function ChatScreen() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const listFn = useServerFn(listMessages);
  const sendFn = useServerFn(sendMessage);
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [voice, setVoice] = useState<string>("Kore");
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [playingAssistantKey, setPlayingAssistantKey] = useState<string | null>(null);
  const [playingUserKey, setPlayingUserKey] = useState<string | null>(null);
  const [audioNotes, setAudioNotes] = useState<Record<string, string>>({});
  const userAudioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = localStorage.getItem(VOICE_KEY);
    if (v && VOICES.some((x) => x.id === v)) setVoice(v);
    setAutoSpeak(localStorage.getItem(AUTO_SPEAK_KEY) === "true");
  }, []);
  const changeVoice = (v: string) => {
    setVoice(v);
    try { localStorage.setItem(VOICE_KEY, v); } catch {}
  };
  const changeAutoSpeak = () => {
    setAutoSpeak((current) => {
      const next = !current;
      try { localStorage.setItem(AUTO_SPEAK_KEY, String(next)); } catch {}
      if (!next) {
        stopSpeaking();
        setPlayingAssistantKey(null);
      }
      return next;
    });
  };

  useEffect(() => {
    return () => {
      stopSpeaking();
      try { userAudioRef.current?.pause(); } catch {}
      Object.values(audioNotes).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [audioNotes]);

  const { data: messages, isLoading } = useQuery({
    queryKey: ["messages", id],
    queryFn: () => listFn({ data: { conversationId: id } }) as Promise<Msg[]>,
  });

  const sendMut = useMutation({
    mutationFn: (userText: string) => sendFn({ data: { conversationId: id, userText } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages", id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e: Error, userText) => {
      setText(userText);
      toast.error(friendlyError(e.message));
    },
  });

  const stopUserAudio = () => {
    try { userAudioRef.current?.pause(); } catch {}
    if (userAudioRef.current) userAudioRef.current.currentTime = 0;
    userAudioRef.current = null;
    setPlayingUserKey(null);
  };

  const submit = (raw: string, audioUrl?: string) => {
    const t = raw.trim();
    if (!t || sendMut.isPending) return;
    setText("");
    stopSpeaking();
    stopUserAudio();
    if (audioUrl) setAudioNotes((old) => ({ ...old, [t]: audioUrl }));
    // Optimistically append user message locally
    qc.setQueryData<Msg[]>(["messages", id], (old) => [
      ...(old ?? []),
      {
        id: "temp-" + Date.now(),
        role: "user",
        content: t,
        language: /[\u0600-\u06FF]/.test(t) ? "ar" : "en",
        correction: null,
        audioUrl,
        created_at: new Date().toISOString(),
      },
    ]);
    sendMut.mutate(t);
  };

  const recorder = useVoiceRecorder((transcript, audioUrl) => submit(transcript, audioUrl));
  useEffect(() => {
    if (recorder.error) toast.error(recorder.error);
  }, [recorder.error]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sendMut.isPending, recorder.status]);

  // Auto-play the assistant's latest reply
  const lastSpokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoSpeak) return;
    if (!messages || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role === "assistant" && last.id !== lastSpokenRef.current) {
      lastSpokenRef.current = last.id;
      stopUserAudio();
      setPlayingAssistantKey(last.id);
      speak(last.content, last.language === "ar" ? "ar" : "en", voice, () => {
        setPlayingAssistantKey((current) => (current === last.id ? null : current));
      }).catch((e: Error) => {
        setPlayingAssistantKey(null);
        toast.error(friendlyError(e.message));
      });
    }
  }, [messages, voice, autoSpeak]);

  const toggleAssistantAudio = (m: Msg) => {
    if (playingAssistantKey === m.id) {
      stopSpeaking();
      setPlayingAssistantKey(null);
      return;
    }
    stopUserAudio();
    setPlayingAssistantKey(m.id);
    speak(m.content, m.language === "ar" ? "ar" : "en", voice, () => {
      setPlayingAssistantKey((current) => (current === m.id ? null : current));
    }).catch((e: Error) => {
      setPlayingAssistantKey(null);
      toast.error(friendlyError(e.message));
    });
  };

  const toggleUserAudio = (key: string, audioUrl: string) => {
    if (playingUserKey === key) {
      stopUserAudio();
      return;
    }
    stopSpeaking();
    setPlayingAssistantKey(null);
    stopUserAudio();
    const audio = new Audio(audioUrl);
    userAudioRef.current = audio;
    setPlayingUserKey(key);
    audio.onended = () => setPlayingUserKey(null);
    audio.onerror = () => {
      setPlayingUserKey(null);
      toast.error("تعذّر تشغيل التسجيل.");
    };
    audio.play().catch(() => {
      setPlayingUserKey(null);
      toast.error("تعذّر تشغيل التسجيل.");
    });
  };

  return (
    <div className="flex flex-col h-dvh bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-3 py-3 flex items-center gap-2">
        <button onClick={() => navigate({ to: "/conversations" })} className="p-2 -ml-2 rounded-lg hover:bg-slate-100">
          <ArrowRight className="w-5 h-5 text-slate-700" />
        </button>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-emerald-500 flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-900 text-sm">صديق المحادثة</div>
          <div className="text-[11px] text-slate-500">{autoSpeak ? "القراءة التلقائية مفعّلة" : "القراءة اليدوية توفّر الرصيد"}</div>
        </div>
        <button
          type="button"
          onClick={changeAutoSpeak}
          className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center border transition-colors",
            autoSpeak ? "bg-sky-50 border-sky-200 text-sky-600" : "bg-slate-100 border-slate-200 text-slate-500",
          )}
          aria-label={autoSpeak ? "إيقاف القراءة التلقائية" : "تشغيل القراءة التلقائية"}
        >
          {autoSpeak ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>
        <select
          value={voice}
          onChange={(e) => changeVoice(e.target.value)}
          className="text-[11px] bg-slate-100 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-400 max-w-[130px]"
          aria-label="اختر الصوت"
        >
          <optgroup label="أصوات نسائية">
            {VOICES.filter((v) => v.gender === "female").map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </optgroup>
          <optgroup label="أصوات رجالية">
            {VOICES.filter((v) => v.gender === "male").map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </optgroup>
        </select>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
        {isLoading ? (
          <div className="text-center text-slate-400 py-10">جاري التحميل...</div>
        ) : messages && messages.length === 0 ? (
          <EmptyChat />
        ) : (
          messages?.map((m) => (
            <MessageBubble
              key={m.id}
              m={m}
              audioUrl={m.audioUrl ?? audioNotes[m.content]}
              assistantPlaying={playingAssistantKey === m.id}
              userPlaying={playingUserKey === m.id}
              onToggleAssistant={toggleAssistantAudio}
              onToggleUser={toggleUserAudio}
            />
          ))
        )}
        {sendMut.isPending && <TypingIndicator />}
        {recorder.status === "recording" && <RecordingIndicator elapsed={recorder.elapsed} />}
        {recorder.status === "transcribing" && <TranscribingIndicator />}
      </div>

      <footer className="bg-white border-t border-slate-200 px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(text);
              }
            }}
            placeholder="اكتب أو استخدم الميكروفون..."
            rows={1}
            dir="auto"
            disabled={recorder.status !== "idle"}
            className="flex-1 resize-none bg-slate-100 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 max-h-32"
          />
          {text.trim() ? (
            <Button
              onClick={() => submit(text)}
              disabled={sendMut.isPending || recorder.status !== "idle"}
              size="icon"
              className="w-11 h-11 rounded-full bg-sky-500 hover:bg-sky-600 shrink-0"
            >
              <Send className="w-5 h-5" />
            </Button>
          ) : (
            <MicButton recorder={recorder} disabled={sendMut.isPending} />
          )}
        </div>
        {!recorder.supported && (
          <p className="text-[11px] text-slate-400 mt-2 text-center">
            التسجيل الصوتي غير مدعوم في هذا المتصفح — استخدم متصفحاً حديثاً أو اكتب رسالتك.
          </p>
        )}
      </footer>
    </div>
  );
}

function MicButton({
  recorder,
  disabled,
}: {
  recorder: ReturnType<typeof useVoiceRecorder>;
  disabled: boolean;
}) {
  const isRecording = recorder.status === "recording";
  const isBusy = recorder.status === "transcribing";
  return (
    <button
      type="button"
      disabled={disabled || !recorder.supported || isBusy}
      onClick={() => recorder.toggle()}
      className={cn(
        "w-14 h-14 rounded-full shrink-0 flex items-center justify-center text-white transition-all relative",
        isRecording
          ? "bg-rose-500 scale-110 shadow-lg shadow-rose-300"
          : "bg-gradient-to-br from-sky-500 to-emerald-500 shadow-lg shadow-sky-200",
        (disabled || isBusy) && "opacity-60",
      )}
      aria-label={isRecording ? "اضغط لإيقاف التسجيل" : "اضغط لبدء التسجيل"}
    >
      {isRecording && (
        <span className="absolute inset-0 rounded-full bg-rose-400 animate-ping opacity-60" />
      )}
      {isRecording ? (
        <Square className="w-5 h-5 relative z-10 fill-white" />
      ) : (
        <Mic className="w-6 h-6 relative z-10" />
      )}
    </button>
  );
}

function MessageBubble({
  m,
  audioUrl,
  assistantPlaying,
  userPlaying,
  onToggleAssistant,
  onToggleUser,
}: {
  m: Msg;
  audioUrl?: string;
  assistantPlaying: boolean;
  userPlaying: boolean;
  onToggleAssistant: (m: Msg) => void;
  onToggleUser: (key: string, audioUrl: string) => void;
}) {
  const isUser = m.role === "user";
  const isAr = m.language === "ar";
  return (
    <div className={cn("flex flex-col gap-1.5", isUser ? "items-end" : "items-start")}>
      <div
        dir={isAr ? "rtl" : "ltr"}
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words",
          isUser
            ? "bg-sky-500 text-white rounded-br-md"
            : "bg-white border border-slate-200 text-slate-800 rounded-bl-md",
        )}
      >
        {m.content}
      </div>
      {isUser && audioUrl && (
        <button
          onClick={() => onToggleUser(m.id, audioUrl)}
          className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-sky-600 px-1"
        >
          {userPlaying ? <Square className="w-3.5 h-3.5 fill-current" /> : <Volume2 className="w-3.5 h-3.5" />}
          {userPlaying ? "إيقاف تسجيلي" : "استمع لتسجيلي"}
        </button>
      )}
      {!isUser && (
        <button
          onClick={() => onToggleAssistant(m)}
          className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-sky-600 px-1"
        >
          {assistantPlaying ? <Square className="w-3.5 h-3.5 fill-current" /> : <Volume2 className="w-3.5 h-3.5" />}
          {assistantPlaying ? "إيقاف" : "استمع"}
        </button>
      )}
      {!isUser && m.correction && <CorrectionCard c={m.correction} />}
    </div>
  );
}

function CorrectionCard({ c }: { c: { wrong: string; correct: string; hint: string } }) {
  return (
    <div className="max-w-[90%] bg-amber-50 border-2 border-amber-300 rounded-2xl p-3 text-xs space-y-1.5 mt-1">
      <div className="font-bold text-amber-800 flex items-center gap-1">
        <Sparkles className="w-3.5 h-3.5" />
        تصحيح لطيف
      </div>
      <div dir="ltr" className="text-left">
        <div className="text-rose-700"><span className="opacity-70">✗ </span>{c.wrong}</div>
        <div className="text-emerald-700 font-semibold"><span className="opacity-70">✓ </span>{c.correct}</div>
      </div>
      {c.hint && <div className="text-amber-900 text-[11px] pt-1 border-t border-amber-200">{c.hint}</div>}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2">
      <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1">
        <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
        <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
        <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
      </div>
      <span className="text-xs text-slate-500">يفكّر...</span>
    </div>
  );
}

function RecordingIndicator({ elapsed }: { elapsed: number }) {
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-xs text-rose-600 font-medium">يسجّل... {mm}:{ss}</span>
      <div className="bg-rose-50 border border-rose-200 rounded-2xl rounded-br-md px-4 py-2.5 flex items-center gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="w-1 bg-rose-500 rounded-full animate-pulse"
            style={{ height: `${8 + (i % 3) * 6}px`, animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function TranscribingIndicator() {
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-xs text-sky-600 font-medium">يحوّل الصوت إلى نص...</span>
      <div className="bg-sky-50 border border-sky-200 rounded-2xl rounded-br-md px-4 py-2.5 flex items-center gap-1">
        <span className="w-2 h-2 bg-sky-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
        <span className="w-2 h-2 bg-sky-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
        <span className="w-2 h-2 bg-sky-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
      </div>
    </div>
  );
}

function EmptyChat() {
  return (
    <div className="text-center py-12 px-6">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-500 to-emerald-500 flex items-center justify-center mx-auto mb-4">
        <Sparkles className="w-8 h-8 text-white" />
      </div>
      <h3 className="font-bold text-slate-800 mb-2">ابدأ محادثتك</h3>
      <p className="text-sm text-slate-500 max-w-xs mx-auto">
        اضغط زر الميكروفون مرة للبدء ومرة للإيقاف، أو اكتب رسالتك. سأرد عليك وأصحح أخطاءك بلطف.
      </p>
    </div>
  );
}