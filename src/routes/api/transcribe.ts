import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const inForm = await request.formData();
        const file = inForm.get("file");
        if (!(file instanceof Blob)) {
          return new Response("Missing audio file", { status: 400 });
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
        const ext = extMap[type] ?? "webm";

        const upstream = new FormData();
        upstream.append("file", file, `recording.${ext}`);
        upstream.append("model", "openai/gpt-4o-mini-transcribe");

        const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body: upstream,
        });

        if (!res.ok) {
          const err = await res.text().catch(() => "");
          return new Response(err || `Transcription failed: ${res.status}`, { status: res.status });
        }

        const json = (await res.json()) as { text?: string };
        return Response.json({ text: (json.text ?? "").trim() });
      },
    },
  },
});