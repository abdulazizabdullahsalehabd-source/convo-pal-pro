import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const DEVELOPER_INFO = `
معلومات مطور التطبيق (استخدمها فقط إذا سأل المستخدم عن الصانع أو المطور أو المصمم أو من صنع التطبيق):
الاسم: عبد العزيز عبد الله صالح عَبَد، من مديرية تريم، محافظة حضرموت، اليمن 🇾🇪. يدرس في ثانوية سيئون النموذجية. متخصص وشغوف بالذكاء الاصطناعي 🤖✨ ويصنع تطبيقات وألعاب ومواقع وأنظمة برمجية وإعلانات وتقارير احترافية بالاعتماد الكامل على أحدث تقنيات الذكاء الاصطناعي 🚀 دون كتابة أكواد يدوية تقليدية.

Developer info in English (use only if asked in English):
Abdulaziz Abdullah Saleh Abd, from Tarim District, Hadhramaut Governorate, Yemen 🇾🇪. He studies at Seiyun Model Secondary School. Passionate about Artificial Intelligence 🤖✨ and builds apps, games, websites, complete software systems, ads and professional reports using the latest AI technologies 🚀 without traditional manual coding.
`;

const SYSTEM_PROMPT = `You are "صديق المحادثة" (Conversation Friend), a friendly AI chat partner that helps users practice English through natural everyday conversation.

STRICT LANGUAGE RULES:
1. You only understand and reply in English or Arabic. Do NOT use any other language.
2. Detect the language the user just used (English or Arabic) and reply in the SAME language.
3. If the user wrote/spoke in ENGLISH:
   - Reply in natural conversational English (1-3 short sentences, engaging, ask a follow-up).
   - If the user's English has a grammar, word-choice, or phrasing mistake, fill the "correction" field with { wrong, correct, hint } where hint is a very short Arabic explanation. If English is correct, set correction to null.
4. If the user wrote/spoke in ARABIC:
   - Reply naturally in Arabic (1-3 sentences).
   - Then ALWAYS append a short, warm, encouraging Arabic sentence urging the user to try speaking English next time so they benefit from the app (vary the wording every time — e.g. "💙 جرّب معي بالإنجليزية في الرد القادم، ستفاجأ بنفسك!").
   - Set correction to null (we only correct English).
5. Keep replies short and conversational — this is a chat, not an essay.
6. Never mention that you are an AI model, never mention Google, Gemini, OpenAI, or any provider.
7. Never invent a personal name for yourself other than "صديق المحادثة".

${DEVELOPER_INFO}

Reply ONLY with valid JSON matching the schema: { reply: string, reply_language: "en"|"ar", correction: null | { wrong: string, correct: string, hint: string } }`;

const InputSchema = z.object({
  conversationId: z.string().uuid(),
  userText: z.string().min(1).max(2000),
});

const ReplySchema = z.object({
  reply: z.string(),
  reply_language: z.enum(["en", "ar"]),
  correction: z
    .object({
      wrong: z.string(),
      correct: z.string(),
      hint: z.string(),
    })
    .nullable(),
});

function detectLanguage(text: string): "ar" | "en" {
  return /[\u0600-\u06FF]/.test(text) ? "ar" : "en";
}

function fallbackParse(text: string) {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return ReplySchema.parse(JSON.parse(m[0]));
  } catch {
    return null;
  }
}

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Verify conversation ownership
    const { data: convo, error: convoErr } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (convoErr || !convo) throw new Error("Conversation not found");

    const userLang = detectLanguage(data.userText);

    // Insert user message
    const { error: insertUserErr } = await supabase.from("messages").insert({
      conversation_id: data.conversationId,
      user_id: userId,
      role: "user",
      content: data.userText,
      language: userLang,
    });
    if (insertUserErr) throw insertUserErr;

    // Fetch recent history (last 20 messages)
    const { data: history } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true })
      .limit(20);

    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      ...(history ?? []).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3.1-flash-lite");

    let parsed: z.infer<typeof ReplySchema> | null = null;
    try {
      const { output } = await generateText({
        model,
        messages,
        output: Output.object({ schema: ReplySchema }),
      });
      parsed = output;
    } catch (err) {
      if (NoObjectGeneratedError.isInstance(err)) {
        parsed = fallbackParse(err.text ?? "");
      }
      if (!parsed) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("429")) throw new Error("تم تجاوز عدد الطلبات المسموح مؤقتاً. حاول بعد قليل.");
        if (msg.includes("402")) throw new Error("انتهى رصيد الذكاء الاصطناعي الشهري. تواصل مع المطور.");
        throw new Error("تعذّر توليد الرد: " + msg);
      }
    }

    // Insert assistant message
    const { data: inserted, error: insertAiErr } = await supabase
      .from("messages")
      .insert({
        conversation_id: data.conversationId,
        user_id: userId,
        role: "assistant",
        content: parsed!.reply,
        language: parsed!.reply_language,
        correction: parsed!.correction,
      })
      .select()
      .single();
    if (insertAiErr) throw insertAiErr;

    // Touch conversation updated_at, and if title is default, set from first user text
    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", data.conversationId);

    return { message: inserted };
  });

export const createConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ title: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("conversations")
      .insert({ user_id: context.userId, title: data.title })
      .select()
      .single();
    if (error) throw error;
    return row;
  });

export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("conversations")
      .select("id, title, updated_at, created_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data;
  });

export const deleteConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("conversations").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const listMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ conversationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("messages")
      .select("id, role, content, language, correction, created_at")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return rows;
  });

export const renameConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), title: z.string().min(1).max(80) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("conversations")
      .update({ title: data.title })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });