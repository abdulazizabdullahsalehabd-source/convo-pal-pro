import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Mic, Send, Volume2, Sparkles, Languages } from "lucide-react";
import { listMessages, sendMessage } from "@/lib/chat.functions";
import { useSpeechRecognition, speak } from "@/hooks/use-speech";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/conversations/$id")({
  head: () => ({ meta: [{ title: "محادثة — صديق المحادثة" }] }),
  component: ChatScreen,
});

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  language: string;
  correction: null | { wrong: string; correct: string; hint: string };
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
  const speech = useSpeechRecognition();

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
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = (raw: string) => {
    const t = raw.trim();
    if (!t || sendMut.isPending) return;
    setText("");
    // Optimistically append user message locally
    qc.setQueryData<Msg[]>(["messages", id], (old) => [
      ...(old ?? []),
      {
        id: "temp-" + Date.now(),
        role: "user",
        content: t,
        language: /[\u0600-\u06FF]/.test(t) ? "ar" : "en",
        correction: null,
        created_at: new Date().toISOString(),
      },
    ]);
    sendMut.mutate(t);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sendMut.isPending]);

  // When speech recognition ends with a transcript, send it
  const lastTranscriptRef = useRef("");
  useEffect(() => {
    if (!speech.listening && speech.transcript && speech.transcript !== lastTranscriptRef.current) {
      lastTranscriptRef.current = speech.transcript;
      submit(speech.transcript);
    }
  }, [speech.listening, speech.transcript]);

  // Auto-play the assistant's latest reply
  const lastSpokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!messages || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role === "assistant" && last.id !== lastSpokenRef.current) {
      lastSpokenRef.current = last.id;
      speak(last.content, last.language === "ar" ? "ar" : "en");
    }
  }, [messages]);

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
          <div className="text-[11px] text-slate-500">جاهز للتحدث بالإنجليزية أو العربية</div>
        </div>
        <button
          onClick={() => speech.setLang(speech.lang === "en-US" ? "ar-SA" : "en-US")}
          className="flex items-center gap-1 text-xs bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-lg text-slate-700"
          title="لغة التسجيل الصوتي"
        >
          <Languages className="w-3.5 h-3.5" />
          {speech.lang === "en-US" ? "EN" : "AR"}
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
        {isLoading ? (
          <div className="text-center text-slate-400 py-10">جاري التحميل...</div>
        ) : messages && messages.length === 0 ? (
          <EmptyChat />
        ) : (
          messages?.map((m) => <MessageBubble key={m.id} m={m} />)
        )}
        {sendMut.isPending && <TypingIndicator />}
        {speech.listening && <ListeningIndicator text={speech.transcript} />}
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
            className="flex-1 resize-none bg-slate-100 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 max-h-32"
          />
          {text.trim() ? (
            <Button
              onClick={() => submit(text)}
              disabled={sendMut.isPending}
              size="icon"
              className="w-11 h-11 rounded-full bg-sky-500 hover:bg-sky-600 shrink-0"
            >
              <Send className="w-5 h-5" />
            </Button>
          ) : (
            <MicButton speech={speech} disabled={sendMut.isPending} />
          )}
        </div>
        {!speech.supported && (
          <p className="text-[11px] text-slate-400 mt-2 text-center">
            التسجيل الصوتي غير مدعوم في هذا المتصفح — استخدم Chrome على أندرويد أو الكتابة.
          </p>
        )}
      </footer>
    </div>
  );
}

function MicButton({ speech, disabled }: { speech: ReturnType<typeof useSpeechRecognition>; disabled: boolean }) {
  const onDown = () => { if (!disabled && speech.supported) speech.start(); };
  const onUp = () => speech.stop();
  return (
    <button
      disabled={disabled || !speech.supported}
      onMouseDown={onDown}
      onMouseUp={onUp}
      onMouseLeave={() => speech.listening && onUp()}
      onTouchStart={(e) => { e.preventDefault(); onDown(); }}
      onTouchEnd={(e) => { e.preventDefault(); onUp(); }}
      className={cn(
        "w-14 h-14 rounded-full shrink-0 flex items-center justify-center text-white transition-all relative",
        speech.listening
          ? "bg-rose-500 scale-110 shadow-lg shadow-rose-300"
          : "bg-gradient-to-br from-sky-500 to-emerald-500 shadow-lg shadow-sky-200",
        disabled && "opacity-50",
      )}
      aria-label="اضغط مطولاً للتسجيل"
    >
      {speech.listening && (
        <span className="absolute inset-0 rounded-full bg-rose-400 animate-ping opacity-60" />
      )}
      <Mic className="w-6 h-6 relative z-10" />
    </button>
  );
}

function MessageBubble({ m }: { m: Msg }) {
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
      {!isUser && (
        <button
          onClick={() => speak(m.content, isAr ? "ar" : "en")}
          className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-sky-600 px-1"
        >
          <Volume2 className="w-3.5 h-3.5" />
          استمع
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

function ListeningIndicator({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-xs text-rose-600 font-medium">يستمع...</span>
      <div className="bg-rose-50 border border-rose-200 rounded-2xl rounded-br-md px-4 py-2.5 text-sm text-slate-700 max-w-[85%]" dir="auto">
        {text || "..."}
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
        اضغط زر الميكروفون مطوّلاً وتحدّث بالإنجليزية، أو اكتب رسالتك. سأرد عليك وأصحح أخطاءك بلطف.
      </p>
    </div>
  );
}