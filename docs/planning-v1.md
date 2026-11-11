# PROJECT: Text → Parametric Solid Generator (React-Based)
# Working Name: Text2Form
# Version: Planning v1.1
# Architecture: React frontend + deterministic backend geometry engine

---

# 1. OBJECTIVE

Build a deterministic system that converts constrained plain English prompts into valid 3D solid models and displays them live in a browser using React.

The system is NOT a full CAD replacement.
It is a structured natural-language front-end for primitive-based solid generation.

The application must:
- Accept English text input
- Parse into structured geometry
- Generate solid geometry
- Render interactively in-browser
- Allow export (STL initially, STEP later)

---

# 2. CORE PRINCIPLE

Strict pipeline:

User Prompt
→ Deterministic Parser
→ Structured Intermediate Representation (IR)
→ Geometry Engine
→ Mesh Output
→ React 3D Viewer
→ Exporter

No free-form AI interpretation inside the geometry engine.
All ambiguity must be resolved before geometry generation.

---

# 3. MVP SCOPE

## 3.1 Supported Shapes

Primitive solids only:

- Box / Cube
- Cylinder
- Sphere

## 3.2 Supported Operations

- Boolean Union
- Boolean Difference (holes)
- Translation
- Centering at origin

No rotations in v1.
No fillets or chamfers.
No sketch/extrude workflows.

## 3.3 Supported Units

- mm (internal base unit)
- cm
- in

All values normalized to millimeters internally.

## 3.4 Supported Prompt Grammar (Strict)

Examples:

- "2 inch cube"
- "make a 2in by 2in by 2in box"
- "cylinder radius 10mm height 20mm"
- "sphere radius 5cm"
- "box 10mm by 20mm by 5mm centered at origin"
- "drill a 5mm hole through center"

Free prose not supported.
Parser must reject unsupported constructs.

---

# 4. SYSTEM ARCHITECTURE

## 4.1 High-Level Stack

Frontend:
- React (Vite or Next.js)
- React Three Fiber (three.js wrapper)
- Zustand or simple React state

Backend:
Option A (simpler MVP):
- Node.js + geometry library
- Generate mesh primitives manually

Option B (preferred long-term):
- Python + OpenCascade (via API)
- Return mesh (STL/OBJ) to frontend

MVP recommendation:
Start with mesh-based backend for speed.
Design IR for future B-Rep replacement.

---

# 5. FRONTEND ARCHITECTURE (REACT)

## 5.1 Core Components

App
  ├── PromptInput
  ├── ModelViewer
  ├── ExportPanel
  └── ErrorDisplay

### PromptInput
- Text input field
- Submit button
- Sends prompt to backend
- Displays parse errors

### ModelViewer
- React Three Fiber scene
- OrbitControls
- Grid helper
- Axis helper
- Mesh display from backend response

### ExportPanel
- Download STL
- Show dimensions

### ErrorDisplay
- Deterministic error messaging

---

## 5.2 React 3D Rendering

Use:

@react-three/fiber
@react-three/drei

Scene setup:
- Perspective camera
- Ambient + directional light
- OrbitControls
- Grid
- Loaded mesh from backend

Mesh should update when prompt changes.

---

# 6. BACKEND MODULES

## 6.1 Parser Module

Input:
string

Output:
Structured IR object

Example:

{
  shapes: [
    {
      id: "box1",
      type: "box",
      params: { width: 50.8, depth: 50.8, height: 50.8 },
      transform: { translate: [0,0,0] },
      centered: true
    }
  ],
  operations: []
}

Responsibilities:
- Extract numbers
- Extract units
- Normalize synonyms (cube → box)
- Validate parameters
- Reject ambiguous prompts

Must be deterministic.

---

## 6.2 Unit Normalizer

Convert:
- in → mm (×25.4)
- cm → mm (×10)

Internal geometry must use mm only.

---

## 6.3 Geometry Engine

Initial MVP:
Generate triangle mesh primitives directly.

