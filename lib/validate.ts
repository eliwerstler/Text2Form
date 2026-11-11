import type { Feature, Model } from "./model";

export const LIMITS = {
  maxFeatures: 40,
  minSizeMm: 0.1,
  maxSizeMm: 2000,
  maxOffsetMm: 2000,
};

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

/** Axis-aligned bounding box of a single primitive. */
export function featureBounds(f: Feature): Bounds {
  const { x, y, z } = f.position_mm;
  let half: [number, number, number];
  if (f.shape === "box") {
    half = [(f.width_mm ?? 0) / 2, (f.depth_mm ?? 0) / 2, (f.height_mm ?? 0) / 2];
  } else if (f.shape === "sphere") {
    const r = f.radius_mm ?? 0;
    half = [r, r, r];
  } else {
    const r = f.radius_mm ?? 0;
    const h = (f.height_mm ?? 0) / 2;
    half = f.axis === "x" ? [h, r, r] : f.axis === "y" ? [r, h, r] : [r, r, h];
  }
  return {
    min: [x - half[0], y - half[1], z - half[2]],
    max: [x + half[0], y + half[1], z + half[2]],
  };
}

function union(a: Bounds, b: Bounds): Bounds {
  return {
    min: [0, 1, 2].map((i) => Math.min(a.min[i], b.min[i])) as Bounds["min"],
    max: [0, 1, 2].map((i) => Math.max(a.max[i], b.max[i])) as Bounds["max"],
  };
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return [0, 1, 2].every((i) => a.min[i] < b.max[i] && b.min[i] < a.max[i]);
}

/** Bounding box of everything that is added (subtractions can only shrink it). */
export function modelBounds(model: Model): Bounds | null {
  let acc: Bounds | null = null;
  for (const f of model.features) {
    if (f.op !== "add") continue;
    const b = featureBounds(f);
    acc = acc ? union(acc, b) : b;
  }
  return acc;
}

function checkSize(label: string, name: string, v: number | null, errors: string[]) {
  if (v === null || !Number.isFinite(v)) {
    errors.push(`"${label}": ${name} is required.`);
  } else if (v < LIMITS.minSizeMm || v > LIMITS.maxSizeMm) {
    errors.push(`"${label}": ${name} must be between ${LIMITS.minSizeMm} and ${LIMITS.maxSizeMm} mm (got ${v}).`);
  }
}

/**
 * Semantic checks the JSON schema can't express. These messages are written so
 * they can be fed straight back to the LLM as a repair prompt.
 */
export function validateModel(model: Model): string[] {
  const errors: string[] = [];
  const { features } = model;

  if (features.length > LIMITS.maxFeatures) {
    errors.push(`Too many features (${features.length}); the limit is ${LIMITS.maxFeatures}.`);
  }
  if (features.length > 0 && features[0].op !== "add") {
    errors.push(`The first feature must be "add"; there is nothing to subtract from yet.`);
  }

  let solid: Bounds | null = null;
  features.forEach((f) => {
    const label = f.label || "unnamed feature";
    if (f.shape === "box") {
      checkSize(label, "width_mm", f.width_mm, errors);
      checkSize(label, "depth_mm", f.depth_mm, errors);
      checkSize(label, "height_mm", f.height_mm, errors);
    } else if (f.shape === "cylinder") {
      checkSize(label, "radius_mm", f.radius_mm, errors);
      checkSize(label, "height_mm", f.height_mm, errors);
      if (!f.axis) errors.push(`"${label}": cylinder needs an axis (x, y, or z).`);
    } else {
      checkSize(label, "radius_mm", f.radius_mm, errors);
    }

    const p = f.position_mm;
    if ([p.x, p.y, p.z].some((v) => !Number.isFinite(v) || Math.abs(v) > LIMITS.maxOffsetMm)) {
      errors.push(`"${label}": position must be within ±${LIMITS.maxOffsetMm} mm of the origin.`);
    }

    if (errors.length) return;
    const b = featureBounds(f);
    if (f.op === "subtract" && solid && !overlaps(b, solid)) {
      errors.push(`"${label}": this cut doesn't touch the part, so it would do nothing. Check its position.`);
    }
    if (f.op === "add") solid = solid ? union(solid, b) : b;
  });

  return errors;
}
