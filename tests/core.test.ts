import { describe, expect, it, vi } from "vitest";
import { buildGeometry, meshVolume } from "../lib/geometry";
import { generateModel } from "../lib/llm";
import { EMPTY_MODEL, type Feature, type LlmResponse, type Model } from "../lib/model";
import { parsePrompt } from "../lib/parser";
import { validateModel } from "../lib/validate";

const plate: Feature = {
  label: "plate", op: "add", shape: "box",
  width_mm: 100, depth_mm: 50, height_mm: 10, radius_mm: null, axis: null,
  position_mm: { x: 0, y: 0, z: 5 },
};
const hole = (x: number): Feature => ({
  label: "hole", op: "subtract", shape: "cylinder",
  width_mm: null, depth_mm: null, height_mm: 12, radius_mm: 5, axis: "z",
  position_mm: { x, y: 0, z: 5 },
});

describe("rule-based parser", () => {
  it("parses inch boxes into mm", () => {
    const { model } = parsePrompt("create 2x2x2 in box", EMPTY_MODEL);
    expect(model.features[0]).toMatchObject({ shape: "box", width_mm: 50.8, height_mm: 50.8 });
  });

  it("adds to the existing model with 'add'", () => {
    const a = parsePrompt("cube 10mm", EMPTY_MODEL).model;
    const b = parsePrompt("add sphere radius 1cm", a).model;
    expect(b.features.map((f) => f.shape)).toEqual(["box", "sphere"]);
    expect(b.features[1].radius_mm).toBe(10);
  });

  it("drills a centered through-hole", () => {
    const { model } = parsePrompt("drill 6mm hole", { features: [plate] });
    const h = model.features[1];
    expect(h).toMatchObject({ op: "subtract", shape: "cylinder", radius_mm: 3, axis: "z" });
    expect(h.height_mm!).toBeGreaterThan(10);
  });

  it("rejects free-form prose with a helpful message", () => {
    expect(() => parsePrompt("a bracket for a shelf", EMPTY_MODEL)).toThrow(/API key/);
  });
});

describe("validator", () => {
  it("accepts a plate with a hole", () => {
    expect(validateModel({ features: [plate, hole(20)] })).toEqual([]);
  });

  it("rejects a cut that misses the part", () => {
    const errors = validateModel({ features: [plate, hole(500)] });
    expect(errors.join()).toMatch(/doesn't touch the part/);
  });

  it("rejects starting with a subtraction and missing dimensions", () => {
    const errors = validateModel({ features: [hole(0), { ...plate, depth_mm: null }] });
    expect(errors.join()).toMatch(/first feature must be "add"/);
    expect(errors.join()).toMatch(/depth_mm is required/);
  });
});

describe("geometry", () => {
  it("subtracts holes from the solid", () => {
    const solid = meshVolume(buildGeometry({ features: [plate] })!);
    const withHole = meshVolume(buildGeometry({ features: [plate, hole(20)] })!);
    expect(solid).toBeCloseTo(100 * 50 * 10, -1);
    const holeVol = Math.PI * 5 * 5 * 10;
    expect(solid - withHole).toBeGreaterThan(holeVol * 0.97);
    expect(solid - withHole).toBeLessThan(holeVol * 1.01);
  });
});

describe("LLM pipeline", () => {
  const ok = (model: Model): LlmResponse => ({ status: "ok", question: null, summary: "done", model });

  it("feeds validation errors back and accepts the repaired model", async () => {
    const parse = vi
      .fn()
      .mockResolvedValueOnce({ parsed_output: ok({ features: [plate, hole(500)] }) })
      .mockResolvedValueOnce({ parsed_output: ok({ features: [plate, hole(20)] }) });

    const result = await generateModel("plate with a hole", EMPTY_MODEL, { messages: { parse } } as never, "test");

    expect(result.attempts).toBe(2);
    expect(result.model.features[1].position_mm.x).toBe(20);
    const repairPrompt = parse.mock.calls[1][0].messages.at(-1).content;
    expect(repairPrompt).toMatch(/doesn't touch the part/);
  });

  it("passes clarifying questions straight through", async () => {
    const parse = vi.fn().mockResolvedValue({
      parsed_output: { status: "clarify", question: "How big should the plate be?", summary: "", model: EMPTY_MODEL },
    });
    const result = await generateModel("a plate", EMPTY_MODEL, { messages: { parse } } as never, "test");
    expect(result.status).toBe("clarify");
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("gives up after repeated invalid output", async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: ok({ features: [hole(0)] }) });
    await expect(generateModel("x", EMPTY_MODEL, { messages: { parse } } as never, "test")).rejects.toThrow(/Couldn't produce/);
    expect(parse).toHaveBeenCalledTimes(3);
  });
});
