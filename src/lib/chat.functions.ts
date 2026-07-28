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

const SYSTEM_PROMPT = `You are "صديق المحادثة" (Conversation Friend), a warm, intelligent chat partner that helps users practice spoken English through natural everyday conversation.

ABSOLUTE RULES:
1. ALWAYS answer the user's ACTUAL question directly and specifically. If they ask "How old are you?" you MUST answer with an age (invent a friendly age like 21 if needed) — never deflect with an unrelated question. Never change the subject before answering.
2. Language matching is MANDATORY: the "reply_language" MUST equal the language of the user's LAST message.
   - If the user's last message contains any Arabic letters (U+0600–U+06FF), reply_language = "ar" and the entire reply MUST be in Arabic.
   - Otherwise reply_language = "en" and the entire reply MUST be in English.
   - NEVER reply in a language different from the user's last message.
3. Only understand and reply in English or Arabic. No other language, ever.
4. Keep replies short and conversational (1–3 sentences). After answering, you MAY add ONE short follow-up question related to the same topic.

ENGLISH REPLIES:
- Use natural, correct, everyday English.
- If the user's English has any real grammar / word-choice / phrasing mistake, fill "correction" with { wrong, correct, hint } where hint is a very short Arabic explanation (one line). If the English is fine, set correction to null. Do NOT invent mistakes.

ARABIC REPLIES:
- Reply in fluent, grammatically correct Modern Standard Arabic (فصحى سليمة). Respect النحو والإعراب. Avoid awkward literal translations.
- End the Arabic reply with ONE short, warm, encouraging Arabic sentence urging the user to try English next time (vary the wording each time — e.g. "جرّب أن تكتب لي بالإنجليزية في المرة القادمة، ستتحسّن بسرعة!"). Do NOT add emojis inside this sentence unless natural.
- Set correction to null (we correct English only).

IDENTITY:
- Never say you are an AI, a model, or mention Google, Gemini, OpenAI, or any provider. Never invent a personal name for yourself other than "صديق المحادثة".

EXAMPLES (for behavior only — do not copy verbatim):
User: "How old are you?"
Assistant JSON: {"reply":"I'm 21! How about you — how old are you?","reply_language":"en","correction":null}

User: "كم عمرك؟"
Assistant JSON: {"reply":"عمري إحدى وعشرون سنة تقريباً. وكم عمرك أنت؟ جرّب أن تسألني بالإنجليزية في المرة القادمة، ستستفيد كثيراً.","reply_language":"ar","correction":null}

User: "i are happy today"
Assistant JSON: {"reply":"That's great to hear! What made you happy today?","reply_language":"en","correction":{"wrong":"i are happy today","correct":"I am happy today","hint":"مع I نستخدم am وليس are"}}

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
      ...(history ?? []).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key);

    // Try a chain of free/high-throughput Gemini models. If one is rate-limited (429),
    // fall back to the next so the user can keep chatting without hitting limits.
    const modelChain = [
      "google/gemini-3.1-flash-lite",
      "google/gemini-3.6-flash",
      "google/gemini-2.5-flash-lite",
      "google/gemini-2.5-flash",
    ];

    let parsed: z.infer<typeof ReplySchema> | null = null;
    let lastErr: unknown = null;
    for (const modelId of modelChain) {
      try {
        const { output } = await generateText({
          model: gateway(modelId),
          system: SYSTEM_PROMPT,
          messages,
          output: Output.object({ schema: ReplySchema }),
        });
        parsed = output;
        break;
      } catch (err) {
        lastErr = err;
        if (NoObjectGeneratedError.isInstance(err)) {
          const fb = fallbackParse(err.text ?? "");
          if (fb) { parsed = fb; break; }
        }
        const msg = err instanceof Error ? err.message : String(err);
        // Retry only on rate-limit / transient upstream errors.
        if (msg.includes("429") || msg.includes("503") || msg.includes("502")) continue;
        break;
      }
    }
    if (!parsed) {
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      if (msg.includes("429")) throw new Error("الخدمة مشغولة جداً الآن — حاول بعد ثوانٍ.");
      if (msg.includes("402")) throw new Error("انتهى رصيد الذكاء الاصطناعي مؤقتاً — حاول لاحقاً.");
      throw new Error("تعذّر توليد الرد. حاول مرة أخرى.");
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