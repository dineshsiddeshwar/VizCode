import React, { useState, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import './App.css';


type Node = {
  id: string;
  label: string;
  name?: string;
  x: number;
  y: number;
  color?: string;
  clusterId?: string; // Optional: which cluster this node belongs to
};

type Edge = {
  id: string;
  from: string;
  to: string;
  label?: string;
  type?: 'solid' | 'dashed' | 'double' | 'double-dotted';
};

type Cluster = {
  id: string;
  label: string;
  parentId?: string; // optional parent for nested clusters
  x?: number;
  y?: number;
};

const initialPrompt = `Cluster: Auth
  Node: User
  Node: System
Cluster: Dinesh
  Node: Storage
Cluster: internet
  Node: Web [name=google]
google -> System [arrow=solid, label=internet]
Storage -> google [arrow=double-dotted]`;

const initialClusters: Cluster[] = [
  { id: 'auth', label: 'Auth' },
  { id: 'dinesh', label: 'Dinesh' },
  { id: 'internet', label: 'internet' },
];
const initialNodes: Node[] = [
  { id: 'user', label: 'User', x: 150, y: 140, color: '#e3f2fd', clusterId: 'auth' },
  { id: 'system', label: 'System', x: 320, y: 140, color: '#fffde7', clusterId: 'auth' },
  { id: 'storage', label: 'Storage', x: 320, y: 320, color: '#ffe0b2', clusterId: 'dinesh' },
  { id: 'google', label: 'Web', name: 'google', x: 120, y: 60, color: '#b2dfdb', clusterId: 'internet' },
];
const initialEdges: Edge[] = [
  { id: 'eg1', from: 'google', to: 'system', label: 'internet', type: 'solid' },
  { id: 'eg2', from: 'storage', to: 'google', label: '', type: 'double-dotted' },
];

function App() {
  // Cluster creation state
  const [newClusterLabel, setNewClusterLabel] = useState('');

  // Node label editing state
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');

  // timers to distinguish single vs double click per node
  const clickTimers = React.useRef<Record<string, number | null>>({});

  // cleanup timers on unmount
  React.useEffect(() => {
    const timersRef = clickTimers.current;
    return () => {
      const timers = { ...timersRef };
      Object.values(timers).forEach(t => { if (t) clearTimeout(t); });
    };
  }, []);

  // Handler to start editing name
  const handleNameDoubleClick = (nodeId: string, name: string) => {
    // cancel any pending single-click action
    const t = clickTimers.current[nodeId];
    if (t) {
      clearTimeout(t);
      clickTimers.current[nodeId] = null;
    }
    setEditingNodeId(nodeId);
    setEditingName(name);
  };
  // Handler to save name
  const handleNameSave = () => {
    if (editingNodeId) {
      setNodes((nodes: Node[]) => {
        const updated = nodes.map((n: Node) => n.id === editingNodeId ? { ...n, name: editingName } : n);
        // use freshest edges/clusters from refs
        setPrompt(regeneratePrompt(updated, edgesRef.current, clustersRef.current));
        return updated;
      });
      setEditingNodeId(null);
      setEditingName('');
    }
  };
  // Handler to cancel edit
  const handleNameCancel = () => {
    setEditingNodeId(null);
    setEditingName('');
  };

  // --- MISSING APP STATE (was causing runtime errors / blank page) ---
  // Diagram data state
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);
  const [clusters, setClusters] = useState<Cluster[]>(initialClusters);
  // refs to keep latest state for event handlers and async tasks
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const clustersRef = useRef(clusters);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  useEffect(() => { clustersRef.current = clusters; }, [clusters]);
  const updatePromptFromState = (n?: Node[], e?: Edge[], c?: Cluster[]) => {
    const nn = n ?? nodesRef.current;
    const ee = e ?? edgesRef.current;
    const cc = c ?? clustersRef.current;
    setPrompt(regeneratePrompt(nn, ee, cc));
  };
  // Prompt / backend sync state
  const [prompt, setPrompt] = useState<string>(initialPrompt);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // Temporary arrow UI state
  const [arrowType, setArrowType] = useState<string>('single');

  // Zoom & canvas size state for scrollable/zoomable preview
  const [zoom, setZoom] = useState<number>(1);
  const canvasSize = { w: 2000, h: 1200 };
  const svgWrapperRef = useRef<HTMLDivElement | null>(null);
  const prevLineCountRef = useRef<number>(prompt.split(/\r?\n/).length);

  // Set browser tab title
  useEffect(() => {
    document.title = 'VizCode';
  }, []);

  const handleArrowSelectChange = (val: string) => {
    setArrowType(val);
  };

  // Find a reasonably free position for a new/empty cluster by scanning a grid and
  // avoiding overlap with existing nodes and cluster anchors.
  const findEmptyClusterPosition = (w: number, h: number) => {
    const margin = 24;
    // start with reasonable spacing but expand if many clusters exist
    const baseW = Math.max(220, w + 120);
    const baseH = Math.max(160, h + 80);
    const cols = Math.max(2, Math.floor(canvasSize.w / baseW));
    const rows = Math.max(2, Math.ceil((clusters.length + 1) / cols));
    const occupied: { x: number; y: number; w: number; h: number }[] = [];
    for (const n of nodes) occupied.push({ x: n.x - 36, y: n.y - 36, w: 72, h: 72 });
    for (const c of clusters) if (c.x && c.y) occupied.push({ x: c.x - margin, y: c.y - margin, w: 180 + margin * 2, h: 100 + margin * 2 });
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = 80 + c * baseW;
        const y = 60 + r * baseH;
        const rect = { x: x - margin, y: y - margin, w: w + margin * 2, h: h + margin * 2 };
        let collide = false;
        for (const occ of occupied) {
          if (!(rect.x + rect.w < occ.x || rect.x > occ.x + occ.w || rect.y + rect.h < occ.y || rect.y > occ.y + occ.h)) { collide = true; break; }
        }
        if (collide) continue;
        return { x, y };
      }
    }
    // fallback: place near top-left offset by existing cluster count
    return { x: 100 + clusters.length * 20, y: 80 + Math.floor(clusters.length / 6) * 40 };
  };

  // Helper: find cluster at a given (x, y) point
  const findClusterAt = (x: number, y: number): string | undefined => {
    for (const cluster of clusters) {
      const bbox = getClusterBBox(cluster.id);
      if (bbox && x >= bbox.x && x <= bbox.x + bbox.w && y >= bbox.y && y <= bbox.y + bbox.h) {
        return cluster.id;
      }
    }
    return undefined;
  };

  // Start dragging a cluster when user mouses down on its outline
  const handleClusterMouseDown = (e: React.MouseEvent, clusterId: string) => {
    e.stopPropagation();
    const svg = (e.target as SVGElement).ownerSVGElement!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const cursorpt = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    const bbox = getClusterBBox(clusterId);
    setDragClusterId(clusterId);
    setDragClusterOffset({ x: cursorpt.x - bbox.x, y: cursorpt.y - bbox.y });
  };

  // Helper: check if a segment intersects any node icon box
  const segmentIntersectsAnyNode = (x1: number, y1: number, x2: number, y2: number) => {
    for (const n of nodes) {
      const left = n.x - 18;
      const right = n.x + 18;
      const top = n.y - 18;
      const bottom = n.y + 18;
      // simple AABB vs segment check: if both points are on one side skip, else do bounding box intersection
      const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
      if (maxX < left || minX > right || maxY < top || minY > bottom) continue;
      // approximate by sampling mid point
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      if (mx >= left && mx <= right && my >= top && my <= bottom) return true;
    }
    return false;
  };

  // Smart router: for a given from/to points try straight line first, then L-shape, then S/U-shape
  const computeRoute = (x1: number, y1: number, x2: number, y2: number) : { points: {x:number;y:number}[], routed: boolean } => {
    // straight
    if (!segmentIntersectsAnyNode(x1, y1, x2, y2)) return { points: [{x:x1,y:y1},{x:x2,y:y2}], routed: false };
    // L-shape (horizontal then vertical)
    const mid1 = { x: x2, y: y1 };
    if (!segmentIntersectsAnyNode(x1, y1, mid1.x, mid1.y) && !segmentIntersectsAnyNode(mid1.x, mid1.y, x2, y2)) return { points: [{x:x1,y:y1}, mid1, {x:x2,y:y2}], routed: true };
    // L-shape (vertical then horizontal)
    const mid2 = { x: x1, y: y2 };
    if (!segmentIntersectsAnyNode(x1, y1, mid2.x, mid2.y) && !segmentIntersectsAnyNode(mid2.x, mid2.y, x2, y2)) return { points: [{x:x1,y:y1}, mid2, {x:x2,y:y2}], routed: true };
    // U/S shape: try offset middle points above/below
    const offset = 60;
    const candidates = [
      [{x:x1,y:y1}, {x:x1,y:y1 - offset}, {x:x2,y:y1 - offset}, {x:x2,y:y2}],
      [{x:x1,y:y1}, {x:x1,y:y1 + offset}, {x:x2,y:y1 + offset}, {x:x2,y:y2}],
      [{x:x1,y:y1}, {x:x1 - offset,y:y1}, {x:x1 - offset,y:y2}, {x:x2,y:y2}],
      [{x:x1,y:y1}, {x:x1 + offset,y:y1}, {x:x1 + offset,y:y2}, {x:x2,y:y2}],
    ];
    for (const cand of candidates) {
      let ok = true;
      for (let i = 0; i < cand.length - 1; i++) {
        if (segmentIntersectsAnyNode(cand[i].x, cand[i].y, cand[i+1].x, cand[i+1].y)) { ok = false; break; }
      }
      if (ok) return { points: cand, routed: true };
    }
    // fallback to straight but mark routed=false
    return { points: [{x:x1,y:y1},{x:x2,y:y2}], routed: false };
  };

  // Helper: regenerate prompt from nodes, edges, clusters (flat, includes cross-cluster edges)
  const regeneratePrompt = (nodes: Node[], edges: Edge[], clusters: Cluster[]): string => {
    let prompt = '';
    for (const cluster of clusters) {
      prompt += `Cluster: ${cluster.label}\n`;
      for (const node of nodes.filter(n => n.clusterId === cluster.id)) {
        prompt += `  Node: ${node.label}`;
        if (node.name) prompt += ` [name=${node.name}]`;
        prompt += '\n';
      }
    }
    // List all edges, including cross-cluster, using node.name if present
    for (const edge of edges) {
      const from = nodes.find(n => n.id === edge.from);
      const to = nodes.find(n => n.id === edge.to);
      if (from && to) {
        const fromName = from.name || from.label;
        const toName = to.name || to.label;
  const edgeObj = edge as Edge & { lable?: string };
  const edgeLabel = edgeObj.label || edgeObj.lable || '';
        prompt += `${fromName} -> ${toName}`;
        if (edge.type || edgeLabel) {
          prompt += ' [';
          if (edge.type) prompt += `arrow=${edge.type}`;
          if (edge.type && edgeLabel) prompt += ', ';
          if (edgeLabel) prompt += `label='${edgeLabel}'`;
          prompt += ']';
        }
        prompt += '\n';
      }
    }
    return prompt.trim();
  };

  // Handle drop on canvas (with cluster detection)
  const handleCanvasDrop = (e: React.DragEvent<SVGSVGElement>) => {
    e.preventDefault();
    const iconType = e.dataTransfer.getData('iconType');
    const icon = allIcons.find(i => i.type === iconType);
    if (!icon) return;
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const cursorpt = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    const clusterId = findClusterAt(cursorpt.x, cursorpt.y);
    setNodes((nodes: Node[]) => {
      const newNodes = [
        ...nodes,
        {
          id: `${iconType}-${Date.now()}`,
          label: icon.label,
          name: '',
          x: cursorpt.x,
          y: cursorpt.y,
          color: icon.color,
          clusterId: clusterId || undefined // Only assign if inside a cluster
        }
      ];
      // use latest edges/clusters from refs to regenerate prompt
      setPrompt(regeneratePrompt(newNodes, edgesRef.current, clustersRef.current));
      return newNodes;
    });
  };
  const handleCanvasDragOver = (e: React.DragEvent<SVGSVGElement>) => {
    e.preventDefault();
  };

  // Node dragging state
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  // Cluster dragging state (allow moving cluster which also moves its nodes)
  const [dragClusterId, setDragClusterId] = useState<string | null>(null);
  const [dragClusterOffset, setDragClusterOffset] = useState<{ x: number; y: number } | null>(null);
  // Support dragging clusters as well (disabled to keep clusters dynamically sized)
  // Edge creation state
  const [edgeCreation, setEdgeCreation] = useState<{ from: string | null; to: string | null; x: number; y: number } | null>(null);
  // Edge creation: temporary state while dragging
  // (edge type chosen from global Arrow Type selector)

  // Delete node/edge handlers and edge creation
  // Helper: check if a point is inside a node icon
  const isPointInNode = (x: number, y: number, node: Node) => {
    // All icons are 36x36 centered on (node.x, node.y)
    return x >= node.x - 18 && x <= node.x + 18 && y >= node.y - 18 && y <= node.y + 18;
  };

  // (removed unused helper)

  const handleNodeClick = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    // If we're in the middle of creating an edge, clicking a node should complete the edge
    if (edgeCreation && edgeCreation.from && edgeCreation.from !== nodeId) {
      // Instead of immediately creating the edge, set pendingEdge and show popup to choose type
      const from = nodes.find(n => n.id === edgeCreation.from);
      const to = nodes.find(n => n.id === nodeId);
      if (from && to) {
        const id = `e-${edgeCreation.from}-${nodeId}-${Date.now()}`;
        const edgeType = (arrowType === 'single' ? 'solid' : (arrowType === 'double' ? 'double' : (arrowType === 'dotted' ? 'dashed' : 'double-dotted'))) as Edge['type'];
        setEdges((prev: Edge[]) => {
          const newEdges = [...prev, { id, from: edgeCreation.from!, to: nodeId, label: '', type: edgeType }];
          // regenerate prompt using freshest nodes/clusters refs
          setPrompt(regeneratePrompt(nodesRef.current, newEdges, clustersRef.current));
          return newEdges;
        });
      }
      setEdgeCreation(null);
      return;
    }

    // Debounce single click: wait briefly for a possible double-click.
    if (clickTimers.current[nodeId]) {
      // second click arrived quickly; clear timer and do nothing here (double-click handler will run)
      clearTimeout(clickTimers.current[nodeId]!);
      clickTimers.current[nodeId] = null;
      return;
    }
    // set a short timer to perform single-click action (delete) if no double-click follows
    clickTimers.current[nodeId] = window.setTimeout(() => {
      clickTimers.current[nodeId] = null;
      if (window.confirm('Delete this node and its connected edges?')) {
        // compute new nodes and edges and update prompt deterministically
        setNodes((prevNodes: Node[]) => {
          const newNodes = prevNodes.filter((n: Node) => n.id !== nodeId);
          setEdges((prevEdges: Edge[]) => {
            const newEdges = prevEdges.filter((e: Edge) => e.from !== nodeId && e.to !== nodeId);
            setPrompt(regeneratePrompt(newNodes, newEdges, clustersRef.current));
            return newEdges;
          });
          return newNodes;
        });
      }
    }, 300);
  };
  // (handleEdgeClick removed as unused)

  // Mouse event handlers for node movement
  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (e.shiftKey) {
      // Start edge creation
      setEdgeCreation({ from: nodeId, to: null, x: e.clientX, y: e.clientY });
      return;
    }
    const svg = (e.target as SVGElement).ownerSVGElement!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const cursorpt = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    setDragNodeId(nodeId);
    setDragOffset({ x: cursorpt.x - node.x, y: cursorpt.y - node.y });
  };

  // Cluster dragging intentionally removed so clusters continue to auto-size to contents

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
  if (dragNodeId && dragOffset) {
      const svg = e.currentTarget;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const cursorpt = pt.matrixTransform(svg.getScreenCTM()?.inverse());
      setNodes(nodes => nodes.map(n =>
        n.id === dragNodeId ? { ...n, x: cursorpt.x - dragOffset.x, y: cursorpt.y - dragOffset.y } : n
      ));
  } else if (dragClusterId && dragClusterOffset) {
      const svg = e.currentTarget;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const cursorpt = pt.matrixTransform(svg.getScreenCTM()?.inverse());
      const clusterId = dragClusterId;
      const prevBbox = getClusterBBox(clusterId);
      const newX = cursorpt.x - dragClusterOffset.x;
      const newY = cursorpt.y - dragClusterOffset.y;
      const deltaX = newX - prevBbox.x;
      const deltaY = newY - prevBbox.y;
      // move cluster anchor and all nodes within it
      setClusters(prev => prev.map(c => c.id === clusterId ? { ...c, x: newX, y: newY } : c));
      setNodes(prev => prev.map(n => n.clusterId === clusterId ? { ...n, x: n.x + deltaX, y: n.y + deltaY } : n));
  } else if (edgeCreation && edgeCreation.from) {
      setEdgeCreation(ec => ec ? { ...ec, x: e.clientX, y: e.clientY } : ec);
    }
  };
  const handleSvgMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
  const lastDragged = dragNodeId;
  setDragNodeId(null);
  setDragOffset(null);
  setDragClusterId(null);
  setDragClusterOffset(null);
    if (edgeCreation && edgeCreation.from) {
      // Try to complete edge if mouse is over a node (other than from)
      const svg = e.currentTarget;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const cursorpt = pt.matrixTransform(svg.getScreenCTM()?.inverse());
      const toNode = nodes.find(n => n.id !== edgeCreation.from && isPointInNode(cursorpt.x, cursorpt.y, n));
      if (toNode) {
          const from = nodes.find(n => n.id === edgeCreation.from);
        if (from) {
          const id = `e-${edgeCreation.from}-${toNode.id}-${Date.now()}`;
          const edgeType = (arrowType === 'single' ? 'solid' : (arrowType === 'double' ? 'double' : (arrowType === 'dotted' ? 'dashed' : 'double-dotted'))) as Edge['type'];
          setEdges((prev: Edge[]) => {
            const newEdges = [...prev, { id, from: edgeCreation.from!, to: toNode.id, label: '', type: edgeType }];
            setPrompt(regeneratePrompt(nodesRef.current, newEdges, clustersRef.current));
            return newEdges;
          });
        }
      }
    }
  setEdgeCreation(null);
    // finalize node cluster assignment if a node was dragged
    if (lastDragged) finalizeNodePosition(lastDragged);
  // If a cluster was dragged, keep its new position and nodes moved above — do not auto re-layout.
  // This preserves manual placement by the user.
  };

  // After mouse up, if a node was being dragged we should update its cluster membership
  // Helper to assign node to cluster (or clear) after a move — used after drag ends
  const finalizeNodePosition = (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const cid = findClusterAt(node.x, node.y);
    setNodes((prev: Node[]) => {
      const updated = prev.map((n: Node) => n.id === nodeId ? { ...n, clusterId: cid || undefined } : n);
      // update prompt using updated nodes and latest edges/clusters
      setPrompt(regeneratePrompt(updated, edgesRef.current, clustersRef.current));
      return updated;
    });
  };

  // Helper to get node by id
  const getNode = (id: string) => nodes.find(n => n.id === id);

  // Recursive cluster renderer: parents rendered before children so they appear behind
  const renderClusters = (): React.ReactNode => {
    const byParent = new Map<string | undefined, Cluster[]>();
    clusters.forEach(c => {
      const p = c.parentId;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p)!.push(c);
    });

    const renderRec = (parentId?: string): React.ReactNode => {
      const list = byParent.get(parentId) || [];
      return list.map(c => {
        const b = getClusterBBox(c.id);
        return (
          <g key={c.id}>
            <rect
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              rx={10}
              ry={10}
              fill="none"
              stroke="#ff9800"
              strokeWidth={2}
              strokeOpacity={0.95}
              // allow pointer events so users can drag cluster outlines
              onMouseDown={(e) => handleClusterMouseDown(e, c.id)}
              style={{ pointerEvents: 'stroke', cursor: 'move' }}
            />
                {/* also render a small white label here for visibility */}
                <text x={b.x + 12} y={b.y + 20} fontSize={13} fill="#ffffff" style={{ fontWeight: 700, pointerEvents: 'none' }}>{c.label}</text>
            {renderRec(c.id)}
          </g>
        );
      });
    };

    return renderRec(undefined);
  };

  // Calculate cluster bounding boxes (simple: min/max of contained nodes, with padding)
  // Helper: get cluster bounding box (auto-expands to fit all nodes in the cluster, flat)
  function getClusterBBox(clusterId: string): { x: number; y: number; w: number; h: number } {
    // Recursive bbox: include nodes in this cluster and bboxes of child clusters
    const visited = new Set<string>();
    function compute(id: string): { x: number; y: number; w: number; h: number } {
      if (visited.has(id)) return { x: 100, y: 80, w: 180, h: 100 };
      visited.add(id);
      const nodesInCluster = nodes.filter(n => n.clusterId === id);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodesInCluster) {
        minX = Math.min(minX, n.x - 36);
        minY = Math.min(minY, n.y - 36);
        maxX = Math.max(maxX, n.x + 36);
        maxY = Math.max(maxY, n.y + 36);
      }
      // include child clusters
  const childClusters = clusters.filter(c => c.parentId === id);
      for (const child of childClusters) {
        const b = compute(child.id);
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w);
        maxY = Math.max(maxY, b.y + b.h);
      }
      if (minX === Infinity) {
        // empty cluster: pick a free spot using helper
        const pos = findEmptyClusterPosition(180, 100);
        return { x: pos.x, y: pos.y, w: 180, h: 100 };
      }
  const pad = 8; // reduced padding to minimize whitespace around cluster contents
  return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
    }
    return compute(clusterId);
  };

  // Prompt parsing handler (restored to correct scope)
  const handleParsePrompt = async () => {
    setLoading(true);
    setError(null);
    // Immediately parse locally so the UI updates with user-provided labels while preserving positions
    try {
  const localImmediate = parsePromptLocally(prompt, nodesRef.current, clustersRef.current);
      const mergedLocal = mergeParsedWithExisting(localImmediate, nodesRef.current, clustersRef.current);
      const layoutLocal = layoutClusters(mergedLocal.clusters, mergedLocal.nodes);
      setNodes(layoutLocal.nodes);
      setEdges(mergedLocal.edges);
      setClusters(layoutLocal.clusters);
    } catch {
      // ignore local parse errors and proceed to backend
    }
    try {
      const res = await fetch('http://localhost:5001/api/ollama/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error('Backend error');
      const dataUnknown = await res.json() as unknown;
      const isParseResult = (v: unknown): v is { nodes: Node[]; edges: Edge[]; clusters: Cluster[] } => {
        if (typeof v !== 'object' || v === null) return false;
        const vv = v as Record<string, unknown>;
        return Array.isArray(vv['nodes']) && Array.isArray(vv['edges']) && Array.isArray(vv['clusters']);
      };
      // Expecting { nodes: Node[], edges: Edge[], clusters: Cluster[] }
      if (isParseResult(dataUnknown)) {
        const backend = dataUnknown;
        const mergedBackend = mergeParsedWithExisting(backend, nodesRef.current, clustersRef.current);
        // compute layout (non-fixed) and then apply exactly the parsed items to state so prompt is authoritative
        const layoutBackend = layoutClusters(mergedBackend.clusters, mergedBackend.nodes);
         // build a final edge set that prefers explicit label fields (and accepts 'lable' typo)
  const local = parsePromptLocally(prompt, nodesRef.current, clustersRef.current);
   const localMap = new Map(local.edges.map(e => [`${e.from}::${e.to}`, e]));
  const mergedEdges: Edge[] = mergedBackend.edges.map((e: Edge) => {
    const key = `${e.from}::${e.to}`;
    const localE = localMap.get(key) as Edge | undefined;
    const edgeObj = e as Edge & { lable?: string };
    const localObj = (localE as Edge & { lable?: string }) || { label: '', lable: '' };
    const label = (edgeObj.label && (edgeObj.label as string).trim()) ? edgeObj.label : (edgeObj.lable && (edgeObj.lable as string).trim() ? edgeObj.lable : (localObj.label || localObj.lable || ''));
  // Prefer an explicit type from the local (user) prompt when present; otherwise use backend-provided type (if any)
  const type = (localE && localE.type) ? (localE.type as Edge['type']) : (e.type as Edge['type'] | undefined);
  return { ...e, label, type };
  });
   // Apply parsed-and-laid-out results as authoritative
   setNodes(layoutBackend.nodes);
   setClusters(layoutBackend.clusters);
   setEdges(mergedEdges);
      } else {
        // fallback to local parse
  const local = parsePromptLocally(prompt, nodesRef.current, clustersRef.current);
        setNodes(local.nodes);
        setEdges(local.edges);
        setClusters(local.clusters);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      // on error, try local parse so user changes appear without backend
  const local = parsePromptLocally(prompt, nodesRef.current, clustersRef.current);
      setNodes(local.nodes);
      setEdges(local.edges);
      setClusters(local.clusters);
    } finally {
      setLoading(false);
    }
  };

  // Simple local prompt parser as a fallback when backend is unavailable.
  // Supports lines:
  //  Cluster: NAME
  //    Node: Label [name=alias]
  //  A -> B [arrow=solid, label=foo]  (accepts 'lable' typo)
  // accepts optional existingNodes and existingClusters to attempt matching by label/name
  const parsePromptLocally = (text: string, existingNodes?: Node[], existingClusters?: Cluster[]) => {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const outClusters: Cluster[] = [];
    const outNodes: Node[] = [];
    const outEdges: Edge[] = [];
    let currentCluster: string | null = null;
    for (const line of lines) {
      const mCluster = line.match(/^Cluster:\s*(.+)$/i);
      if (mCluster) {
        const label = mCluster[1].trim();
        const id = label.toLowerCase().replace(/\s+/g,'-');
        outClusters.push({ id, label });
        currentCluster = id;
        continue;
      }
  const mNode = line.match(/^Node:\s*([^[]+)(?:\s*\[(.+)\])?$/i);
      if (mNode) {
        const label = mNode[1].trim();
        const attrs = mNode[2];
        let name: string | undefined = undefined;
        if (attrs) {
          const nameMatch = attrs.match(/name\s*=\s*([^\]]+)/i);
          if (nameMatch) name = nameMatch[1].trim();
        }
        const id = (name || label).toLowerCase().replace(/\s+/g,'-') + '-' + Date.now() + '-' + Math.round(Math.random()*1000);
        const pos = findEmptyClusterPosition(180, 100);
        outNodes.push({ id, label: label.trim(), name: name ? name.trim() : undefined, x: pos.x, y: pos.y, clusterId: currentCluster || undefined });
        continue;
      }
      const mEdge = line.match(/^(.+?)\s*->\s*(.+?)\s*(?:\[(.+)\])?$/i);
      if (mEdge) {
        const fromLabel = mEdge[1].trim();
        const toLabel = mEdge[2].trim();
        const attrs = mEdge[3];
        const parseAttr = (attrStr: string | undefined) => {
          const out: Record<string,string> = {};
          if (!attrStr) return out;
          const parts = attrStr.split(',').map(p => p.trim());
          for (const p of parts) {
            const kv = p.split('=');
            if (kv.length >= 2) {
              out[kv[0].trim()] = kv.slice(1).join('=').trim().replace(/^['"]|['"]$/g,'');
            }
          }
          return out;
        };
        const a = parseAttr(attrs);
        // find node ids by name or label
        const findId = (label: string) => {
          const key = label.trim();
          // try matching existing current nodes first (case-insensitive)
          const existing = (existingNodes || nodes).find(n => (n.name && n.name.toLowerCase() === key.toLowerCase()) || n.label.toLowerCase() === key.toLowerCase());
          if (existing) return existing.id;
          // then match newly created outNodes
          const byName = outNodes.find(n => (n.name && n.name.toLowerCase() === key.toLowerCase()) || n.label.toLowerCase() === key.toLowerCase());
          if (byName) return byName.id;
          // not found -> create a node in no-cluster
          const id = key.toLowerCase().replace(/\s+/g,'-') + '-' + Date.now() + '-' + Math.round(Math.random()*1000);
          const pos = findEmptyClusterPosition(180, 100);
          outNodes.push({ id, label: key, x: pos.x, y: pos.y });
          return id;
        };
        const fromId = findId(fromLabel);
        const toId = findId(toLabel);
  const arrowType = (a['arrow'] || a['type']) as Edge['type'] | undefined;
  const rawLbl = a['label'] || a['lable'] || '';
  const lbl = typeof rawLbl === 'string' ? rawLbl.trim() : '';
  outEdges.push({ id: `e-${fromId}-${toId}-${Date.now()}`, from: fromId, to: toId, label: lbl, type: arrowType });
        continue;
      }
    }
    return { clusters: outClusters, nodes: outNodes, edges: outEdges };
  };

  // Merge parsed result with existing nodes/clusters to preserve positions and IDs where possible.
  const mergeParsedWithExisting = (parsed: { nodes: Node[]; edges: Edge[]; clusters: Cluster[] },
                                   existingNodes: Node[], existingClusters: Cluster[]) => {
    // cluster id mapping: parsed cluster id -> existing cluster id (matched by label case-insensitive)
    const clusterMap = new Map<string, string>();
    const existingClusterByLabel = new Map<string, Cluster>();
    for (const c of existingClusters) existingClusterByLabel.set(c.label.toLowerCase(), c);
    const mergedClusters: Cluster[] = [];
    for (const pc of parsed.clusters) {
      const found = existingClusterByLabel.get(pc.label.toLowerCase());
      if (found) {
        clusterMap.set(pc.id, found.id);
        mergedClusters.push({ ...found, label: pc.label });
      } else {
        mergedClusters.push(pc);
        clusterMap.set(pc.id, pc.id);
      }
    }
  // NOTE: Do NOT append old clusters that were removed from the prompt.
  // The prompt is treated as the source of truth; mergedClusters contains only parsed (but id-mapped) clusters.

    // nodes: try to match by name or label (case-insensitive), preserve existing x,y and id
    const nodeMap = new Map<string, string>(); // parsed id -> final id
    const existingByKey = new Map<string, Node>();
    for (const n of existingNodes) {
      const key = (n.name || n.label).toLowerCase();
      existingByKey.set(key, n);
    }
    const mergedNodes: Node[] = [];
    for (const pn of parsed.nodes) {
      const key = (pn.name || pn.label).toLowerCase();
      const matched = existingByKey.get(key);
      if (matched) {
        const mappedCluster = pn.clusterId ? (clusterMap.get(pn.clusterId) || pn.clusterId) : matched.clusterId;
        const merged = { ...matched, label: pn.label, name: pn.name || matched.name, clusterId: mappedCluster };
        mergedNodes.push(merged);
        nodeMap.set(pn.id, merged.id);
      } else {
        const pos = findEmptyClusterPosition(180, 100);
        const newId = pn.id || (pn.label.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now());
        const mappedCluster = pn.clusterId ? (clusterMap.get(pn.clusterId) || pn.clusterId) : undefined;
        const created = { ...pn, id: newId, x: pn.x || pos.x, y: pn.y || pos.y, clusterId: mappedCluster };
        mergedNodes.push(created);
        nodeMap.set(pn.id, created.id);
      }
    }
  // Do NOT keep existing nodes that are not present in the parsed result.
  // mergedNodes contains matched (and newly created) parsed nodes only.

    // edges: remap from/to using nodeMap where possible
    // parsed edges should replace existing ones (so removed arrows in prompt disappear)
    const mergedEdges: Edge[] = parsed.edges.map(e => {
      const from = nodeMap.get(e.from) || e.from;
      const to = nodeMap.get(e.to) || e.to;
      return { ...e, from, to };
    });

    return { nodes: mergedNodes, edges: mergedEdges, clusters: mergedClusters };
  };

  // Layout clusters into a near-square grid and translate contained nodes accordingly.
  // Deterministic: compute centroids for each cluster from provided nodes and place clusters in a row-major grid.
  const layoutClusters = (clustersToLayout: Cluster[], nodesToLayout: Node[], fixed?: { id: string; x: number; y: number }) => {
    const N = clustersToLayout.length;
    if (N === 0) return { clusters: clustersToLayout, nodes: nodesToLayout };

    // compute bbox and centroid for each cluster from nodesToLayout
    // For clusters with no member nodes, spread them deterministically using their index
    const guessCols = Math.max(1, Math.round(Math.sqrt(N)));
    const clusterInfo = clustersToLayout.map((c, idx) => {
      const members = nodesToLayout.filter(n => n.clusterId === c.id);
      if (members.length === 0) {
        const defaultW = 180;
        const defaultH = 100;
        // If the cluster already had an explicit position, respect it as centroid.
        // Otherwise, assign a grid-like centroid based on the index so empty clusters don't all return cx=0,cy=0.
        const cx = c.x ?? ((idx % guessCols) * (defaultW + 40) + 120);
        const cy = c.y ?? (Math.floor(idx / guessCols) * (defaultH + 40) + 80);
        return { id: c.id, w: defaultW, h: defaultH, cx, cy };
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, sx = 0, sy = 0;
      for (const m of members) {
        minX = Math.min(minX, m.x - 18);
        minY = Math.min(minY, m.y - 18);
        maxX = Math.max(maxX, m.x + 18);
        maxY = Math.max(maxY, m.y + 18);
        sx += m.x; sy += m.y;
      }
      const w = Math.max(120, maxX - minX + 36);
      const h = Math.max(80, maxY - minY + 36);
      const cx = sx / members.length;
      const cy = sy / members.length;
      return { id: c.id, w, h, cx, cy };
    });

  const maxW = Math.max(...clusterInfo.map(ci => ci.w)) + 40;
  const maxH = Math.max(...clusterInfo.map(ci => ci.h)) + 40;
  // add extra spacing between grid cells to avoid congestion
  const spacing = 80;
  const cellW = maxW + spacing;
  const cellH = maxH + spacing;

  let cols = Math.max(1, Math.round(Math.sqrt(N)));
  const availW = Math.max(200, canvasSize.w - 80);
  if (cols * cellW > availW) cols = Math.max(1, Math.floor(availW / cellW));
  cols = Math.min(cols, N);
  const rows = Math.ceil(N / cols);

  const totalW = cols * cellW;
  const totalH = rows * cellH;
  const originX = Math.max(20, Math.floor((canvasSize.w - totalW) / 2 + 20));
  const originY = Math.max(20, Math.floor((canvasSize.h - totalH) / 2 + 20));

    // create ordered list of cluster ids; if fixed provided, place it at nearest cell index
    const ids = clustersToLayout.map(c => c.id);
    const cells: { x: number; y: number; cx: number; cy: number }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = originX + c * cellW;
        const y = originY + r * cellH;
        cells.push({ x, y, cx: x + cellW / 2, cy: y + cellH / 2 });
      }
    }

    let assign: string[] = [];
    if (fixed) {
      // find nearest cell to fixed point
      let bestIdx = 0; let bestD = Infinity;
      for (let i = 0; i < cells.length; i++) {
        const d = Math.hypot(cells[i].cx - fixed.x, cells[i].cy - fixed.y);
        if (d < bestD) { bestD = d; bestIdx = i; }
      }
      // place fixed id at bestIdx, fill others in order skipping that slot
      assign = new Array(cells.length).fill('');
      assign[bestIdx] = fixed.id;
      let k = 0;
      for (const id of ids) {
        if (id === fixed.id) continue;
        while (assign[k] !== '') k++;
        assign[k++] = id;
      }
      assign = assign.filter(a => a !== '');
    } else {
      assign = ids.slice(0, cells.length);
    }

    const finalClusters: Cluster[] = [];
    const finalNodes = nodesToLayout.map(n => ({ ...n }));

    for (let i = 0; i < assign.length; i++) {
      const cid = assign[i];
      const cell = cells[i];
      const info = clusterInfo.find(ci => ci.id === cid)!;
      // target center
      const tx = cell.cx;
      const ty = cell.cy;
      // current centroid
      const cx = info.cx || tx;
      const cy = info.cy || ty;
      const dx = tx - cx;
      const dy = ty - cy;
      // update cluster position (use cell top-left as anchor)
      const clusterObj = clustersToLayout.find(c => c.id === cid)!;
      finalClusters.push({ ...clusterObj, x: cell.x, y: cell.y });
      // shift member nodes
      for (let j = 0; j < finalNodes.length; j++) {
        if (finalNodes[j].clusterId === cid) {
          finalNodes[j] = { ...finalNodes[j], x: finalNodes[j].x + dx, y: finalNodes[j].y + dy };
        }
      }
    }

    // include any clusters that couldn't be placed (if any)
    for (const c of clustersToLayout) if (!finalClusters.find(fc => fc.id === c.id)) finalClusters.push({ ...c, x: originX, y: originY });

    return { clusters: finalClusters, nodes: finalNodes };
  };

  // Categorized icon library
const iconCategories = [
  {
    name: 'General',
    icons: [
      { type: 'user', label: 'User', color: '#e3f2fd', icon: '👤' },
      { type: 'system', label: 'System', color: '#fffde7', icon: '💻' },
      { type: 'database', label: 'Database', color: '#e8f5e9', icon: '🗄️' },
      { type: 'server', label: 'Server', color: '#e0e0e0', icon: '🖥️' },
      { type: 'network', label: 'Network', color: '#b3e5fc', icon: '🌐' },
      { type: 'storage', label: 'Storage', color: '#ffe0b2', icon: '💾' },
      { type: 'queue', label: 'Queue', color: '#f8bbd0', icon: '📬' },
      { type: 'api', label: 'API', color: '#c8e6c9', icon: '🔗' },
      { type: 'mobile', label: 'Mobile', color: '#f0f4c3', icon: '📱' },
      { type: 'web', label: 'Web', color: '#b2dfdb', icon: '🌍' },
    ]
  },
  {
    name: 'AWS',
    icons: [
      { type: 'aws-ec2', label: 'EC2', color: '#ffecb3', icon: '🟧' },
      { type: 'aws-s3', label: 'S3', color: '#ffe082', icon: '🟨' },
      { type: 'aws-lambda', label: 'Lambda', color: '#ffd54f', icon: '🟨' },
      { type: 'aws-rds', label: 'RDS', color: '#b3e5fc', icon: '🟦' },
      { type: 'aws-vpc', label: 'VPC', color: '#b2dfdb', icon: '🟩' },
      { type: 'aws-cloudfront', label: 'CloudFront', color: '#f8bbd0', icon: '🟪' },
    ]
  },
  {
    name: 'Azure',
    icons: [
      { type: 'azure-vm', label: 'VM', color: '#e1bee7', icon: '🔷' },
      { type: 'azure-sql', label: 'SQL DB', color: '#b3e5fc', icon: '🔷' },
      { type: 'azure-functions', label: 'Functions', color: '#fff9c4', icon: '⚡' },
      { type: 'azure-blob', label: 'Blob', color: '#b2dfdb', icon: '🔷' },
    ]
  },
  {
    name: 'GCP',
    icons: [
      { type: 'gcp-compute', label: 'Compute', color: '#ffe0b2', icon: '🟥' },
      { type: 'gcp-storage', label: 'Storage', color: '#b2dfdb', icon: '🟦' },
      { type: 'gcp-sql', label: 'SQL', color: '#c8e6c9', icon: '🟩' },
      { type: 'gcp-functions', label: 'Functions', color: '#f8bbd0', icon: '🟪' },
    ]
  }
];
// Flatten all icons for lookup
const allIcons = iconCategories.flatMap(cat => cat.icons);

  // Compute tight bounding box for all visible diagram content (nodes + clusters)
  const getDiagramBBox = () => {
    // consider node extents and cluster bboxes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    // nodes
    for (const n of nodes) {
      const left = n.x - 18 - 4; // icon half + small margin
      const right = n.x + 18 + 4;
      const top = n.y - 18 - 4;
      const bottom = n.y + 18 + 4;
      minX = Math.min(minX, left);
      minY = Math.min(minY, top);
      maxX = Math.max(maxX, right);
      maxY = Math.max(maxY, bottom);
    }
    // clusters (their bboxes include their nodes already)
    for (const c of clusters) {
      const b = getClusterBBox(c.id);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    // fallback to full svg if nothing found
    const svgEl = document.querySelector('svg');
    const svgW = svgEl ? svgEl.clientWidth || 800 : 800;
    const svgH = svgEl ? svgEl.clientHeight || 600 : 600;
    if (!isFinite(minX)) {
      minX = 0; minY = 0; maxX = svgW; maxY = svgH;
    }
  // add small padding to avoid clipping but keep export tight
  const pad = 8;
    minX = Math.max(0, Math.floor(minX - pad));
    minY = Math.max(0, Math.floor(minY - pad));
    maxX = Math.ceil(maxX + pad);
    maxY = Math.ceil(maxY + pad);
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  };

  // Add export handlers inside App()
  const handleSaveSVG = () => {
    const svg = document.querySelector('svg');
    if (!svg) return;
    const bbox = getDiagramBBox();
  // Wrap existing svg content into a new cropped svg string
    const inner = svg.innerHTML;
    const cropped = `<?xml version="1.0" encoding="utf-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${bbox.w}" height="${bbox.h}" viewBox="0 0 ${bbox.w} ${bbox.h}">\n  <g transform="translate(${-bbox.x},${-bbox.y})">${inner}</g>\n</svg>`;
    const blob = new Blob([cropped], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'diagram-cropped.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSavePNG = async () => {
    const svg = document.querySelector('svg');
    if (!svg) return;
    const bbox = getDiagramBBox();
    const inner = svg.innerHTML;
    // Increase raster resolution by current zoom and devicePixelRatio so exported PNG stays sharp
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    const scale = Math.max(1, zoom * dpr);
    const outW = Math.round(bbox.w * scale);
    const outH = Math.round(bbox.h * scale);
    const cropped = `<?xml version="1.0" encoding="utf-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${bbox.w} ${bbox.h}">\n  <g transform="translate(${-bbox.x},${-bbox.y})">${inner}</g>\n</svg>`;

    // Create image from SVG string
    const img = new Image();
    const svgBlob = new Blob([cropped], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (e) => reject(e);
        img.src = url;
      });
    } catch {
      URL.revokeObjectURL(url);
      return;
    }

    // Draw to canvas at the higher resolution
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      URL.revokeObjectURL(url);
      return;
    }
    // background fill
    ctx.fillStyle = '#23272f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, outW, outH);
    URL.revokeObjectURL(url);

    // Convert to blob and download
    canvas.toBlob((blob) => {
      if (!blob) return;
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'diagram-cropped.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    }, 'image/png');
  };

  return (
    <div className="app-container" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Header */}
      <header style={{ height: 68, background: 'linear-gradient(90deg,#0f172a,#111827)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px', boxShadow: '0 2px 8px rgba(2,6,23,0.6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg,#22c1c3,#fdbb2d)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#04101a' }}>V</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0.4 }}>VizCode</div>
            <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 2 }}>Visual diagrams from code</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ color: '#9ca3af', fontSize: 13 }}>Beta</div>
          <div style={{ color: '#cbd5e1', fontSize: 13 }}>
            <a href="mailto:dineshks814@gmail.com" style={{ color: '#cbd5e1', textDecoration: 'none' }}>By Dinesh Siddeshwar</a>
          </div>
        </div>
      </header>
      {/* Main content area */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {/* Column 1: Icon & Arrow Library */}
      <aside className="icon-library" style={{ overflowY: 'auto', maxHeight: '90vh', minWidth: 180, background: '#23272f', color: '#fff', borderRight: '2px solid #333' }}>
  <h4 style={{ fontSize: 16, margin: '0 0 10px 0', fontWeight: 600 }}>Icons & Arrows</h4>
  <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
    {iconCategories.map(category => (
      <div key={category.name} style={{ marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15, margin: '8px 0 6px 0', color: '#ffa726', letterSpacing: 1 }}>{category.name}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {category.icons.map(icon => (
            <div
              key={icon.type}
              draggable
              onDragStart={e => e.dataTransfer.setData('iconType', icon.type)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'grab',
                border: '1px solid #444', borderRadius: 8, padding: '8px 8px', background: '#2c313a',
                fontSize: 22, width: 54, height: 54, justifyContent: 'center', color: '#fff',
              }}
              title={`Drag to add a ${icon.label}`}
            >
              <span>{icon.icon}</span>
              <span style={{ fontSize: 11, color: '#ffa726', fontWeight: 500 }}>{icon.label}</span>
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
</aside>

      {/* Column 2: Prompt Editor */}
      <section className="prompt-editor">
        <h4 style={{ fontSize: 16, margin: '0 0 10px 0', fontWeight: 600 }}>Diagram Prompt</h4>
        {/* Cluster creation UI */}
        <div style={{ marginBottom: 10, background: '#f5f5f5', padding: '8px 0', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontWeight: 500, fontSize: 14, marginLeft: 8 }}>Add Cluster:</label>
          <input
            type="text"
            value={newClusterLabel}
            onChange={e => setNewClusterLabel(e.target.value)}
            placeholder="Cluster name"
            style={{ fontSize: 14, padding: '2px 8px', width: 120 }}
          />
          <button
            style={{ fontSize: 14, padding: '2px 10px' }}
            onClick={() => {
              if (newClusterLabel.trim()) {
                const newId = newClusterLabel.trim().toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
                const pos = findEmptyClusterPosition(180, 100);
                const clusterObj = { id: newId, label: newClusterLabel.trim(), x: pos.x, y: pos.y };
                setClusters(clusters => {
                  const updated = [...clusters, clusterObj];
                  // re-layout clusters to square-ish grid
                  const layout = layoutClusters(updated, nodesRef.current);
                    // use latest edges from refs when regenerating prompt
                    setPrompt(regeneratePrompt(layout.nodes, edgesRef.current, layout.clusters));
                    setNodes(layout.nodes);
                  return layout.clusters;
                });
                setNewClusterLabel('');
              }
            }}
          >Add</button>
        </div>
        <div style={{ marginBottom: 10, background: '#f5f5f5', padding: '8px 0', borderRadius: 6 }}>
          <label style={{ fontWeight: 500, fontSize: 14, marginRight: 8, marginLeft: 8 }}>Arrow Type:</label>
          <select value={arrowType} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleArrowSelectChange(e.target.value)} style={{ fontSize: 14, padding: '2px 8px' }}>
            <option value="single">Single</option>
            <option value="double">Double</option>
            <option value="dotted">Dotted</option>
            <option value="double-dotted">Double Dotted</option>
          </select>
          <span style={{ fontSize: 13, color: '#888', marginLeft: 12 }}>
            (Select before creating a new arrow)
          </span>
        </div>
        <div style={{ height: '60vh' }}>
          <Editor
            height="100%"
            defaultLanguage="plaintext"
            value={prompt}
            theme="vs-dark"
            options={{ minimap: { enabled: false }, fontFamily: 'Fira Mono, Consolas, monospace', wordWrap: 'off', scrollBeyondLastLine: false }}
            onChange={(val: string | undefined) => {
              const newVal = val ?? '';
              const prev = prevLineCountRef.current;
              setPrompt(newVal);
              const newLines = newVal.split(/\r?\n/).length;
              if (newLines > prev) handleParsePrompt();
              prevLineCountRef.current = newLines;
            }}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <button onClick={() => handleParsePrompt()} disabled={loading} style={{ fontSize: 14, padding: '6px 12px' }}>Update Diagram</button>
        </div>
        {error && <div style={{ color: 'red', marginTop: 8 }}>{error}</div>}
      </section>

  {/* Column 3: Diagram Canvas */}
  <main className="diagram-canvas" style={{ flex: 1, minWidth: 0 }}>
        <h4 style={{ fontSize: 16, margin: '0 0 10px 0', fontWeight: 600 }}>Diagram Preview</h4>
        <div style={{ marginBottom: 12, display: 'flex', gap: 10 }}>
            <button onClick={handleSaveSVG} style={{ fontSize: 14, padding: '4px 12px' }}>Save as SVG</button>
            <button onClick={handleSavePNG} style={{ fontSize: 14, padding: '4px 12px' }}>Save as PNG</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
              <button onClick={() => setZoom(z => Math.max(0.2, +(z - 0.1).toFixed(2)))} style={{ fontSize: 14, padding: '4px 10px' }}>Zoom -</button>
              <div style={{ color: '#ccc', minWidth: 64, textAlign: 'center' }}>{Math.round(zoom * 100)}%</div>
              <button onClick={() => setZoom(z => Math.min(3, +(z + 0.1).toFixed(2)))} style={{ fontSize: 14, padding: '4px 10px' }}>Zoom +</button>
              <button onClick={() => setZoom(1)} style={{ fontSize: 12, padding: '4px 8px' }}>Reset</button>
            </div>
        </div>
          <div
            ref={svgWrapperRef}
            onWheel={(e) => {
              // ctrl+wheel to zoom, otherwise scroll
              const ev = e as React.WheelEvent<HTMLDivElement>;
              if (ev.ctrlKey) {
                e.preventDefault();
                setZoom(z => {
                  const delta = -ev.deltaY;
                  if (delta > 0) return Math.min(3, +(z + 0.1).toFixed(2));
                  return Math.max(0.2, +(z - 0.1).toFixed(2));
                });
              }
            }}
            style={{ width: '100%', overflowX: 'auto', overflowY: 'auto', border: '1px solid #2f363c', borderRadius: 12, height: 600 }}
          >
            <svg
              width={canvasSize.w}
              height={canvasSize.h}
              viewBox={`0 0 ${canvasSize.w / zoom} ${canvasSize.h / zoom}`}
              style={{ background: '#23272f', minWidth: canvasSize.w }}
              onDrop={handleCanvasDrop}
              onDragOver={handleCanvasDragOver}
              onMouseMove={handleSvgMouseMove}
              onMouseUp={handleSvgMouseUp}
            >
              {/* defs remain at svg level */}
              <defs>
                <marker id="arrowhead-solid" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto" markerUnits="strokeWidth">
                  <polygon points="0 0, 10 3.5, 0 7" fill="#607d8b" />
                </marker>
                <marker id="arrowhead-dashed" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto" markerUnits="strokeWidth">
                  <polygon points="0 0, 10 3.5, 0 7" fill="#bdbdbd" />
                </marker>
                {/* mirrored start markers for double-sided arrows */}
                <marker id="arrowhead-solid-start" markerWidth="10" markerHeight="7" refX="0" refY="3.5" orient="auto" markerUnits="strokeWidth">
                  <polygon points="10 0, 0 3.5, 10 7" fill="#607d8b" />
                </marker>
                <marker id="arrowhead-dashed-start" markerWidth="10" markerHeight="7" refX="0" refY="3.5" orient="auto" markerUnits="strokeWidth">
                  <polygon points="10 0, 0 3.5, 10 7" fill="#bdbdbd" />
                </marker>
              </defs>
                {renderClusters()}
          {/* Render edges/arrows */}
          {edges.map((edge) => {
            const from = getNode(edge.from);
            const to = getNode(edge.to);
            if (!from || !to) return null;
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const angle = Math.atan2(dy, dx);
            // determine markers and stroke style first
            let markerEnd = 'url(#arrowhead-solid)';
            let markerStart: string | undefined = undefined;
            let strokeDasharray = '0';
            if (edge.type === 'dashed') {
              markerEnd = 'url(#arrowhead-dashed)';
              strokeDasharray = '6,6';
            } else if (edge.type === 'double') {
              markerEnd = 'url(#arrowhead-solid)';
              markerStart = 'url(#arrowhead-solid-start)';
              strokeDasharray = '0';
            } else if (edge.type === 'double-dotted') {
              markerEnd = 'url(#arrowhead-dashed)';
              markerStart = 'url(#arrowhead-dashed-start)';
              strokeDasharray = '6,6';
            }
            const baseR = 18;
            const markerPad = 12; // unified padding so arrowheads sit at icon edge
            const startOffset = baseR + (markerStart ? markerPad : 0);
            const endOffset = baseR + (markerEnd ? markerPad : 0);
            const fromX = from.x + Math.cos(angle) * startOffset;
            const fromY = from.y + Math.sin(angle) * startOffset;
            const toX = to.x - Math.cos(angle) * endOffset;
            const toY = to.y - Math.sin(angle) * endOffset;
            const labelOffset = 18; // perpendicular offset distance for label above the arrow
            // compute route early so we can place label based on routed path
            const route = computeRoute(fromX, fromY, toX, toY);
            // compute midpoint along polyline (by length) and offset perpendicular
            const computeLabelPoint = (pts: {x:number;y:number}[]) => {
              if (!pts || pts.length === 0) return { x: (fromX + toX) / 2, y: (fromY + toY) / 2 };
              // compute segment lengths
              const segs: number[] = [];
              let total = 0;
              for (let i = 0; i < pts.length - 1; i++) {
                const dx = pts[i+1].x - pts[i].x;
                const dy = pts[i+1].y - pts[i].y;
                const l = Math.hypot(dx, dy);
                segs.push(l);
                total += l;
              }
              if (total === 0) return { x: pts[0].x, y: pts[0].y };
              const target = total / 2;
              let acc = 0;
              for (let i = 0; i < segs.length; i++) {
                const l = segs[i];
                if (acc + l >= target) {
                  const remain = target - acc;
                  const t = l === 0 ? 0 : remain / l;
                  const x1 = pts[i].x, y1 = pts[i].y;
                  const x2 = pts[i+1].x, y2 = pts[i+1].y;
                  const px = x1 + (x2 - x1) * t;
                  const py = y1 + (y2 - y1) * t;
                  // tangent
                  const tx = (x2 - x1) / (l || 1);
                  const ty = (y2 - y1) / (l || 1);
                  // perpendicular (rotate tangent -90deg to place label "above")
                  const pxp = -ty;
                  const pyp = tx;
                  return { x: px + pxp * labelOffset, y: py + pyp * labelOffset, angle: Math.atan2(ty, tx) };
                }
                acc += l;
              }
              // fallback to center
              const last = pts[pts.length - 1];
              const first = pts[0];
              return { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2, angle };
            };
            const labelPoint = computeLabelPoint(route.points);
            const labelX = labelPoint.x;
            const labelY = labelPoint.y;
            // Arrow marker logic already computed above
            const edgeObj = edge as Edge & { lable?: string };
            const edgeLabel = edgeObj.label || edgeObj.lable || '';
            return (
              <g key={edge.id} onClick={() => {
                if (window.confirm('Delete this arrow?')) {
                  setEdges((prev: Edge[]) => {
                    const newEdges = prev.filter(e => e.id !== edge.id);
                    setPrompt(regeneratePrompt(nodesRef.current, newEdges, clustersRef.current));
                    return newEdges;
                  });
                }
              }} style={{ cursor: 'pointer' }}>
                    {/* Render routed polyline if needed */}
                    {(() => {
                      if (route.points.length <= 2) {
                        return (
                          <line
                            x1={fromX}
                            y1={fromY}
                            x2={toX}
                            y2={toY}
                            stroke="#607d8b"
                            strokeWidth={2}
                            strokeDasharray={strokeDasharray}
                            markerEnd={markerEnd}
                            markerStart={markerStart}
                          />
                        );
                      }
                      const pointsStr = route.points.map(p => `${p.x},${p.y}`).join(' ');
                      // polyline doesn't support markers on internal segments; apply markers via separate small lines at ends if needed
                      const first = route.points[0];
                      const second = route.points[1];
                      const last = route.points[route.points.length - 1];
                      const penultimate = route.points[route.points.length - 2];
                      return (
                        <g>
                          <polyline points={pointsStr} fill="none" stroke="#607d8b" strokeWidth={2} strokeDasharray={strokeDasharray} />
                          {/* Start marker line */}
                          <line x1={first.x} y1={first.y} x2={second.x} y2={second.y} stroke="transparent" strokeWidth={0.1} markerStart={markerStart} />
                          {/* End marker line */}
                          <line x1={penultimate.x} y1={penultimate.y} x2={last.x} y2={last.y} stroke="transparent" strokeWidth={0.1} markerEnd={markerEnd} />
                        </g>
                      );
                    })()}
        {edgeLabel && (
                  <text
                    x={labelX}
                    y={labelY}
                    fontSize="13"
          fill="#ffffff"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={Math.abs(Math.cos(angle)) < 0.3 ? `rotate(-90,${labelX},${labelY})` : undefined}
                    style={{ userSelect: 'none', pointerEvents: 'none' }}
                  >
          {edgeLabel}
                  </text>
                )}
              </g>
            );
          })}
          {/* Render nodes */}
          {nodes.map(node => {
            // Try to find the icon from allIcons by label or type
            const iconObj = allIcons.find(i => i.label === node.label) || allIcons.find(i => i.type === node.label.toLowerCase().replace(/\s+/g, '-'));
            let iconSvg = null;
            if (iconObj && iconObj.icon) {
              iconSvg = (
                <text x={node.x} y={node.y + 8} fontSize="32" textAnchor="middle" dominantBaseline="middle" fill="#fff">{iconObj.icon}</text>
              );
            } else if (node.label === 'User') {
              iconSvg = (
                <svg x={node.x - 18} y={node.y - 18} width="36" height="36" viewBox="0 0 24 24">
                  <circle cx="12" cy="8" r="4" fill="#fff" />
                  <rect x="6" y="14" width="12" height="6" rx="3" fill="#fff" />
                </svg>
              );
            } else if (node.label === 'System') {
              iconSvg = (
                <svg x={node.x - 18} y={node.y - 18} width="36" height="36" viewBox="0 0 24 24">
                  <rect x="4" y="6" width="16" height="10" rx="2" fill="#fff" stroke="#fff" strokeWidth="1.5" />
                  <rect x="8" y="18" width="8" height="2" rx="1" fill="#fff" stroke="#fff" strokeWidth="1.5" />
                </svg>
              );
            } else if (node.label === 'Database') {
              iconSvg = (
                <svg x={node.x - 18} y={node.y - 18} width="36" height="36" viewBox="0 0 24 24">
                  <ellipse cx="12" cy="8" rx="8" ry="4" fill="#fff" />
                  <rect x="4" y="8" width="16" height="8" rx="8" fill="#fff" />
                  <ellipse cx="12" cy="16" rx="8" ry="4" fill="#fff" />
                </svg>
              );
            }
            return (
              <g key={node.id}
                onMouseDown={e => handleNodeMouseDown(e, node.id)}
                onClick={e => handleNodeClick(e, node.id)}
                onDoubleClick={() => handleNameDoubleClick(node.id, node.name ?? '')}
                style={{ cursor: 'pointer' }}
              >
                {iconSvg}
                {editingNodeId === node.id ? (
                  <foreignObject x={node.x - 50} y={node.y + 20} width={100} height={30}>
                    <input
                      type="text"
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onBlur={handleNameSave}
                      onKeyDown={e => { if (e.key === 'Enter') handleNameSave(); if (e.key === 'Escape') handleNameCancel(); }}
                      style={{ width: '96px', fontSize: '14px', padding: '2px' }}
                      autoFocus
                    />
                  </foreignObject>
                ) : (
                  <text
                    x={node.x}
                    y={node.y + 38}
                    fontSize="14"
                    fill="#fff"
                    textAnchor="middle"
                    style={{ userSelect: 'none', pointerEvents: 'all', background: 'none', cursor: 'pointer' }}
                  >
                    {node.name ? node.name : node.label}
                  </text>
                )}
              </g>
            );
          })}
            {/* Draw cluster outlines on top so they are always visible */}
            {clusters.map(c => {
              const b = getClusterBBox(c.id);
              return (
                <g key={`outline-${c.id}`}> 
                        <rect
                          x={b.x}
                          y={b.y}
                          width={b.w}
                          height={b.h}
                          rx={10}
                          ry={10}
                          fill="none"
                          stroke="#ff9800"
                          strokeWidth={2}
                          strokeOpacity={0.9}
                          onMouseDown={(e) => handleClusterMouseDown(e, c.id)}
                          // only catch events on the stroke so clicks inside the cluster hit nodes
                          style={{ pointerEvents: 'stroke', cursor: 'move' }}
                        />
                  <text x={b.x + 12} y={b.y + 20} fontSize={13} fill="#ffffff" style={{ fontWeight: 600, pointerEvents: 'none' }}>{c.label}</text>
                </g>
              );
            })}
          {/* Edge creation preview */}
          {edgeCreation && edgeCreation.from && (() => {
            const fromNode = nodes.find(n => n.id === edgeCreation.from);
            if (!fromNode) return null;
            const svg = document.querySelector('svg');
            let pt = { x: edgeCreation.x, y: edgeCreation.y };
            if (svg) {
              const svgPt = svg.createSVGPoint();
              svgPt.x = edgeCreation.x;
              svgPt.y = edgeCreation.y;
              const cursorpt = svgPt.matrixTransform(svg.getScreenCTM()?.inverse());
              pt = { x: cursorpt.x, y: cursorpt.y };
            }
            // Preview marker logic based on arrowType
            let markerEnd = 'url(#arrowhead-solid)';
            let markerStart: string | undefined = undefined;
            let strokeDasharray = '0';
            if (arrowType === 'dotted' || arrowType === 'double-dotted') {
              markerEnd = 'url(#arrowhead-dashed)';
              strokeDasharray = '6,6';
            }
            if (arrowType === 'double') {
              markerStart = 'url(#arrowhead-solid-start)';
            } else if (arrowType === 'double-dotted') {
              markerStart = 'url(#arrowhead-dashed-start)';
            }
            const dx = pt.x - fromNode.x;
            const dy = pt.y - fromNode.y;
            const angle = Math.atan2(dy, dx);
            const baseR = 18;
            const markerPad = 12;
            const startOffset = baseR + (markerStart ? markerPad : 0);
            const endOffset = baseR + (markerEnd ? markerPad : 0);
            const startX = fromNode.x + Math.cos(angle) * startOffset;
            const startY = fromNode.y + Math.sin(angle) * startOffset;
            const endX = pt.x - Math.cos(angle) * endOffset;
            const endY = pt.y - Math.sin(angle) * endOffset;
            const route = computeRoute(startX, startY, endX, endY);
            if (route.points.length <= 2) {
              return (
                <line
                  x1={startX}
                  y1={startY}
                  x2={endX}
                  y2={endY}
                  stroke="#607d8b"
                  strokeWidth={2}
                  markerEnd={markerEnd}
                  markerStart={markerStart}
                  strokeDasharray={strokeDasharray}
                  opacity={0.7}
                  pointerEvents="none"
                />
              );
            }
            const pts = route.points.map(p => `${p.x},${p.y}`).join(' ');
            const first = route.points[0];
            const second = route.points[1];
            const last = route.points[route.points.length - 1];
            const penultimate = route.points[route.points.length - 2];
            return (
              <g pointerEvents="none" opacity={0.7}>
                <polyline points={pts} fill="none" stroke="#607d8b" strokeWidth={2} strokeDasharray={strokeDasharray} />
                <line x1={first.x} y1={first.y} x2={second.x} y2={second.y} stroke="transparent" strokeWidth={0.1} markerStart={markerStart} />
                <line x1={penultimate.x} y1={penultimate.y} x2={last.x} y2={last.y} stroke="transparent" strokeWidth={0.1} markerEnd={markerEnd} />
              </g>
            );
          })()}
          {/* (popup removed — edges are created immediately using the global Arrow Type selector) */}
        </svg>
          </div>
      </main>
      </div>
      {/* Footer */}
      <footer style={{ height: 56, background: '#0b1220', color: '#9aa4b2', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px' }}>
        <div style={{ fontSize: 13 }}>© {new Date().getFullYear()} VizCode — Visual diagrams from code</div>
        <div style={{ fontSize: 13 }}>
          <a href="mailto:dineshks814@gmail.com" style={{ color: '#9aa4b2', textDecoration: 'none' }}>By Dinesh Siddeshwar</a>
        </div>
      </footer>
    </div>
  );
}

export default App;
