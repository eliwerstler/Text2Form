import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { LlmResponseSchema, type LlmResponse, type Model } from "./model";
import { validateModel } from "./validate";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
const MAX_REPAIRS = 2;

export const SYSTEM_PROMPT = `You turn plain-English descriptions of simple mechanical parts into a constructive solid geometry (CSG) model.

The model is an ordered list of features. Each feature is a box, cylinder, or sphere that is either added (union) or subtracted (cut) from everything before it.

Conventions:
- All lengths in millimeters. Convert inches (x25.4) and cm (x10) yourself.
- Z is up. Every primitive is centered on position_mm.
- Box: width_mm (X), depth_mm (Y), height_mm (Z). Cylinder: radius_mm, height_mm (length along its axis), axis. Sphere: radius_mm.
- Set fields that don't apply to a shape to null.
- A "through hole" is a subtract cylinder slightly longer than the material it passes through (add about 1 mm per side) so the cut is clean.
- "Diameter" means radius = diameter / 2.
- Unless told otherwise, rest the part on the XY plane (its bottom at z = 0) and center it on X and Y.
- Give every feature a short, specific label ("base plate", "corner hole 3").

You'll get the current model (it may be empty) and the user's request. Return the complete updated model, not just the changes. Keep existing features unless the user asks to change or remove them.

If the request is too vague to build anything sensible (for example, no size given for the main part), set status to "clarify" and ask one short question. Small details that are reasonable to assume, like where to put holes on a plate, are fine to infer. Say what you assumed in the summary.`;

export interface GenerateResult extends LlmResponse {
  attempts: number;
}

/**
 * Prompt -> structured model -> semantic validation -> repair loop.
 *
 * Structured outputs guarantee the response matches the schema. The validator
 * then catches things a schema can't, like a cut that misses the part. Those
 * errors go back to the model so it can correct them.
 */
export async function generateModel(
  prompt: string,
  current: Model,
  client: Pick<Anthropic, "messages"> = new Anthropic(),
  modelName = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
): Promise<GenerateResult> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Current model:\n${JSON.stringify(current)}\n\nRequest: ${prompt}`,
    },
  ];

  for (let attempt = 1; attempt <= MAX_REPAIRS + 1; attempt++) {
    const res = await client.messages.parse({
      model: modelName,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages,
      output_config: { format: zodOutputFormat(LlmResponseSchema) },
    });

    const out = res.parsed_output;
    if (!out) throw new Error("The model didn't return a usable response.");
    if (out.status === "clarify") return { ...out, attempts: attempt };

    const errors = validateModel(out.model);
    if (errors.length === 0) return { ...out, attempts: attempt };

    messages.push(
      { role: "assistant", content: JSON.stringify(out) },
      {
        role: "user",
        content: `That model has problems:\n- ${errors.join("\n- ")}\nReturn a corrected complete model.`,
      },
    );
  }

  throw new Error("Couldn't produce a valid model for that request. Try rephrasing it or adding dimensions.");
}
