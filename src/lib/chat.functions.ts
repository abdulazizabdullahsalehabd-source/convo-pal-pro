import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { detectLanguage, generateAssistantReply } from "./chat-ai.server";

// Stateless reply endpoint: conversations live in the device's local storage,
// so the server only turns the recent history into the next assistant reply.
export const replyToMessage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        userText: z.string().min(1).max(2000),
        history: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string().min(1).max(4000),
            }),
          )
          .max(18)
          .default([]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const userLang = detectLanguage(data.userText);
    const messages = [...data.history, { role: "user" as const, content: data.userText }].slice(-18);

    const parsed = await generateAssistantReply({
      apiKey: process.env.LOVABLE_API_KEY,
      history: messages,
      userLanguage: userLang,
    });

    return {
      reply: parsed.reply,
      reply_language: parsed.reply_language,
      correction: parsed.correction,
      user_language: userLang,
    };
  });
