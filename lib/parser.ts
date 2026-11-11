import { EMPTY_MODEL, MM_PER_UNIT, type Feature, type Model } from "./model";
import { modelBounds } from "./validate";

/**
 * Rule-based parser for a small, strict grammar. This was the v1 engine. It now
 * runs as the offline fallback when no LLM key is set, and it's a baseline to
 * compare the LLM against.
 *
 *   create 2x2x2 in box | box 10mm by 20mm by 5mm | cube 3cm
 *   add cylinder radius 10mm height 20mm
 *   add sphere radius 1cm
 *   drill 5mm hole          (a through-hole along Z at the center)
 *   clear
 */

const NUM = "([0-9]*\\.?[0-9]+)";
const UNIT = "(mm|cm|in|inch|inches)";

function toMm(value: string, unit = "mm"): number {
  const u = unit.startsWith("in") ? "in" : (unit as "mm" | "cm");
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Dimensions must be positive numbers.");
  return n * MM_PER_UNIT[u];
}

// Rest parts on the XY plane, matching the LLM's convention.
const onPlane = (halfHeight: number) => ({ x: 0, y: 0, z: halfHeight });

function box(w: number, d: number, h: number, label = "box"): Feature {
  return {
    label, op: "add", shape: "box",
    width_mm: w, depth_mm: d, height_mm: h, radius_mm: null, axis: null,
    position_mm: onPlane(h / 2),
  };
}

function parsePrimitive(s: string): Feature | null {
  let m = s.match(new RegExp(`^${NUM}\\s*x\\s*${NUM}\\s*x\\s*${NUM}\\s*${UNIT}\\s*(box|cube)$`));
  if (m) return box(toMm(m[1], m[4]), toMm(m[2], m[4]), toMm(m[3], m[4]));

  m = s.match(new RegExp(`^box\\s+${NUM}\\s*${UNIT}?\\s+by\\s+${NUM}\\s*${UNIT}?\\s+by\\s+${NUM}\\s*${UNIT}?$`));
  if (m) return box(toMm(m[1], m[2]), toMm(m[3], m[4]), toMm(m[5], m[6]));

  m = s.match(new RegExp(`^(?:cube\\s+${NUM}\\s*${UNIT}?|${NUM}\\s*${UNIT}\\s+cube)$`));
  if (m) {
    const size = m[1] ? toMm(m[1], m[2]) : toMm(m[3], m[4]);
    return box(size, size, size, "cube");
  }

  m = s.match(new RegExp(`^cylinder\\s+radius\\s+${NUM}\\s*${UNIT}?\\s+height\\s+${NUM}\\s*${UNIT}?$`));
  if (m) {
    return {
      label: "cylinder", op: "add", shape: "cylinder",
      width_mm: null, depth_mm: null, height_mm: toMm(m[3], m[4]), radius_mm: toMm(m[1], m[2]), axis: "z",
      position_mm: onPlane(toMm(m[3], m[4]) / 2),
    };
  }

  m = s.match(new RegExp(`^sphere\\s+radius\\s+${NUM}\\s*${UNIT}?$`));
  if (m) {
    return {
      label: "sphere", op: "add", shape: "sphere",
      width_mm: null, depth_mm: null, height_mm: null, radius_mm: toMm(m[1], m[2]), axis: null,
      position_mm: onPlane(toMm(m[1], m[2])),
    };
  }

  if (/^(box|cube|cylinder|sphere)\b/.test(s)) {
    throw new Error(`Couldn't read the dimensions for "${s}". Try "box 10mm by 20mm by 5mm".`);
  }
  return null;
}

function parseHole(s: string, current: Model): Feature | null {
  const m = s.match(new RegExp(`^(?:drill\\s+)?(?:an?\\s+)?${NUM}\\s*${UNIT}?\\s+(?:diameter\\s+)?hole(?:\\s+through\\s+(?:the\\s+)?center)?$`));
  if (!m) return null;
  const b = modelBounds(current);
  if (!b) throw new Error("There's nothing to drill into yet. Create a part first.");
  const height = b.max[2] - b.min[2] + 2;
  return {
    label: "hole", op: "subtract", shape: "cylinder",
    width_mm: null, depth_mm: null, height_mm: height, radius_mm: toMm(m[1], m[2]) / 2, axis: "z",
    position_mm: { x: (b.min[0] + b.max[0]) / 2, y: (b.min[1] + b.max[1]) / 2, z: (b.min[2] + b.max[2]) / 2 },
  };
}

export function parsePrompt(prompt: string, current: Model): { model: Model; summary: string } {
  const s = prompt.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) throw new Error("Prompt is empty.");
  if (s === "clear") return { model: EMPTY_MODEL, summary: "Cleared the model." };

  const hole = parseHole(s, current);
  if (hole) {
    return {
      model: { features: [...current.features, hole] },
      summary: `Drilled a ${(hole.radius_mm! * 2).toFixed(1)} mm hole through the center.`,
    };
  }

  const cmd = s.match(/^(create|make|add)\s+(?:an?\s+)?(.+)$/);
  const verb = cmd?.[1] ?? "create";
  const feature = parsePrimitive(cmd ? cmd[2] : s);
  if (!feature) {
    throw new Error(
      'Offline mode only understands a few fixed phrasings, like "create 2x2x2 in box" or "drill 5mm hole". Add an API key to use plain English.',
    );
  }
  if (verb === "add") {
    return { model: { features: [...current.features, feature] }, summary: `Added a ${feature.shape}.` };
  }
  return { model: { features: [feature] }, summary: `Created a ${feature.shape}.` };
}
