import * as THREE from "three";
import { ADDITION, Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import type { Feature, Model } from "./model";

function primitiveGeometry(f: Feature): THREE.BufferGeometry {
  if (f.shape === "box") {
    return new THREE.BoxGeometry(f.width_mm!, f.depth_mm!, f.height_mm!);
  }
  if (f.shape === "sphere") {
    return new THREE.SphereGeometry(f.radius_mm!, 48, 32);
  }
  // Three's cylinder runs along Y; rotate it onto the requested axis.
  const g = new THREE.CylinderGeometry(f.radius_mm!, f.radius_mm!, f.height_mm!, 64);
  if (f.axis === "z") g.rotateX(Math.PI / 2);
  if (f.axis === "x") g.rotateZ(Math.PI / 2);
  return g;
}

function toBrush(f: Feature): Brush {
  const brush = new Brush(primitiveGeometry(f));
  brush.position.set(f.position_mm.x, f.position_mm.y, f.position_mm.z);
  brush.updateMatrixWorld();
  return brush;
}

/** Evaluate the CSG feature list into a single mesh geometry (in mm). */
export function buildGeometry(model: Model): THREE.BufferGeometry | null {
  if (model.features.length === 0) return null;
  const evaluator = new Evaluator();
  evaluator.attributes = ["position", "normal"];

  let result: Brush | null = null;
  for (const f of model.features) {
    const brush = toBrush(f);
    if (!result) {
      if (f.op === "add") result = brush;
      continue;
    }
    result = evaluator.evaluate(result, brush, f.op === "add" ? ADDITION : SUBTRACTION);
    result.updateMatrixWorld();
  }
  if (!result) return null;

  const geometry = result.geometry.clone();
  geometry.applyMatrix4(result.matrixWorld);
  geometry.computeBoundingBox();
  return geometry;
}

export function exportStl(geometry: THREE.BufferGeometry): Blob {
  const mesh = new THREE.Mesh(geometry);
  const data = new STLExporter().parse(mesh, { binary: true }) as DataView;
  return new Blob([data.buffer as ArrayBuffer], { type: "model/stl" });
}

/** Volume of a closed triangle mesh (divergence theorem), in mm³. */
export function meshVolume(geometry: THREE.BufferGeometry): number {
  const pos = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const count = index ? index.count : pos.count;
  let vol = 0;
  for (let i = 0; i < count; i += 3) {
    const [i0, i1, i2] = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2];
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    vol += a.dot(b.cross(c)) / 6;
  }
  return Math.abs(vol);
}