Required API:

make_box(width, depth, height)
make_cylinder(radius, height)
make_sphere(radius)
boolean_union(objA, objB)
boolean_difference(objA, objB)
translate(obj, x, y, z)

Output:
- Vertex array
- Face array
- Or STL buffer

Long-term:
Replace mesh engine with OpenCascade B-Rep kernel.

---

## 6.4 Exporter

Initial:
- STL (binary)

Future:
- STEP (requires B-Rep backend)
- OBJ

---

# 7. INTERMEDIATE REPRESENTATION (IR)

Design IR for future parametric modeling.

Structure:

ModelSpec
  Shapes[]
  Operations[]

Shape:
{
  id: string,
  type: enum(box, cylinder, sphere),
  params: object,
  transform: object,
  metadata: optional
}

Operation:
{
  type: enum(union, difference),
  target: string,
  tool: string
}

IR must be versioned.

---

# 8. API CONTRACT

POST /generate

Request:
{
  prompt: string
}

Response:
{
  success: boolean,
  ir: object,
  mesh: STL_or_geometry_data,
  errors: string[]
}

No implicit corrections.

---

# 9. ERROR HANDLING

Parser returns explicit errors:

- Missing dimension
- Unsupported shape
- Unsupported operation
- Ambiguous unit

Frontend must render these clearly.

---

# 10. TESTING STRATEGY

## Parser Tests
Prompt → Expected IR

## Geometry Tests
Validate bounding box matches expected dimensions.

## Regression Tests
Maintain prompt corpus.

---

# 11. NON-GOALS (MVP)

- No GUI sketching
- No constraint solver
- No parametric editing
- No AI-based interpretation
- No freeform modeling

---

# 12. LONG-TERM ARCHITECTURE PREPARATION

## 12.1 Parametric Feature Tree

Each feature stored as node:

Feature:
- type
- parameters
- parent

Enables:
- Model recompute
- Parameter editing
- History display

Design IR to allow this early.

---

## 12.2 Constraint Layer

Future support:

- "hole centered"
- "flush with top"
- "equal width"

Requires symbolic constraint system.
Do not hardcode geometry relationships.

---

## 12.3 Rotation & Alignment

Add transform object early:

transform:
{
  translate: [x,y,z],
  rotate: [rx,ry,rz]
}

Even if unused in MVP.

---

## 12.4 LLM Router (Optional Future)

Architecture:

User Prompt
→ LLM Router
→ Structured grammar
→ Deterministic parser

LLM must emit structured grammar.
LLM never directly controls geometry.

---

## 12.5 Multi-Object Assemblies

Support:

Part
  Feature1
  Feature2
  Feature3

Operations must be ordered.

---

## 12.6 STEP Export

If STEP required:
Switch backend to OpenCascade early.
Do not lock into mesh-only architecture long-term.

---

# 13. PERFORMANCE TARGETS

- Parser < 10ms
- Geometry generation < 100ms for primitives
- React re-render smooth at 60fps
- STL export under 50ms

---

# 14. SECURITY

- No eval from prompt
- No arbitrary file paths
- Sanitize input
- Limit geometry complexity

---

# 15. DIRECTORY STRUCTURE (RECOMMENDED)

project-root/
  frontend/
    src/
      components/
      viewer/
      api/
  backend/
    parser/
    ir/
    engine/
    export/
    tests/
  shared/
    types/

---

# 16. VERSION ROADMAP

v0.1
- React UI
- Single primitive
- STL export

v0.2
- Boolean subtraction
- Multi-object support

v0.3
- Rotation support
- Improved IR

v0.4
- STEP backend option

v1.0
- Web deployment
- Feature history
- Prompt suggestion system

---

# 17. DESIGN PHILOSOPHY

Keep geometry deterministic.
Keep grammar explicit.
Separate language interpretation from modeling.
Overbuild IR structure.
Underbuild NLP.

Build MVP as a strict system.
Expand language later.