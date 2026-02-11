const canvas = document.getElementById("viewer");
const ctx = canvas.getContext("2d");
const promptInput = document.getElementById("prompt");
const runButton = document.getElementById("run");
const clearButton = document.getElementById("clear");
const exportButton = document.getElementById("export");
const errorBox = document.getElementById("error");
const summaryBox = document.getElementById("summary");

const NUM = "([0-9]*\\.?[0-9]+)";
const UNIT_CAPTURE = "(mm|cm|in|inch|inches)";
const UNIT = "(?:mm|cm|in|inch|inches)";

const TYPE_COLOR = {
  box: "#2f7f5f",
  cylinder: "#c66d35",
  sphere: "#2f5f98",
};

let nextId = 1;
let model = [];

const camera = {
  yaw: -0.8,
  pitch: 0.45,
  distance: 260,
  target: [0, 0, 0],
  fovDeg: 58,
};

const pointer = {
  dragging: false,
  x: 0,
  y: 0,
};

function vAdd(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function vSub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vMul(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function vDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vCross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function vLen(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

function vNorm(a) {
  const len = vLen(a);
  if (len < 1e-8) {
    return [0, 0, 0];
  }
  return [a[0] / len, a[1] / len, a[2] / len];
}

function unitToMm(unitRaw) {
  const unit = (unitRaw || "mm").toLowerCase();
  if (unit === "mm") return 1;
  if (unit === "cm") return 10;
  if (unit === "in" || unit === "inch" || unit === "inches") return 25.4;
  throw new Error("Unknown unit. Use mm, cm, or in.");
}

function toMm(valueRaw, unitRaw) {
  const value = Number(valueRaw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Dimensions must be positive numbers.");
  }
  return value * unitToMm(unitRaw);
}

function makePrimitive(type, params) {
  return {
    id: `${type}-${nextId++}`,
    type,
    params,
    positionMm: [0, 0, 0],
  };
}

function parseBox(raw) {
  const compact = raw.trim();

  const patternAxBxC = new RegExp(`^${NUM}\\s*x\\s*${NUM}\\s*x\\s*${NUM}\\s*${UNIT_CAPTURE}\\s*(box|cube)$`);
  const m1 = compact.match(patternAxBxC);
  if (m1) {
    const widthMm = toMm(m1[1], m1[4]);
    const depthMm = toMm(m1[2], m1[4]);
    const heightMm = toMm(m1[3], m1[4]);
    return makePrimitive("box", { widthMm, depthMm, heightMm });
  }

  const patternBy = new RegExp(`^box\\s+${NUM}\\s*${UNIT_CAPTURE}\\s+by\\s+${NUM}\\s*${UNIT_CAPTURE}\\s+by\\s+${NUM}\\s*${UNIT_CAPTURE}$`);
  const m2 = compact.match(patternBy);
  if (m2) {
    const widthMm = toMm(m2[1], m2[2]);
    const depthMm = toMm(m2[3], m2[4]);
    const heightMm = toMm(m2[5], m2[6]);
    return makePrimitive("box", { widthMm, depthMm, heightMm });
  }

  const patternCube = new RegExp(`^cube\\s+${NUM}\\s*${UNIT_CAPTURE}$`);
  const m3 = compact.match(patternCube);
  if (m3) {
    const sizeMm = toMm(m3[1], m3[2]);
    return makePrimitive("box", { widthMm: sizeMm, depthMm: sizeMm, heightMm: sizeMm });
  }

  if (compact.startsWith("box") || compact.startsWith("cube")) {
    throw new Error("Box requires 3 dimensions.");
  }
  return null;
}

function parseCylinder(raw) {
  const pattern = new RegExp(`^cylinder\\s+radius\\s+${NUM}\\s*(${UNIT})?\\s+height\\s+${NUM}\\s*(${UNIT})?$`);
  const m = raw.match(pattern);
  if (!m) {
    if (raw.startsWith("cylinder")) {
      throw new Error("Cylinder requires radius and height.");
    }
    return null;
  }
  const radiusMm = toMm(m[1], m[2] || "mm");
  const heightMm = toMm(m[3], m[4] || "mm");
  return makePrimitive("cylinder", { radiusMm, heightMm });
}

function parseSphere(raw) {
  const pattern = new RegExp(`^sphere\\s+radius\\s+${NUM}\\s*(${UNIT})?$`);
  const m = raw.match(pattern);
  if (!m) {
    if (raw.startsWith("sphere")) {
      throw new Error("Sphere requires radius.");
    }
    return null;
  }
  const radiusMm = toMm(m[1], m[2] || "mm");
  return makePrimitive("sphere", { radiusMm });
}

function parsePrimitive(raw) {
  const input = raw.trim().toLowerCase();
  return parseBox(input) || parseCylinder(input) || parseSphere(input);
}

function parseCommand(prompt) {
  const input = prompt.trim().toLowerCase();
  if (!input) {
    throw new Error("Prompt is empty.");
  }

  if (input === "clear") {
    return { kind: "clear" };
  }

  const explicit = input.match(/^(create|add)\s+(.+)$/);
  if (explicit) {
    const primitive = parsePrimitive(explicit[2]);
    if (!primitive) {
      throw new Error("Unsupported shape or grammar.");
    }
    return { kind: explicit[1], primitive };
  }

  // Convenience: allow direct primitive text as create.
  const primitiveOnly = parsePrimitive(input);
  if (primitiveOnly) {
    return { kind: "create", primitive: primitiveOnly };
  }

  throw new Error("Unsupported command. Use create, add, or clear.");
}

function applyCommand(command) {
  if (command.kind === "clear") {
    model = [];
    return;
  }

  if (command.kind === "create") {
    model = [command.primitive];
    return;
  }

  if (command.kind === "add") {
    model = [...model, command.primitive];
  }
}

function computeCameraBasis() {
  const target = camera.target;
  const cp = Math.cos(camera.pitch);
  const sp = Math.sin(camera.pitch);
  const cy = Math.cos(camera.yaw);
  const sy = Math.sin(camera.yaw);

  const camPos = [
    target[0] + camera.distance * cp * sy,
    target[1] + camera.distance * sp,
    target[2] + camera.distance * cp * cy,
  ];

  const forward = vNorm(vSub(target, camPos));
  let right = vNorm(vCross(forward, [0, 1, 0]));
  if (vLen(right) < 1e-6) {
    right = [1, 0, 0];
  }
  const up = vNorm(vCross(right, forward));

  return { camPos, forward, right, up };
}

function projectPoint(point, basis, width, height) {
  const rel = vSub(point, basis.camPos);
  const xCam = vDot(rel, basis.right);
  const yCam = vDot(rel, basis.up);
  const zCam = vDot(rel, basis.forward);

  const near = 1;
  if (zCam <= near) {
    return null;
  }

  const fovRad = (camera.fovDeg * Math.PI) / 180;
  const focal = (height * 0.5) / Math.tan(fovRad * 0.5);
  return {
    x: width * 0.5 + (xCam * focal) / zCam,
    y: height * 0.5 - (yCam * focal) / zCam,
    z: zCam,
  };
}

function drawLine3D(a, b, color, width, basis, w, h) {
  const pa = projectPoint(a, basis, w, h);
  const pb = projectPoint(b, basis, w, h);
  if (!pa || !pb) {
    return;
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pa.x, pa.y);
  ctx.lineTo(pb.x, pb.y);
  ctx.stroke();
}

function makeBoxLines(primitive) {
  const { widthMm: w, depthMm: d, heightMm: h } = primitive.params;
  const p = primitive.positionMm;
  const hw = w * 0.5;
  const hh = h * 0.5;
  const hd = d * 0.5;

  const corners = [
    [p[0] - hw, p[1] - hh, p[2] - hd],
    [p[0] + hw, p[1] - hh, p[2] - hd],
    [p[0] + hw, p[1] + hh, p[2] - hd],
    [p[0] - hw, p[1] + hh, p[2] - hd],
    [p[0] - hw, p[1] - hh, p[2] + hd],
    [p[0] + hw, p[1] - hh, p[2] + hd],
    [p[0] + hw, p[1] + hh, p[2] + hd],
    [p[0] - hw, p[1] + hh, p[2] + hd],
  ];

  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];

  return edges.map((edge) => [corners[edge[0]], corners[edge[1]]]);
}

function makeCylinderLines(primitive, segments = 28) {
  const { radiusMm: r, heightMm: h } = primitive.params;
  const p = primitive.positionMm;
  const topY = p[1] + h * 0.5;
  const bottomY = p[1] - h * 0.5;
  const top = [];
  const bottom = [];
  const lines = [];

  for (let i = 0; i < segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    const x = p[0] + Math.cos(t) * r;
    const z = p[2] + Math.sin(t) * r;
    top.push([x, topY, z]);
    bottom.push([x, bottomY, z]);
  }

  for (let i = 0; i < segments; i += 1) {
    const j = (i + 1) % segments;
    lines.push([top[i], top[j]]);
    lines.push([bottom[i], bottom[j]]);
    if (i % 4 === 0) {
      lines.push([top[i], bottom[i]]);
    }
  }

  return lines;
}

function makeSphereLines(primitive, ringSeg = 36) {
  const { radiusMm: r } = primitive.params;
  const p = primitive.positionMm;
  const lines = [];

  const latAngles = [-45, 0, 45].map((d) => (d * Math.PI) / 180);
  for (const lat of latAngles) {
    const y = p[1] + Math.sin(lat) * r;
    const ringR = Math.cos(lat) * r;
    let prev = null;
    for (let i = 0; i <= ringSeg; i += 1) {
      const t = (i / ringSeg) * Math.PI * 2;
      const point = [p[0] + Math.cos(t) * ringR, y, p[2] + Math.sin(t) * ringR];
      if (prev) lines.push([prev, point]);
      prev = point;
    }
  }

  const lonAngles = [0, 60, 120].map((d) => (d * Math.PI) / 180);
  for (const lon of lonAngles) {
    let prev = null;
    for (let i = 0; i <= ringSeg; i += 1) {
      const t = (i / ringSeg) * Math.PI;
      const x = Math.cos(lon) * Math.sin(t) * r;
      const y = Math.cos(t) * r;
      const z = Math.sin(lon) * Math.sin(t) * r;
      const point = [p[0] + x, p[1] + y, p[2] + z];
      if (prev) lines.push([prev, point]);
      prev = point;
    }
  }

  return lines;
}

function primitiveLines(primitive) {
  if (primitive.type === "box") return makeBoxLines(primitive);
  if (primitive.type === "cylinder") return makeCylinderLines(primitive);
  if (primitive.type === "sphere") return makeSphereLines(primitive);
  return [];
}

function drawGrid(basis, width, height) {
  const gridHalf = 300;
  const step = 20;
  for (let x = -gridHalf; x <= gridHalf; x += step) {
    const major = x % 100 === 0;
    drawLine3D([x, 0, -gridHalf], [x, 0, gridHalf], major ? "#c8d1be" : "#dde4d6", 1, basis, width, height);
  }
  for (let z = -gridHalf; z <= gridHalf; z += step) {
    const major = z % 100 === 0;
    drawLine3D([-gridHalf, 0, z], [gridHalf, 0, z], major ? "#c8d1be" : "#dde4d6", 1, basis, width, height);
  }

  drawLine3D([0, 0, 0], [80, 0, 0], "#cb4d44", 2, basis, width, height);
  drawLine3D([0, 0, 0], [0, 80, 0], "#47a05b", 2, basis, width, height);
  drawLine3D([0, 0, 0], [0, 0, 80], "#3e78c6", 2, basis, width, height);
}

function drawScene() {
  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#f5f8ef");
  bg.addColorStop(1, "#edf2e5");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const basis = computeCameraBasis();
  drawGrid(basis, width, height);

  for (const primitive of model) {
    const lines = primitiveLines(primitive);
    for (const [a, b] of lines) {
      drawLine3D(a, b, TYPE_COLOR[primitive.type], 1.7, basis, width, height);
    }
  }
}

function primitiveVertices(primitive) {
  if (primitive.type === "box") {
    const { widthMm: w, depthMm: d, heightMm: h } = primitive.params;
    const p = primitive.positionMm;
    const hw = w / 2;
    const hh = h / 2;
    const hd = d / 2;
    return [
      [p[0] - hw, p[1] - hh, p[2] - hd],
      [p[0] + hw, p[1] - hh, p[2] - hd],
      [p[0] + hw, p[1] + hh, p[2] - hd],
      [p[0] - hw, p[1] + hh, p[2] - hd],
      [p[0] - hw, p[1] - hh, p[2] + hd],
      [p[0] + hw, p[1] - hh, p[2] + hd],
      [p[0] + hw, p[1] + hh, p[2] + hd],
      [p[0] - hw, p[1] + hh, p[2] + hd],
    ];
  }

  if (primitive.type === "cylinder") {
    const { radiusMm: r, heightMm: h } = primitive.params;
    const p = primitive.positionMm;
    return [
      [p[0] - r, p[1] - h / 2, p[2] - r],
      [p[0] + r, p[1] + h / 2, p[2] + r],
    ];
  }

  if (primitive.type === "sphere") {
    const { radiusMm: r } = primitive.params;
    const p = primitive.positionMm;
    return [
      [p[0] - r, p[1] - r, p[2] - r],
      [p[0] + r, p[1] + r, p[2] + r],
    ];
  }

  return [];
}

function fitCameraToModel() {
  if (model.length === 0) {
    camera.target = [0, 0, 0];
    camera.distance = 260;
    return;
  }

  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];

  for (const primitive of model) {
    for (const v of primitiveVertices(primitive)) {
      min[0] = Math.min(min[0], v[0]);
      min[1] = Math.min(min[1], v[1]);
      min[2] = Math.min(min[2], v[2]);
      max[0] = Math.max(max[0], v[0]);
      max[1] = Math.max(max[1], v[1]);
      max[2] = Math.max(max[2], v[2]);
    }
  }

  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const radius = Math.max(ext[0], ext[1], ext[2]) * 0.7 + 20;
  const fovRad = (camera.fovDeg * Math.PI) / 180;

  camera.target = center;
  camera.distance = Math.max(60, radius / Math.sin(fovRad * 0.5));
}

function summarizeModel() {
  if (model.length === 0) {
    summaryBox.textContent = "No solids";
    exportButton.disabled = true;
    return;
  }

  const lines = model.map((primitive, idx) => {
    if (primitive.type === "box") {
      const p = primitive.params;
      return `${idx + 1}. box  ${p.widthMm.toFixed(2)} x ${p.depthMm.toFixed(2)} x ${p.heightMm.toFixed(2)} mm`;
    }
    if (primitive.type === "cylinder") {
      const p = primitive.params;
      return `${idx + 1}. cylinder  r=${p.radiusMm.toFixed(2)} h=${p.heightMm.toFixed(2)} mm`;
    }
    const p = primitive.params;
    return `${idx + 1}. sphere  r=${p.radiusMm.toFixed(2)} mm`;
  });

  summaryBox.textContent = lines.join("\n");
  exportButton.disabled = false;
}

function trianglesForBox(primitive) {
  const vertices = primitiveVertices(primitive);
  const faces = [
    [0, 1, 2], [0, 2, 3],
    [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1],
    [3, 2, 6], [3, 6, 7],
    [0, 3, 7], [0, 7, 4],
    [1, 5, 6], [1, 6, 2],
  ];
  return faces.map((f) => [vertices[f[0]], vertices[f[1]], vertices[f[2]]]);
}

function trianglesForCylinder(primitive, segments = 36) {
  const { radiusMm: r, heightMm: h } = primitive.params;
  const p = primitive.positionMm;
  const topY = p[1] + h * 0.5;
  const bottomY = p[1] - h * 0.5;
  const tris = [];

  for (let i = 0; i < segments; i += 1) {
    const t0 = (i / segments) * Math.PI * 2;
    const t1 = ((i + 1) / segments) * Math.PI * 2;

    const b0 = [p[0] + Math.cos(t0) * r, bottomY, p[2] + Math.sin(t0) * r];
    const b1 = [p[0] + Math.cos(t1) * r, bottomY, p[2] + Math.sin(t1) * r];
    const t0v = [p[0] + Math.cos(t0) * r, topY, p[2] + Math.sin(t0) * r];
    const t1v = [p[0] + Math.cos(t1) * r, topY, p[2] + Math.sin(t1) * r];

    tris.push([b0, b1, t1v], [b0, t1v, t0v]);

    const topCenter = [p[0], topY, p[2]];
    const bottomCenter = [p[0], bottomY, p[2]];
    tris.push([topCenter, t0v, t1v]);
    tris.push([bottomCenter, b1, b0]);
  }

  return tris;
}

function trianglesForSphere(primitive, latSteps = 18, lonSteps = 36) {
  const { radiusMm: r } = primitive.params;
  const p = primitive.positionMm;
  const tris = [];

  const points = [];
  for (let lat = 0; lat <= latSteps; lat += 1) {
    const theta = (lat / latSteps) * Math.PI;
    const row = [];
    for (let lon = 0; lon <= lonSteps; lon += 1) {
      const phi = (lon / lonSteps) * Math.PI * 2;
      const x = p[0] + r * Math.sin(theta) * Math.cos(phi);
      const y = p[1] + r * Math.cos(theta);
      const z = p[2] + r * Math.sin(theta) * Math.sin(phi);
      row.push([x, y, z]);
    }
    points.push(row);
  }

  for (let lat = 0; lat < latSteps; lat += 1) {
    for (let lon = 0; lon < lonSteps; lon += 1) {
      const a = points[lat][lon];
      const b = points[lat + 1][lon];
      const c = points[lat + 1][lon + 1];
      const d = points[lat][lon + 1];

      if (lat > 0) {
        tris.push([a, b, c]);
      }
      if (lat < latSteps - 1) {
        tris.push([a, c, d]);
      }
    }
  }

  return tris;
}

function modelTriangles() {
  const out = [];
  for (const primitive of model) {
    if (primitive.type === "box") out.push(...trianglesForBox(primitive));
    if (primitive.type === "cylinder") out.push(...trianglesForCylinder(primitive));
    if (primitive.type === "sphere") out.push(...trianglesForSphere(primitive));
  }
  return out;
}

function normalForTri(tri) {
  const [a, b, c] = tri;
  const n = vNorm(vCross(vSub(b, a), vSub(c, a)));
  return n;
}

function exportAsciiStl() {
  if (model.length === 0) return;
  const tris = modelTriangles();
  const lines = ["solid text2form"]; 

  for (const tri of tris) {
    const n = normalForTri(tri);
    lines.push(`  facet normal ${n[0]} ${n[1]} ${n[2]}`);
    lines.push("    outer loop");
    lines.push(`      vertex ${tri[0][0]} ${tri[0][1]} ${tri[0][2]}`);
    lines.push(`      vertex ${tri[1][0]} ${tri[1][1]} ${tri[1][2]}`);
    lines.push(`      vertex ${tri[2][0]} ${tri[2][1]} ${tri[2][2]}`);
    lines.push("    endloop");
    lines.push("  endfacet");
  }

  lines.push("endsolid text2form");

  const blob = new Blob([lines.join("\n")], { type: "model/stl" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "text2form-model.stl";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function runPrompt() {
  try {
    const command = parseCommand(promptInput.value);
    applyCommand(command);
    fitCameraToModel();
    summarizeModel();
    errorBox.textContent = "";
  } catch (error) {
    errorBox.textContent = error.message;
  }
}

runButton.addEventListener("click", runPrompt);
clearButton.addEventListener("click", () => {
  promptInput.value = "clear";
  runPrompt();
});

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    runPrompt();
  }
});

for (const button of document.querySelectorAll(".example")) {
  button.addEventListener("click", () => {
    promptInput.value = button.textContent;
    runPrompt();
  });
}

exportButton.addEventListener("click", exportAsciiStl);

canvas.addEventListener("mousedown", (event) => {
  pointer.dragging = true;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
});

window.addEventListener("mouseup", () => {
  pointer.dragging = false;
});

window.addEventListener("mousemove", (event) => {
  if (!pointer.dragging) return;
  const dx = event.clientX - pointer.x;
  const dy = event.clientY - pointer.y;
  pointer.x = event.clientX;
  pointer.y = event.clientY;

  camera.yaw -= dx * 0.006;
  camera.pitch += dy * 0.006;
  camera.pitch = Math.max(-1.45, Math.min(1.45, camera.pitch));
});

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const factor = Math.exp(event.deltaY * 0.0015);
    camera.distance = Math.max(25, Math.min(8000, camera.distance * factor));
  },
  { passive: false },
);

window.addEventListener("resize", resizeCanvas);

function frame() {
  drawScene();
  requestAnimationFrame(frame);
}

resizeCanvas();
summarizeModel();
runPrompt();
frame();
