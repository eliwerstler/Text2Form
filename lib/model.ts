import { z } from "zod";

/**
 * The intermediate representation (IR) sits between language and geometry.
 *
 * A model is an ordered list of features. Each feature is a primitive solid that
 * is either added to (union) or subtracted from (difference) the result so far.
 * All lengths are millimeters. Z is up. Each primitive is centered on its position.
 *
 * Fields that don't apply to a shape are null. That keeps the schema flat, which
 * works well with structured outputs.
 */
export const FeatureSchema = z.object({
  label: z.string().describe("Short human name, e.g. 'base plate' or 'mounting hole 1'"),
  op: z.enum(["add", "subtract"]),
  shape: z.enum(["box", "cylinder", "sphere"]),
  width_mm: z.number().nullable().describe("Box size along X. Null for other shapes."),
  depth_mm: z.number().nullable().describe("Box size along Y. Null for other shapes."),
  height_mm: z
    .number()
    .nullable()
    .describe("Box size along Z, or cylinder length along its axis. Null for spheres."),
  radius_mm: z.number().nullable().describe("Cylinder or sphere radius. Null for boxes."),
  axis: z
    .enum(["x", "y", "z"])
    .nullable()
    .describe("Cylinder axis. Null for boxes and spheres."),
  position_mm: z
    .object({ x: z.number(), y: z.number(), z: z.number() })
    .describe("Center of the primitive"),
});

export const ModelSchema = z.object({
  features: z.array(FeatureSchema),
});

/** What the LLM returns: either an updated model or a clarifying question. */
export const LlmResponseSchema = z.object({
  status: z.enum(["ok", "clarify"]),
  question: z
    .string()
    .nullable()
    .describe("If status is 'clarify', one short question for the user. Otherwise null."),
  summary: z
    .string()
    .describe("One sentence describing what was built or changed, in plain English."),
  model: ModelSchema.describe("The complete updated model. On 'clarify', return the current model unchanged."),
});

export type Feature = z.infer<typeof FeatureSchema>;
export type Model = z.infer<typeof ModelSchema>;
export type LlmResponse = z.infer<typeof LlmResponseSchema>;

export const EMPTY_MODEL: Model = { features: [] };

export const MM_PER_UNIT = { mm: 1, cm: 10, in: 25.4 } as const;
