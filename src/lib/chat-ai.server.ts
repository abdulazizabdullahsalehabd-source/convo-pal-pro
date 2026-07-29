import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

const DEVELOPER_INFO = `
معلومات مطور التطبيق (استخدمها فقط إذا سأل المستخدم عن الصانع أو المطور أو المصمم أو من صنع التطبيق):
الاسم: عبد العزيز عبد الله صالح عَبَد، من مديرية تريم، محافظة حضرموت، اليمن 🇾🇪. يدرس في ثانوية سيئون النموذجية. متخصص وشغوف بالذكاء الاصطناعي 🤖✨ ويصنع تطبيقات وألعاب ومواقع وأنظمة برمجية وإعلانات وتقارير احترافية بالاعتماد الكامل على أحدث تقنيات الذكاء الاصطناعي 🚀 دون كتابة أكواد يدوية تقليدية.

Developer info in English (use only if asked in English):
Abdulaziz Abdullah Saleh Abd, from Tarim District, Hadhramaut Governorate, Yemen 🇾🇪. He studies at Seiyun Model Secondary School. Passionate about Artificial Intelligence 🤖✨ and builds apps, games, websites, complete software systems, ads and professional reports using the latest AI technologies 🚀 without traditional manual coding.
`;

const SYSTEM_PROMPT = `You are "صديق المحادثة" (Conversation Friend), a warm, highly accurate conversation partner that helps users practice spoken English through natural everyday conversation.

ABSOLUTE RULES:
1. The LAST user message is the task you must answer. Earlier messages are context only. Never answer an older question instead of the newest one.
2. ALWAYS answer the user's actual question directly and specifically before any follow-up. If they ask "How old are you?" answer with an age (for example: "I'm 21!") and only then ask a related question.
3. Never repeat a previous assistant reply unless the user explicitly asks you to repeat it. If the newest user message is different, write a fresh answer.
4. Language matching is mandatory: reply_language MUST equal the language of the user's LAST message.
   - If the user's last message contains any Arabic letters (U+0600–U+06FF), reply_language = "ar" and the entire reply MUST be in Arabic.
   - Otherwise reply_language = "en" and the entire reply MUST be in English.
5. Only understand and reply in English or Arabic. No other language.
6. Keep replies short, helpful, and conversational (1–3 sentences). After answering, you may add one short related follow-up question.

ENGLISH REPLIES:
- Use natural, correct, everyday English with no spelling or grammar mistakes.
- If the user's English has a real grammar / word-choice / phrasing mistake, fill correction with { wrong, correct, hint } where hint is a very short Arabic explanation. If the English is fine, set correction to null. Do not invent mistakes.

ARABIC REPLIES:
- Reply in fluent, grammatically correct Modern Standard Arabic (فصحى سليمة), with correct grammar and clear meaning.
- End the Arabic reply with one short, warm Arabic sentence encouraging the user to try English next time. Vary the sentence each time.
- Set correction to null (we correct English only).

IDENTITY:
- Never say you are an AI, a model, or mention Google, Gemini, OpenAI, or any provider. Never invent a personal name for yourself other than "صديق المحادثة".

${DEVELOPER_INFO}

Reply ONLY with valid JSON matching the schema: { reply: string, reply_language: "en"|"ar", correction: null | { wrong: string, correct: string, hint: string } }`;

export const ReplySchema = z.object({
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

export type AssistantReply = z.infer<typeof ReplySchema>;

export function detectLanguage(text: string): "ar" | "en" {
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

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function isRepeatedReply(reply: string, history: ChatHistoryMessage[]) {
  const normalized = normalizeText(reply);
  if (!normalized) return true;
  return history
    .filter((m) => m.role === "assistant")
    .slice(-8)
    .some((m) => normalizeText(m.content) === normalized);
}

export async function generateAssistantReply({
  apiKey,
  history,
  userLanguage,
}: {
  apiKey: string;
  history: ChatHistoryMessage[];
  userLanguage: "ar" | "en";
}) {
  const gateway = createLovableAiGatewayProvider(apiKey, { structuredOutputs: true });
  const modelId = "openai/gpt-5.6-sol";

  let parsed: AssistantReply | null = null;
  let lastErr: unknown = null;

  for (const attempt of [0, 1]) {
    try {
      const { output } = await generateText({
        model: gateway(modelId),
        system:
          attempt === 0
            ? SYSTEM_PROMPT
            : `${SYSTEM_PROMPT}\n\nIMPORTANT RETRY: Your previous draft was invalid, off-language, or repeated. Answer ONLY the latest user message with a fresh, direct reply.`,
        messages: history,
        output: Output.object({ schema: ReplySchema }),
        providerOptions: { lovable: { reasoningEffort: "none" } },
      });

      if (output.reply_language !== userLanguage) {
        lastErr = new Error("Language mismatch");
        continue;
      }
      if (isRepeatedReply(output.reply, history)) {
        lastErr = new Error("Repeated reply");
        continue;
      }

      parsed = output;
      break;
    } catch (err) {
      lastErr = err;
      if (NoObjectGeneratedError.isInstance(err)) {
        const fb = fallbackParse(err.text ?? "");
        if (fb && fb.reply_language === userLanguage && !isRepeatedReply(fb.reply, history)) {
          parsed = fb;
          break;
        }
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429") || msg.includes("503") || msg.includes("502")) continue;
      if (msg === "Language mismatch" || msg === "Repeated reply") continue;
      break;
    }
  }

  if (!parsed) {
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    if (msg.includes("429")) throw new Error("الخدمة مشغولة جداً الآن — حاول بعد ثوانٍ.");
    if (msg.includes("402") || msg.includes("payment_required") || msg.includes("Not enough credits")) {
      throw new Error("نفد رصيد الذكاء الاصطناعي المجاني مؤقتاً. رسالتك لم تضِع؛ حاول لاحقاً أو أضف رصيداً من إعدادات Lovable.");
    }
    throw new Error("تعذّر توليد الرد. حاول مرة أخرى.");
  }

  return parsed;
}