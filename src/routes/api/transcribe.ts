import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        const groqKey = process.env.GROQ_API_KEY;
        if (!key && !groqKey) return new Response("No transcription provider configured", { status: 500 });

        const inForm = await request.formData();
        const file = inForm.get("file");
        if (!(file instanceof Blob)) {
          return new Response("Missing audio file", { status: 400 });
        }
        if (file.size < 2048) {
          return new Response("التسجيل فارغ أو قصير جداً — حاول مرة أخرى.", { status: 400 });
        }
        if (file.size > 25 * 1024 * 1024) {
          return new Response("التسجيل طويل جداً — اجعله أقصر قليلاً.", { status: 413 });
        }

        // Ensure the upload has a filename with a real extension the provider recognizes.
        const type = (file.type || "").split(";")[0];
        const extMap: Record<string, string> = {
          "audio/webm": "webm",
          "audio/ogg": "ogg",
          "audio/mp4": "mp4",
          "audio/mpeg": "mp3",
          "audio/mpga": "mp3",
          "audio/wav": "wav",
          "audio/x-wav": "wav",
          "audio/wave": "wav",
        };
        if (type && !extMap[type]) {
          return new Response("صيغة الصوت غير مدعومة — حاول التسجيل من المتصفح مباشرة.", { status: 400 });
        }
        const ext = extMap[type] ?? "webm";

        const promptHint =
          "Transcribe the user's speech accurately. The user may speak English or Arabic. Preserve the spoken language, use correct spelling, and do not translate.";

        const buildForm = (model: string) => {
          const f = new FormData();
          f.append("file", file, `recording.${ext}`);
          f.append("model", model);
          f.append("prompt", promptHint);
          return f;
        };

        type Attempt = { url: string; headers: Record<string, string>; model: string };
        const attempts: Attempt[] = [];

        // 1) Groq Whisper — free tier, very generous limits
        if (groqKey) {
          attempts.push({
            url: "https://api.groq.com/openai/v1/audio/transcriptions",
            headers: { Authorization: `Bearer ${groqKey}` },
            model: "whisper-large-v3-turbo",
          });
          attempts.push({
            url: "https://api.groq.com/openai/v1/audio/transcriptions",
            headers: { Authorization: `Bearer ${groqKey}` },
            model: "whisper-large-v3",
          });
        }

        // 2) Lovable AI Gateway (workspace credits)
        if (key) {
          attempts.push({
            url: "https://ai.gateway.lovable.dev/v1/audio/transcriptions",
            headers: { Authorization: `Bearer ${key}` },
            model: "openai/gpt-4o-mini-transcribe",
          });
        }

        let lastStatus = 500;
        let lastErr = "";

        for (const attempt of attempts) {
          try {
            const res = await fetch(attempt.url, {
              method: "POST",
              headers: attempt.headers,
              body: buildForm(attempt.model),
            });
            if (res.ok) {
              const json = (await res.json()) as { text?: string };
              const text = (json.text ?? "").trim();
              if (text) return Response.json({ text });
              return Response.json({ text: "" });
            }
            lastStatus = res.status;
            lastErr = await res.text().catch(() => "");
          } catch (e) {
            lastStatus = 502;
            lastErr = e instanceof Error ? e.message : String(e);
          }
        }

        if (lastStatus === 402 || lastErr.includes("payment_required") || lastErr.includes("Not enough credits")) {
          return new Response("نفد رصيد تحويل الصوت إلى نص مؤقتاً — يمكنك الكتابة الآن أو المحاولة لاحقاً.", { status: 402 });
        }
        return new Response(lastErr || `Transcription failed: ${lastStatus}`, { status: lastStatus });
      },
    },
  },
});