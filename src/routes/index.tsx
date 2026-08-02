import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
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
          <Feature icon={<MessageCircleHeart className="w-5 h-5" />} title="بدون تسجيل دخول" desc="محادثاتك محفوظة في ذاكرة جهازك فقط" />
        </div>

        <Button
          onClick={() => navigate({ to: "/conversations" })}
          size="lg"
          className="w-full max-w-sm h-14 text-base rounded-2xl bg-slate-900 hover:bg-slate-800 shadow-lg"
        >
          <MessageCircleHeart className="w-5 h-5" />
          <span className="mr-2">ابدأ المحادثة الآن</span>
        </Button>

        <p className="text-xs text-slate-400 mt-6 max-w-xs">
          لا حاجة لأي حساب — محادثاتك تُحفظ في ذاكرة هذا الجهاز فقط.
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
