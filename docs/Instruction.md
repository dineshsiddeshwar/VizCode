# VizCode — Quick Instructions

This document explains how to use VizCode to create diagrams from plain text prompts.

Overview
- VizCode is a React + TypeScript single-page app that converts a text prompt into a diagram.
- The UI has three columns: Icon & Arrow palette, Prompt editor, and SVG diagram preview.
- Clusters, nodes, and arrows are described in the prompt using a simple DSL.

Prompt DSL
- Cluster: NAME
  - Node: LABEL [name=alias]  (optional name attribute)
- A -> B [arrow=TYPE, label=TEXT]
  - arrow types: solid (single), double, dashed, double-dotted
  - label supports `label` and accepts `lable` typo for compatibility

Basic workflow
1. Edit the prompt in the center editor (Monaco-based). The editor is dark themed and supports very large inputs.
2. Press the "Update Diagram" button or add a new line to auto-parse.
3. Drag icons from the left palette into clusters or the canvas to add new nodes.
4. Drag nodes to reposition them. Drop near a cluster to assign the node to that cluster.
5. Hold Shift and drag from one node to another to create an arrow (arrow type selected above the editor).
6. Double-click a node label to edit it inline.
7. Use zoom buttons or Ctrl+wheel inside the preview to zoom the diagram.
8. Use "Save as SVG" and "Save as PNG" to export a tightly-cropped image of the diagram.

Tips
- The prompt is authoritative: items removed from the prompt will be removed from the diagram on parse.
- Node positions are preserved across parses when a node matches an existing node by label or name.
- Clusters without nodes are auto-placed into a near-square grid to avoid horizontal appending.

Troubleshooting
- If the backend parse service is unavailable, the local parser is used automatically.
- If images export blank, ensure there is at least one node or cluster visible and try increasing zoom before exporting.

Contact
- For feedback or bugs, email: dineshks814@gmail.com
