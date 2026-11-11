import { NextResponse } from "next/server";
import { z } from "zod";
import { generateModel } from "@/lib/llm";
import { ModelSchema } from "@/lib/model";
import { parsePrompt } from "@/lib/parser";
import { validateModel } from "@/lib/validate";

const RequestSchema = z.object({
  prompt: z.string().trim().min(1).max(500),
  current: ModelSchema,
});

// Basic per-IP limit so a public deploy can't burn through the API key.
// It's in memory, so it resets on cold start. Good enough for a demo.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

export async function POST(req: Request) {
  const body = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Send a prompt (max 500 characters) and the current model." }, { status: 400 });
  }
  const { prompt, current } = body.data;

  // No key: fall back to the deterministic parser so the app still works.
  if (!process.env.ANTHROPIC_API_KEY) {
    try {
      const { model, summary } = parsePrompt(prompt, current);
      const errors = validateModel(model);
      if (errors.length) return NextResponse.json({ error: errors[0] }, { status: 422 });
      return NextResponse.json({ status: "ok", question: null, summary, model, engine: "rules" });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 422 });
    }
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests. Give it a minute." }, { status: 429 });
  }

  try {
    const result = await generateModel(prompt, current);
    return NextResponse.json({ ...result, engine: "llm" });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
