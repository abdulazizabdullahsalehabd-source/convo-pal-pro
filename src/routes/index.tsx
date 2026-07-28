import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { MessageCircleHeart, Mic, Sparkles } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "صديق المحادثة — تطبيق محادثة إنجليزية" },
      { name: "description", content: "تدرّب على التحدث بالإنجليزية عبر محادثات صوتية ونصية ذكية مع تصحيح فوري." },
      { property: "og:title", content: "صديق المحادثة — تطبيق محادثة إنجليزية" },
      { property: "og:description", content: "محادثة صوتية ونصية لتطوير الإنجليزية مع ردود واضحة وتصحيح لطيف." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/conversations" });
      else setChecking(false);
    });
  }, [navigate]);

  const signIn = async () => {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error("فشل تسجيل الدخول: " + (result.error.message ?? "خطأ غير معروف"));
        setLoading(false);
        return;
      }
      if (result.redirected) return;
      navigate({ to: "/conversations" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطأ في تسجيل الدخول");
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-sky-50 to-white">
        <div className="animate-pulse text-slate-500">جاري التحميل...</div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-gradient-to-b from-sky-50 via-white to-emerald-50 flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-sky-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-sky-200 mb-6">
          <MessageCircleHeart className="w-11 h-11 text-white" strokeWidth={2.2} />
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-3">صديق المحادثة</h1>
        <p className="text-slate-600 max-w-sm leading-relaxed mb-8">
          تدرّب على التحدث بالإنجليزية بطريقة طبيعية مع صديق ذكاء اصطناعي — تسجيل صوتي، ردود فورية، وتصحيح لطيف لأخطائك.
        </p>

        <div className="grid gap-3 w-full max-w-sm mb-10">
          <Feature icon={<Mic className="w-5 h-5" />} title="تحدّث بصوتك" desc="اضغط زر الميكروفون وتحدّث بحرية" />
          <Feature icon={<Sparkles className="w-5 h-5" />} title="تصحيح ذكي" desc="بطاقات مختصرة توضّح الأخطاء والصياغة الأفضل" />
          <Feature icon={<MessageCircleHeart className="w-5 h-5" />} title="محادثاتك محفوظة" desc="ارجع لأي وقت وأكمل من حيث توقّفت" />
        </div>

        <Button
          onClick={signIn}
          disabled={loading}
          size="lg"
          className="w-full max-w-sm h-14 text-base rounded-2xl bg-slate-900 hover:bg-slate-800 shadow-lg"
        >
          <GoogleIcon />
          <span className="mr-2">{loading ? "جاري التحويل..." : "الدخول بحساب Google"}</span>
        </Button>

        <p className="text-xs text-slate-400 mt-6 max-w-xs">
          بتسجيل الدخول توافق على أن تُحفظ محادثاتك في حسابك.
        </p>
      </div>
      <footer className="text-center text-xs text-slate-400 py-4">
        صديق المحادثة — تدرّب على الإنجليزية بثقة
      </footer>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 text-right bg-white/70 backdrop-blur border border-slate-200/60 rounded-2xl p-4">
      <div className="w-10 h-10 rounded-xl bg-sky-100 text-sky-600 flex items-center justify-center shrink-0">{icon}</div>
      <div>
        <div className="font-semibold text-slate-800 text-sm">{title}</div>
        <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.5 12 2.5 6.7 2.5 2.5 6.7 2.5 12S6.7 21.5 12 21.5c6.9 0 9.5-4.8 9.5-9.2 0-.6-.1-1.1-.2-1.6H12z"/>
    </svg>
  );
}
