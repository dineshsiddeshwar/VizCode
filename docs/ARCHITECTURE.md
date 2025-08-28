# VizCode — Architecture Overview

This file summarizes the high-level architecture of VizCode.

## Overview
VizCode is a single-page React application (Vite + TypeScript). The primary UI and logic live in `src/App.tsx` (single-file implementation). A light mock backend exists in `ollama-backend/ollama-backend.cjs` to simulate server-side parsing.

## Major Components

- Frontend (Vite + React + TypeScript)
  - `src/App.tsx` — main application: editor, parser, renderer, exporter.
  - Monaco Editor (`@monaco-editor/react`) used for the prompt editor to handle very large inputs.
  - SVG-based renderer for nodes, clusters, edges, and markers.
  - Local fallback parser `parsePromptLocally` inside `src/App.tsx`.
  - Routing heuristic `computeRoute` attempts straight, L-shaped, and S/U-shaped orthogonal routes avoiding node boxes.
  - Layout `layoutClusters` places clusters in a near-square grid and shifts nodes accordingly. Manual cluster/node dragging persists across parses.

- Backend (optional/mock)
  - `ollama-backend/ollama-backend.cjs` — simple Express-like mock that accepts POST `/api/ollama/parse` and returns parsed nodes/clusters/edges.

## Data Model
- Node
  - id: string
  - label: string
  - name?: string (optional alias used when referencing nodes in edges)
  - x, y: coordinates in canvas space
  - color?: string
  - clusterId?: string

- Edge
  - id: string
  - from: node id
  - to: node id
  - type: one of `solid|dashed|double|double-dotted`
  - label?: string

- Cluster
  - id: string
  - label: string
  - parentId?: string
  - x?, y?: number (anchor when user positions cluster)

## Parsing & Merge Semantics
- The prompt is authoritative. Parsed clusters/nodes/edges replace the previous state. Nodes and clusters are matched by label or name to preserve existing ids and positions.
- The local parser is tolerant (accepts `label` and `lable` and adds missing nodes on-the-fly).

## Rendering & Export
- Edges are rendered as straight lines or polylines with orthogonal segments. Double-sided arrows are implemented using mirrored start markers and endpoint offsets so arrowheads anchor at icon edges.
- Export functions `handleSaveSVG` and `handleSavePNG` compute a tight bounding box around all visible elements and produce cropped exports. PNG export rasterizes the cropped SVG at a scaled resolution (zoom × devicePixelRatio) for high quality.

## Known limitations & future improvements
- Segment-vs-AABB intersection detection uses a midpoint sampling heuristic; replace with precise segment-AABB math for robustness.
- `src/App.tsx` is a large single file; consider refactoring into smaller components for maintainability.

Contact
- Questions: dineshks814@gmail.com
