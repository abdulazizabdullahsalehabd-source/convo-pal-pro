// Direct (frontend) calls to Groq / OpenRouter using fetch.
// Keys come from import.meta.env.VITE_GROQ_API_KEY and VITE_OPENROUTER_API_KEY.
// NOTE: any VITE_* value is bundled into the browser and therefore public.

export type ChatMsg = { role: "user" | "assistant"; content: string };

export type ClientReply = {
  reply: string;
  reply_language: "en" | "ar";
  correction: null | { wrong: string; correct: string; hint: string };
};

const DEVELOPER_INFO = `معلومات مطور التطبيق (استخدمها فقط إذا سأل المستخدم عن الصانع أو المطور أو من صنع التطبيق):
الاسم: عبد العزيز عبد الله صالح عَبَد، من مديرية تريم، محافظة حضرموت، اليمن. يدرس في ثانوية سيئون النموذجية، وشغوف بالذكاء الاصطناعي ويصنع تطبيقات ومواقع وأنظمة برمجية بالاعتماد على أحدث تقنيات الذكاء الاصطناعي.
In English: Abdulaziz Abdullah Saleh Abd, from Tarim, Hadhramaut, Yemen; student at Seiyun Model Secondary School, passionate about AI.`;

const SYSTEM_PROMPT = `You are "صديق المحادثة" (Conversation Friend), a warm, highly accurate conversation partner that helps users practice spoken English.

ABSOLUTE RULES:
1. The LAST user message is the task. Earlier messages are context only.
2. Answer the actual question directly and specifically, then optionally one short follow-up question.
3. Never repeat a previous assistant reply.
4. reply_language MUST equal the language of the user's LAST message: Arabic letters (U+0600–U+06FF) => "ar", otherwise "en". The whole reply must be in that language.
5. Only English or Arabic. Keep replies 1–3 sentences.
6. English replies: natural, correct English. If the user's last English message has ANY real mistake, fill correction with { wrong, correct, hint } where wrong is the exact incorrect phrase, correct is the fix, and hint is a very short Arabic explanation (under 12 words). Only null when the English is genuinely correct.
7. Arabic replies: fluent, grammatically correct Modern Standard Arabic, easy to read aloud, ending with one short warm sentence encouraging English next time. correction = null.
8. Never say you are an AI or mention any provider.

${DEVELOPER_INFO}

Reply ONLY with valid JSON: { "reply": string, "reply_language": "en"|"ar", "correction": null | { "wrong": string, "correct": string, "hint": string } }`;

const GROQ_KEY = import.meta.env.VITE_GROQ_API_KEY as string | undefined;
const OPENROUTER_KEY = import.meta.env.VITE_OPENROUTER_API_KEY as string | undefined;

export function hasClientAiKeys() {
  return Boolean(GROQ_KEY || OPENROUTER_KEY);
}

export function detectLanguage(text: string): "ar" | "en" {
  return /[\u0600-\u06FF]/.test(text) ? "ar" : "en";
}

function parseReply(raw: string): ClientReply | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[0]);
    if (typeof data?.reply !== "string" || !data.reply.trim()) return null;
    const lang = data.reply_language === "ar" ? "ar" : "en";
    const c = data.correction;
    const correction =
      c && typeof c.wrong === "string" && typeof c.correct === "string"
        ? { wrong: c.wrong, correct: c.correct, hint: String(c.hint ?? "") }
        : null;
    return { reply: data.reply.trim(), reply_language: lang, correction };
  } catch {
    return null;
  }
}

type Endpoint = {
  label: string;
  url: string;
  key: string;
  models: string[];
};

function endpoints(): Endpoint[] {
  const list: Endpoint[] = [];
  if (GROQ_KEY) {
    list.push({
      label: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: GROQ_KEY,
      models: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    });
  }
  if (OPENROUTER_KEY) {
    list.push({
      label: "openrouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      key: OPENROUTER_KEY,
      models: ["openai/gpt-oss-20b:free", "google/gemma-4-31b-it:free"],
    });
  }
  return list;
}

async function callModel(ep: Endpoint, model: string, messages: ChatMsg[]) {
  const res = await fetch(ep.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ep.key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    }),
  });
  if (!res.ok) throw new Error(`${ep.label} ${res.status}`);
  const json = await res.json();
  const text: string = json?.choices?.[0]?.message?.content ?? "";
  return parseReply(text);
}

/**
 * Generates the assistant reply straight from the browser.
 * Returns null when no VITE_* key is configured, so the caller can fall back.
 */
export async function generateReplyFromClient(
  userText: string,
  history: ChatMsg[],
): Promise<ClientReply | null> {
  const eps = endpoints();
  if (eps.length === 0) return null;

  const userLanguage = detectLanguage(userText);
  const messages: ChatMsg[] = [...history, { role: "user", content: userText }].slice(-18);
  let lastErr: unknown = null;

  for (const ep of eps) {
    for (const model of ep.models) {
      try {
        const out = await callModel(ep, model, messages);
        if (!out) continue;
        if (out.reply_language !== userLanguage) {
          out.reply_language = userLanguage;
        }
        return out;
      } catch (err) {
        lastErr = err;
      }
    }
  }
  if (lastErr) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  return null;
}