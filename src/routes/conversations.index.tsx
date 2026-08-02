import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, MessageSquare, Trash2, LogOut, Sparkles } from "lucide-react";
import { createConversation, deleteConversation, listConversations } from "@/lib/chat.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/conversations/")({
  head: () => ({
    meta: [
      { title: "محادثاتي — صديق المحادثة" },
      { name: "description", content: "قائمة محادثاتك المحفوظة في تطبيق صديق المحادثة." },
      { property: "og:title", content: "محادثاتي — صديق المحادثة" },
      { property: "og:description", content: "تابع محادثاتك السابقة وابدأ تدريباً جديداً على الإنجليزية." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ConversationsList,
});

function ConversationsList() {
  const list = useServerFn(listConversations);
  const create = useServerFn(createConversation);
  const del = useServerFn(deleteConversation);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  const { data, isLoading } = useQuery({ queryKey: ["conversations"], queryFn: () => list() });

  const createMut = useMutation({
    mutationFn: (t: string) => create({ data: { title: t } }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      setOpen(false);
      setTitle("");
      navigate({ to: "/conversations/$id", params: { id: row.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-emerald-500 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-bold text-slate-900 text-sm">صديق المحادثة</div>
            <div className="text-[11px] text-slate-500">محادثاتك المحفوظة</div>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={signOut} aria-label="خروج">
          <LogOut className="w-5 h-5" />
        </Button>
      </header>

      <main className="max-w-xl mx-auto px-4 py-4 pb-28">
        {isLoading ? (
          <div className="text-center text-slate-400 py-16">جاري التحميل...</div>
        ) : !data || data.length === 0 ? (
          <div className="text-center py-16">
            <MessageSquare className="w-12 h-12 mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500 mb-2">لا توجد محادثات بعد</p>
            <p className="text-sm text-slate-400">اضغط زر + لبدء محادثتك الأولى</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {data.map((c) => (
              <li key={c.id} className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl p-3">
                <Link
                  to="/conversations/$id"
                  params={{ id: c.id }}
                  className="flex-1 flex items-center gap-3 min-w-0"
                >
                  <div className="w-10 h-10 rounded-xl bg-sky-100 text-sky-600 flex items-center justify-center shrink-0">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-800 text-sm truncate">{c.title}</div>
                    <div className="text-[11px] text-slate-400">
                      {new Date(c.updated_at).toLocaleString("ar")}
                    </div>
                  </div>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    if (confirm("حذف هذه المحادثة؟")) delMut.mutate(c.id);
                  }}
                  aria-label="حذف"
                >
                  <Trash2 className="w-4 h-4 text-rose-500" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </main>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button
            className="fixed bottom-6 left-1/2 -translate-x-1/2 w-16 h-16 rounded-full bg-gradient-to-br from-sky-500 to-emerald-500 text-white shadow-xl shadow-sky-300/50 flex items-center justify-center active:scale-95 transition-transform"
            aria-label="محادثة جديدة"
          >
            <Plus className="w-8 h-8" />
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-right">محادثة جديدة</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <label className="text-sm text-slate-600 mb-1 block">اسم المحادثة</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: تدريب يومي"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim()) createMut.mutate(title.trim());
              }}
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => title.trim() && createMut.mutate(title.trim())}
              disabled={!title.trim() || createMut.isPending}
              className="w-full"
            >
              {createMut.isPending ? "..." : "إنشاء والبدء"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}