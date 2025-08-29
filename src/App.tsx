import React, { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
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

// Base (builtin) icon categories - keep General here. Cloud vendor categories are populated at runtime from manifest
const baseIconCategories = [
  {
    name: 'General',
    icons: [
      { type: 'shape-square', label: 'Square', color: '#90a4ae', icon: '◻️' },
      { type: 'shape-rectangle', label: 'Rectangle', color: '#78909c', icon: '▭' },
      { type: 'shape-box', label: 'Box', color: '#b0bec5', icon: '▢' },
      { type: 'shape-circle', label: 'Circle', color: '#81c784', icon: '⚪' },
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
  }
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
  // (updatePromptFromState removed - prompt regeneration is invoked directly where needed)
  // Prompt / backend sync state
  const [prompt, setPrompt] = useState<string>(initialPrompt);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // Temporary arrow UI state
  const [arrowType, setArrowType] = useState<string>('single');

  // Zoom & canvas size state for scrollable/zoomable preview
  const [zoom, setZoom] = useState<number>(1);
  // Make canvas size dynamic so it can expand when content grows
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 4000, h: 2400 });
  const svgWrapperRef = useRef<HTMLDivElement | null>(null);
  const prevLineCountRef = useRef<number>(prompt.split(/\r?\n/).length);

  // Compute bounding box of all content (nodes + clusters)
  const getContentBBox = () => {
    const nodeRadius = 36; // from rendering logic
    const clusterW = 180, clusterH = 100;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodesRef.current) {
      const x = n.x || 0, y = n.y || 0;
      minX = Math.min(minX, x - nodeRadius);
      minY = Math.min(minY, y - nodeRadius);
      maxX = Math.max(maxX, x + nodeRadius);
      maxY = Math.max(maxY, y + nodeRadius);
    }
    for (const c of clustersRef.current) {
      const x = c.x || 0, y = c.y || 0;
      minX = Math.min(minX, x - clusterW / 2 - 24);
      minY = Math.min(minY, y - clusterH / 2 - 24);
      maxX = Math.max(maxX, x + clusterW / 2 + 24);
      maxY = Math.max(maxY, y + clusterH / 2 + 24);
    }
    if (minX === Infinity) {
      // no content
      return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    }
    const width = Math.max(0, maxX - minX);
    const height = Math.max(0, maxY - minY);
    return { minX, minY, maxX, maxY, width, height };
  };

  // Expand canvas if content reaches edges (only expand, don't shrink automatically)
  useEffect(() => {
    const padding = 120;
    const bbox = getContentBBox();
    if (bbox.width === 0 && bbox.height === 0) return;
    const neededW = Math.ceil(bbox.maxX + padding);
    const neededH = Math.ceil(bbox.maxY + padding);
    setCanvasSize(cs => {
      const newW = Math.max(cs.w, neededW, 800);
      const newH = Math.max(cs.h, neededH, 600);
      if (newW !== cs.w || newH !== cs.h) return { w: newW, h: newH };
      return cs;
    });
  }, [nodes, clusters]);

  // Fit-to-content: compute zoom so content fits inside wrapper and center it
  const fitToContent = () => {
    const wrapper = svgWrapperRef.current;
    if (!wrapper) return;
    const bbox = getContentBBox();
    if (bbox.width === 0 && bbox.height === 0) return;
    const availW = wrapper.clientWidth - 40; // padding
    const availH = wrapper.clientHeight - 40;
    if (availW <= 0 || availH <= 0) return;
    const targetZoom = Math.min(availW / Math.max(1, bbox.width), availH / Math.max(1, bbox.height)) * 0.95;
    const clamped = Math.max(0.2, Math.min(3, targetZoom));
    setZoom(clamped);
    // center by scrolling wrapper to the middle of canvas (approx)
    // scrollLeft/Top center values depend on canvas pixel size (svg width/height)
    setTimeout(() => {
      if (!svgWrapperRef.current) return;
      const w = canvasSize.w;
      const h = canvasSize.h;
      svgWrapperRef.current.scrollLeft = Math.max(0, Math.floor((w - svgWrapperRef.current.clientWidth) / 2));
      svgWrapperRef.current.scrollTop = Math.max(0, Math.floor((h - svgWrapperRef.current.clientHeight) / 2));
    }, 50);
  };

  // Set browser tab title
  useEffect(() => {
    document.title = 'VizCode';
  }, []);

  const handleArrowSelectChange = (val: string) => {
    setArrowType(val);
  };

  // Find a free position for a new node or cluster, avoiding overlap with all nodes and clusters
  const findEmptyClusterPosition = (w: number, h: number) => {
    const margin = 24;
    const baseW = Math.max(220, w + 120);
    const baseH = Math.max(160, h + 80);
    const cols = Math.max(2, Math.floor(canvasSize.w / baseW));
    const rows = Math.max(2, Math.ceil((clusters.length + 1) / cols));
    const occupied: { x: number; y: number; w: number; h: number }[] = [];
    for (const n of nodes) occupied.push({ x: n.x - 36, y: n.y - 36, w: 72, h: 72 });
    for (const c of clusters) if (c.x && c.y) occupied.push({ x: c.x - margin, y: c.y - margin, w: 180 + margin * 2, h: 100 + margin * 2 });
    // Try a grid scan, then spiral out if needed
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = 80 + c * baseW;
        const y = 60 + r * baseH;
        const rect = { x: x - margin, y: y - margin, w: w + margin * 2, h: h + margin * 2 };
        let collide = false;
        for (const occ of occupied) {
          if (!(rect.x + rect.w < occ.x || rect.x > occ.x + occ.w || rect.y + rect.h < occ.y || rect.y > occ.y + occ.h)) { collide = true; break; }
        }
        if (!collide) return { x, y };
      }
    }
    // Spiral search if grid is full
    let angle = 0, radius = 200, tries = 0;
    while (tries < 200) {
      const x = canvasSize.w / 2 + Math.cos(angle) * radius;
      const y = canvasSize.h / 2 + Math.sin(angle) * radius;
      const rect = { x: x - margin, y: y - margin, w: w + margin * 2, h: h + margin * 2 };
      let collide = false;
      for (const occ of occupied) {
        if (!(rect.x + rect.w < occ.x || rect.x > occ.x + occ.w || rect.y + rect.h < occ.y || rect.y > occ.y + occ.h)) { collide = true; break; }
      }
      if (!collide) return { x, y };
      angle += Math.PI / 6;
      if (angle > Math.PI * 2) { angle = 0; radius += 40; }
      tries++;
    }
    // fallback: place near top-left offset by existing cluster count
    return { x: 100 + clusters.length * 20, y: 80 + Math.floor(clusters.length / 6) * 40 };
  };

  // Try to find a free position near existing nodes inside a cluster so new nodes sit beside others
  const findPositionNearCluster = (clusterId: string | undefined, w: number, h: number) => {
    if (!clusterId) return findEmptyClusterPosition(w, h);
    const members = nodes.filter(n => n.clusterId === clusterId);
    if (members.length === 0) return findEmptyClusterPosition(w, h);
    // occupied boxes from all nodes/clusters to avoid
    const occupied: { x: number; y: number; w: number; h: number }[] = [];
    for (const n of nodes) occupied.push({ x: n.x - 36, y: n.y - 36, w: 72, h: 72 });
    for (const c of clusters) if (c.x && c.y) occupied.push({ x: c.x - 24, y: c.y - 24, w: 180 + 48, h: 100 + 48 });
    // compute centroid of members and scan grid around it (prefer right side)
    const cx = members.reduce((s, m) => s + m.x, 0) / members.length;
    const cy = members.reduce((s, m) => s + m.y, 0) / members.length;
    const step = 64;
    const maxRadius = 600;
    for (let r = 0; r <= maxRadius; r += step) {
      // try positions in a ring (prefer right, bottom, left, top)
      const candidates = [
        { x: cx + r + step, y: cy },
        { x: cx + r + step, y: cy + step },
        { x: cx + r + step, y: cy - step },
        { x: cx, y: cy + r + step },
        { x: cx + step, y: cy + r + step },
        { x: cx - step, y: cy + r + step },
        { x: cx - r - step, y: cy },
        { x: cx - r - step, y: cy + step },
        { x: cx - r - step, y: cy - step },
        { x: cx, y: cy - r - step },
      ];
      for (const cand of candidates) {
        const rect = { x: cand.x - 24, y: cand.y - 24, w: w + 48, h: h + 48 };
        let collide = false;
        for (const occ of occupied) {
          if (!(rect.x + rect.w < occ.x || rect.x > occ.x + occ.w || rect.y + rect.h < occ.y || rect.y > occ.y + occ.h)) { collide = true; break; }
        }
        if (!collide) return { x: cand.x, y: cand.y };
      }
    }
    // fallback
    return findEmptyClusterPosition(w, h);
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
  const segmentIntersectsAnyNode = (x1: number, y1: number, x2: number, y2: number, ignoreIds?: string[]) => {
    for (const n of nodes) {
      if (ignoreIds && ignoreIds.includes(n.id)) continue;
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

  // Enhanced smart router: try straight, L, U, S, J, and fallback to curved if needed
  const computeRoute = (x1: number, y1: number, x2: number, y2: number, ignoreIds?: string[]) : { points: {x:number;y:number}[], routed: boolean } => {
    // Helper to check all segments in a path
    const pathIsClear = (pts: {x:number;y:number}[]) => {
      for (let i = 0; i < pts.length - 1; i++) {
        if (segmentIntersectsAnyNode(pts[i].x, pts[i].y, pts[i+1].x, pts[i+1].y, ignoreIds)) return false;
      }
      return true;
    };
    // Try straight
    if (pathIsClear([{x:x1,y:y1},{x:x2,y:y2}])) return { points: [{x:x1,y:y1},{x:x2,y:y2}], routed: false };
    // Try L-shapes
    const mid1 = { x: x2, y: y1 };
    if (pathIsClear([{x:x1,y:y1}, mid1, {x:x2,y:y2}])) return { points: [{x:x1,y:y1}, mid1, {x:x2,y:y2}], routed: true };
    const mid2 = { x: x1, y: y2 };
    if (pathIsClear([{x:x1,y:y1}, mid2, {x:x2,y:y2}])) return { points: [{x:x1,y:y1}, mid2, {x:x2,y:y2}], routed: true };
    // Try U, S, J shapes with various offsets
    const offsets = [60, 100, 140, 180];
    for (const offset of offsets) {
      const candidates = [
        // U/S shapes
        [{x:x1,y:y1}, {x:x1,y:y1 - offset}, {x:x2,y:y1 - offset}, {x:x2,y:y2}],
        [{x:x1,y:y1}, {x:x1,y:y1 + offset}, {x:x2,y:y1 + offset}, {x:x2,y:y2}],
        [{x:x1,y:y1}, {x:x1 - offset,y:y1}, {x:x1 - offset,y:y2}, {x:x2,y:y2}],
        [{x:x1,y:y1}, {x:x1 + offset,y:y1}, {x:x1 + offset,y:y2}, {x:x2,y:y2}],
        // J shapes
        [{x:x1,y:y1}, {x:x1 + offset, y:y1}, {x:x1 + offset, y:y2}, {x:x2, y:y2}],
        [{x:x1,y:y1}, {x:x1 - offset, y:y1}, {x:x1 - offset, y:y2}, {x:x2, y:y2}],
        [{x:x1,y:y1}, {x:x1, y:y1 + offset}, {x:x2, y:y1 + offset}, {x:x2, y:y2}],
        [{x:x1,y:y1}, {x:x1, y:y1 - offset}, {x:x2, y:y1 - offset}, {x:x2, y:y2}],
      ];
      for (const cand of candidates) {
        if (pathIsClear(cand)) return { points: cand, routed: true };
      }
    }
    // Fallback: try a simple quadratic curve (sampled as polyline)
    const ctrl = { x: (x1 + x2) / 2 + 80, y: (y1 + y2) / 2 - 80 };
    const curve = [];
    for (let t = 0; t <= 1.0; t += 0.2) {
      const x = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * ctrl.x + t * t * x2;
      const y = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * ctrl.y + t * t * y2;
      curve.push({ x, y });
    }
    if (pathIsClear(curve)) return { points: curve, routed: true };
    // If all else fails, return straight (may overlap)
    return { points: [{x:x1,y:y1},{x:x2,y:y2}], routed: false };
  };

  // Return candidate attachment points around a node (edges and corners)
  const getAttachmentPoints = (n: Node) => {
    const r = 18; // half icon
    const pts = [
      { x: n.x - r, y: n.y, side: 'left' },
      { x: n.x + r, y: n.y, side: 'right' },
      { x: n.x, y: n.y - r, side: 'top' },
      { x: n.x, y: n.y + r, side: 'bottom' },
      { x: n.x - r, y: n.y - r, side: 'tl' },
      { x: n.x + r, y: n.y - r, side: 'tr' },
      { x: n.x - r, y: n.y + r, side: 'bl' },
      { x: n.x + r, y: n.y + r, side: 'br' },
    ];
    return pts;
  };

  // High-level router: try attachment points on both nodes and pick the shortest clear route
  const computeRouteForNodes = (from: Node, to: Node) : { points: {x:number;y:number}[], routed: boolean } => {
    const fromPts = getAttachmentPoints(from);
    const toPts = getAttachmentPoints(to);
    let best: { points: {x:number;y:number}[], routed: boolean } | null = null;
    let bestLen = Infinity;
  // (duplicate quick A* removed) rely on the robust orthogonal A* implementation below

    // Because the quick in-place A* above didn't keep parents persistently, implement a reliable A* with parent map now
    const orthogonalAStar = (start: {x:number;y:number}, end: {x:number;y:number}) => {
      const cell = 20;
      const margin = 80;
      const minX = Math.max(0, Math.floor((Math.min(start.x, end.x) - margin) / cell));
      const minY = Math.max(0, Math.floor((Math.min(start.y, end.y) - margin) / cell));
      const maxX = Math.ceil((Math.max(start.x, end.x) + margin) / cell);
      const maxY = Math.ceil((Math.max(start.y, end.y) + margin) / cell);
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const occ = new Array(h).fill(0).map(() => new Array(w).fill(false));
      const pad = 10;
      for (const n of nodes) {
        const left = Math.floor((n.x - 18 - pad) / cell) - minX;
        const right = Math.floor((n.x + 18 + pad) / cell) - minX;
        const top = Math.floor((n.y - 18 - pad) / cell) - minY;
        const bottom = Math.floor((n.y + 18 + pad) / cell) - minY;
        for (let yy = Math.max(0, top); yy <= Math.min(h - 1, bottom); yy++) {
          for (let xx = Math.max(0, left); xx <= Math.min(w - 1, right); xx++) {
            occ[yy][xx] = true;
          }
        }
      }
      const toGrid = (p: {x:number;y:number}) => ({ gx: Math.max(0, Math.min(w-1, Math.round(p.x / cell) - minX)), gy: Math.max(0, Math.min(h-1, Math.round(p.y / cell) - minY)) });
      const fromG = toGrid(start);
      const toG = toGrid(end);
      occ[fromG.gy][fromG.gx] = false; occ[toG.gy][toG.gx] = false;
      type Cell = { x: number; y: number };
      const key = (c: Cell) => `${c.x},${c.y}`;
      const dirs: Cell[] = [ {x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1} ];
      const openHeap: {k:string;cost:number;prio:number}[] = [];
      const parents = new Map<string,string>();
      const gscore = new Map<string,number>();
      const pushHeap = (k:string, cost:number, prio:number) => { openHeap.push({k,cost,prio}); gscore.set(k,cost); };
      const popHeap = () => {
        if (openHeap.length === 0) return undefined;
        let bestI = 0; for (let i = 1; i < openHeap.length; i++) if (openHeap[i].prio < openHeap[bestI].prio) bestI = i;
        const item = openHeap.splice(bestI,1)[0]; return item;
      };
      const startKey = key({ x: fromG.gx, y: fromG.gy });
      const goalKey = key({ x: toG.gx, y: toG.gy });
      pushHeap(startKey, 0, Math.abs(fromG.gx - toG.gx) + Math.abs(fromG.gy - toG.gy));
      gscore.set(startKey, 0);
      const inBounds = (x:number,y:number) => x>=0 && y>=0 && x<w && y<h;
      while (openHeap.length) {
        const cur = popHeap(); if (!cur) break;
        const [cx,cy] = cur.k.split(',').map(s=>parseInt(s,10));
        if (cur.k === goalKey) break;
        for (const d of dirs) {
          const nx = cx + d.x; const ny = cy + d.y;
          if (!inBounds(nx,ny)) continue;
          if (occ[ny][nx]) continue;
          const nk = `${nx},${ny}`;
          const tentative = (gscore.get(cur.k) || Infinity) + 1;
          if (tentative < (gscore.get(nk) || Infinity)) {
            parents.set(nk, cur.k);
            const prio = tentative + Math.abs(nx - toG.gx) + Math.abs(ny - toG.gy);
            pushHeap(nk, tentative, prio);
          }
        }
      }
      if (!parents.has(goalKey) && startKey !== goalKey) return null;
      // reconstruct path
      const rev: Cell[] = [];
      let curk = goalKey;
      rev.push({ x: toG.gx, y: toG.gy });
      while (curk !== startKey) {
        const p = parents.get(curk);
        if (!p) break;
        const parts = p.split(',').map(s=>parseInt(s,10));
        rev.push({ x: parts[0], y: parts[1] });
        curk = p;
      }
      rev.reverse();
      // convert grid path to world coordinates (cell centers)
      const pts = rev.map(c => ({ x: (c.x + minX) * cell, y: (c.y + minY) * cell }));
      // Simplify polyline by removing collinear points
      const simp: {x:number;y:number}[] = [];
      for (let i = 0; i < pts.length; i++) {
        if (i === 0 || i === pts.length - 1) { simp.push(pts[i]); continue; }
        const a = pts[i-1], b = pts[i], c = pts[i+1];
        const vx1 = b.x - a.x, vy1 = b.y - a.y;
        const vx2 = c.x - b.x, vy2 = c.y - b.y;
        if (Math.abs(vx1*vy2 - vy1*vx2) < 0.01) continue; // collinear
        simp.push(b);
      }
      // ensure start and end attach exactly to requested start/end
      if (simp.length === 0) return null;
      simp[0] = start; simp[simp.length-1] = end;
      return { points: simp, routed: true };
    };

    // Try orthogonal A* for all attachment pairs
    for (const fp of fromPts) {
      for (const tp of toPts) {
  const r = orthogonalAStar(fp, tp) || null;
        if (r && r.points) {
          // compute length
          let len = 0;
          for (let i = 0; i < r.points.length - 1; i++) len += Math.hypot(r.points[i+1].x - r.points[i].x, r.points[i+1].y - r.points[i].y);
          if (len < bestLen) { bestLen = len; best = r; }
        }
        // otherwise fallback to previous heuristics
        const heur = computeRoute(fp.x, fp.y, tp.x, tp.y, [from.id, to.id]);
        if (heur && heur.points) {
          let len = 0; for (let i = 0; i < heur.points.length - 1; i++) len += Math.hypot(heur.points[i+1].x - heur.points[i].x, heur.points[i+1].y - heur.points[i].y);
          if (len < bestLen) { bestLen = len; best = heur; }
        }
      }
    }
    return best || { points: [{ x: from.x, y: from.y }, { x: to.x, y: to.y }], routed: false };
  };

  // Helper: regenerate prompt from nodes, edges, clusters (flat, includes cross-cluster edges)
  const regeneratePrompt = (nodes: Node[], edges: Edge[], clusters: Cluster[]): string => {
    // Build a map of clusters by parentId for nesting
    const byParent = new Map<string | undefined, Cluster[]>();
    clusters.forEach(c => {
      const p = c.parentId;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p)!.push(c);
    });

    // Helper to recursively print clusters and their nodes with indentation
    const printCluster = (cluster: Cluster, indent: number): string => {
      const pad = '  '.repeat(indent);
      let out = `${pad}Cluster: ${cluster.label}\n`;
      // Print nodes in this cluster
      for (const node of nodes.filter(n => n.clusterId === cluster.id)) {
        out += `${pad}  Node: ${node.label}`;
        if (node.name) out += ` [name=${node.name}]`;
        out += '\n';
      }
      // Print child clusters
      const children = byParent.get(cluster.id) || [];
      for (const child of children) {
        out += printCluster(child, indent + 1);
      }
      return out;
    };

    // Print all top-level clusters
    let prompt = '';
    const topClusters = byParent.get(undefined) || [];
    for (const cluster of topClusters) {
      prompt += printCluster(cluster, 0);
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
      // If dropped inside a cluster, snap to a free nearby position to avoid overlapping other icons
      const pos = clusterId ? findPositionNearCluster(clusterId, 180, 100) : { x: cursorpt.x, y: cursorpt.y };
      const newNodes = [
        ...nodes,
        {
          id: `${iconType}-${Date.now()}`,
          label: icon.label,
          name: '',
          x: pos.x,
          y: pos.y,
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
    const mods = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey };
    clickTimers.current[nodeId] = window.setTimeout(() => {
      clickTimers.current[nodeId] = null;
      // require Ctrl+Shift+Click to delete to avoid accidental deletes
      if (!(mods.ctrl && mods.shift)) return;
      if (window.confirm('Delete this node and its connected edges? (Ctrl+Shift+Click confirmed)')) {
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
  function compute(id: string, depth = 0): { x: number; y: number; w: number; h: number } {
      if (visited.has(id)) return { x: 100, y: 80, w: 180, h: 100 };
      visited.add(id);
        const nodesInCluster = nodes.filter(n => n.clusterId === id);
        // icon half-size (icons are drawn in a 36x36 box) and label offset below the icon
        const iconHalf = 18;
        const labelBelow = 22; // space for the node label rendered below the icon
        const nodeMargin = 8; // small breathing room around nodes
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of nodesInCluster) {
          const left = n.x - iconHalf - nodeMargin;
          const right = n.x + iconHalf + nodeMargin;
          const top = n.y - iconHalf - nodeMargin;
          const bottom = n.y + iconHalf + labelBelow + nodeMargin;
          minX = Math.min(minX, left);
          minY = Math.min(minY, top);
          maxX = Math.max(maxX, right);
          maxY = Math.max(maxY, bottom);
        }
      // include child clusters and leave a larger gap between parent and child outlines
      const childClusters = clusters.filter(c => c.parentId === id);
  // Base gap between a parent outline and its child cluster outline. Increase slightly with depth
  const baseChildGap = 32; // make base gap larger so parent/child outlines are clearly separated
  const childGap = baseChildGap + depth * 8; // deeper nesting gets more breathing room
      for (const child of childClusters) {
        const b = compute(child.id, depth + 1);
        minX = Math.min(minX, b.x - childGap);
        minY = Math.min(minY, b.y - childGap);
        maxX = Math.max(maxX, b.x + b.w + childGap);
        maxY = Math.max(maxY, b.y + b.h + childGap);
      }
      if (minX === Infinity) {
        // empty cluster: pick a free spot using helper
        const pos = findEmptyClusterPosition(180, 100);
        return { x: pos.x, y: pos.y, w: 180, h: 100 };
      }
  // increase padding for nested clusters to create clearer gap between outlines
  // Increase padding for the returned bbox; scale a bit with depth to keep nested gaps visible
  const basePad = 24;
  const pad = basePad + Math.max(0, depth) * 6;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
    }
    return compute(clusterId);
  };

  // Prompt parsing handler (restored to correct scope)
  const handleParsePrompt = async (promptText?: string) => {
    const usedPrompt = promptText ?? prompt;
    setLoading(true);
    setError(null);
    // Immediately parse locally so the UI updates with user-provided labels while preserving positions
    try {
      const localImmediate = parsePromptLocally(usedPrompt, nodesRef.current);
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
        body: JSON.stringify({ prompt: usedPrompt }),
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
  const local = parsePromptLocally(usedPrompt, nodesRef.current);
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
  const local = parsePromptLocally(prompt, nodesRef.current);
        setNodes(local.nodes);
        setEdges(local.edges);
        setClusters(local.clusters);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      // on error, try local parse so user changes appear without backend
  const local = parsePromptLocally(prompt, nodesRef.current);
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
  const parsePromptLocally = (text: string, existingNodes?: Node[]) => {
    const lines = text.split(/\r?\n/);
    const outClusters: Cluster[] = [];
    const outNodes: Node[] = [];
    const outEdges: Edge[] = [];
    const clusterStack: { id: string, indent: number }[] = [];
    const clusterNodes: Record<string, unknown[]> = {};
    for (const line of lines) {
      const indentMatch = line.match(/^([ \t]*)/);
      const indent = indentMatch ? indentMatch[1].length : 0;
      const mCluster = line.match(/^[ \t]*Cluster:\s*(.+)$/i);
      if (mCluster) {
        const label = mCluster[1].trim();
        const id = label.toLowerCase().replace(/\s+/g,'-');
        // Pop stack until the top has a lower indent
        while (clusterStack.length && clusterStack[clusterStack.length - 1].indent >= indent) {
          clusterStack.pop();
        }
        const parentId = clusterStack.length ? clusterStack[clusterStack.length - 1].id : undefined;
        outClusters.push({ id, label, parentId });
        clusterNodes[id] = [];
        clusterStack.push({ id, indent });
        continue;
      }
      const mNode = line.match(/^[ \t]*Node:\s*([^[]+)(?:\s*\[(.+)\])?$/i);
      if (mNode && clusterStack.length) {
        const label = mNode[1].trim();
        const attrs = mNode[2];
        let name: string | undefined = undefined;
        if (attrs) {
          const nameMatch = attrs.match(/name\s*=\s*([^\]]+)/i);
          if (nameMatch) name = nameMatch[1].trim();
        }
        const id = (name || label).toLowerCase().replace(/\s+/g,'-') + '-' + Date.now() + '-' + Math.round(Math.random()*1000);
  const currentCluster = clusterStack[clusterStack.length - 1].id;
  const pos = findPositionNearCluster(currentCluster, 180, 100);
  outNodes.push({ id, label: label.trim(), name: name ? name.trim() : undefined, x: pos.x, y: pos.y, clusterId: currentCluster });
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
    // We build the clusterMap first, then construct mergedClusters so that the parsed parent-child
    // relationships are preserved exactly (no inference or preservation of old parentIds).
    const clusterMap = new Map<string, string>();
    const existingClusterByLabel = new Map<string, Cluster>();
    for (const c of existingClusters) existingClusterByLabel.set(c.label.toLowerCase(), c);
    // First pass: establish mapping from parsed cluster id to final cluster id (existing id if label matches, otherwise keep parsed id)
    for (const pc of parsed.clusters) {
      const found = existingClusterByLabel.get(pc.label.toLowerCase());
      clusterMap.set(pc.id, found ? found.id : pc.id);
    }
    // Second pass: construct mergedClusters but enforce the parsed parentId mapping (mapped through clusterMap).
    const mergedClusters: Cluster[] = [];
    for (const pc of parsed.clusters) {
      const mappedParent = pc.parentId ? (clusterMap.get(pc.parentId) || pc.parentId) : undefined;
      const found = existingClusterByLabel.get(pc.label.toLowerCase());
      if (found) {
        // Use the existing cluster id but override its parentId with the parsed (mapped) parent.
        mergedClusters.push({ ...found, label: pc.label, parentId: mappedParent });
      } else {
        mergedClusters.push({ ...pc, parentId: mappedParent });
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
        const mappedCluster = pn.clusterId ? (clusterMap.get(pn.clusterId) || pn.clusterId) : undefined;
        const pos = findPositionNearCluster(mappedCluster, 180, 100);
        const newId = pn.id || (pn.label.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now());
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

    // To avoid cluster outline overlap (because getClusterBBox adds padding and child gaps),
    // estimate a safe cell size per cluster by considering nesting depth and the padding/gap constants.
    const baseChildGap = 32; // must match getClusterBBox baseChildGap
    const childGapPerDepth = 8;
    const basePad = 24; // must match getClusterBBox basePad
    const padPerDepth = 6;
    // compute depth for each cluster (number of ancestors)
    const clusterById = new Map(clustersToLayout.map(c => [c.id, c] as [string, Cluster]));
    const depthMap = new Map<string, number>();
    const computeDepth = (cid: string | undefined): number => {
      if (!cid) return 0;
      if (depthMap.has(cid)) return depthMap.get(cid)!;
      let d = 0;
      let cur = clusterById.get(cid);
      while (cur && cur.parentId) {
        d++;
        cur = clusterById.get(cur.parentId);
      }
      depthMap.set(cid, d);
      return d;
    };
    // estimate required sizes including padding + potential child gaps
    const estSizes = clusterInfo.map(ci => {
      const depth = computeDepth(ci.id) || 0;
      const extraW = 2 * (basePad + depth * padPerDepth) + 2 * (baseChildGap + depth * childGapPerDepth);
      const extraH = 2 * (basePad + depth * padPerDepth) + 2 * (baseChildGap + depth * childGapPerDepth);
      return { w: ci.w + extraW + 40, h: ci.h + extraH + 40 };
    });
    const maxW = Math.max(...estSizes.map(s => s.w));
    const maxH = Math.max(...estSizes.map(s => s.h));
    // add extra spacing between grid cells to avoid congestion
    const spacing = Math.max(120, Math.floor(Math.min(maxW, maxH) / 3));
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

    // After shifting nodes into their grid cells, pack members inside each cluster to avoid overlaps
    // Build a map from cluster id to cell centers for packing
    const cellCenterMap = new Map<string, { cx: number; cy: number }>();
    for (let i = 0; i < assign.length; i++) {
      const cid = assign[i];
      const cell = cells[i];
      cellCenterMap.set(cid, { cx: cell.cx, cy: cell.cy });
    }
    // pack each cluster's members into a small grid around the cluster cell center
  const spacingPack = 84; // distance between icons when packed (icon 36 + margin)
    const nodeIndexMap = new Map<string, number[]>();
    for (let i = 0; i < finalNodes.length; i++) {
      const n = finalNodes[i];
      if (!n.clusterId) continue;
      if (!nodeIndexMap.has(n.clusterId)) nodeIndexMap.set(n.clusterId, []);
      nodeIndexMap.get(n.clusterId)!.push(i);
    }
    for (const [cid, idxs] of nodeIndexMap.entries()) {
      if (idxs.length <= 1) continue;
      const center = cellCenterMap.get(cid) || { cx: finalNodes[idxs[0]].x, cy: finalNodes[idxs[0]].y };
      const count = idxs.length;
      const colsPack = Math.ceil(Math.sqrt(count));
      const rowsPack = Math.ceil(count / colsPack);
  const startX = center.cx - ((colsPack - 1) * spacingPack) / 2;
  const startY = center.cy - ((rowsPack - 1) * spacingPack) / 2;
      for (let k = 0; k < idxs.length; k++) {
        const row = Math.floor(k / colsPack);
        const col = k % colsPack;
  const targetX = startX + col * spacingPack;
  const targetY = startY + row * spacingPack;
        const idx = idxs[k];
        finalNodes[idx] = { ...finalNodes[idx], x: targetX, y: targetY };
      }
    }

    // include any clusters that couldn't be placed (if any)
    for (const c of clustersToLayout) if (!finalClusters.find(fc => fc.id === c.id)) finalClusters.push({ ...c, x: originX, y: originY });

    return { clusters: finalClusters, nodes: finalNodes };
  };
  

  // iconCategories is state so we can merge runtime-provided vendor icons (from public/icons/manifest.json)
  type IconCategory = { name: string; icons: IconDef[] };
  const [iconCategories, setIconCategories] = useState<IconCategory[]>(baseIconCategories as IconCategory[]);

  // On mount, try to fetch a manifest that lists all SVGs under /icons and add them as categories (AWS/Azure/GCP)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/icons/manifest.json');
        if (!res.ok) return;
        const manifest = await res.json() as Record<string, string[]>;
        // Ensure preferred vendor ordering: AWS, Azure, GCP first
        const preferred = ['AWS', 'Azure', 'GCP'];
        const keys = Array.from(new Set([...preferred, ...Object.keys(manifest)]));
        const vendorCats = keys.filter(k => manifest[k] && manifest[k].length).map(k => ({
          name: k,
          icons: (manifest[k] || []).map(p => {
            const name = p.split('/').pop() || p;
            const label = name.replace(/\.svg$/i, '');
            const type = (k + '-' + label).toLowerCase().replace(/[^a-z0-9]+/g, '-');
            return { type, label, color: '#9ca3af', icon: p } as IconDef;
          })
        }));
        // Replace categories with base + ordered vendor categories
        setIconCategories(() => {
          return [...(baseIconCategories as IconCategory[]), ...vendorCats];
        });
      } catch {
        // ignore manifest load errors
      }
    })();
  }, []);
// Flatten all icons for lookup
// uploaded icons (SVGs) added by the user
type IconDef = { type: string; label: string; color: string; icon: string };
type UploadedIcon = { type: string; label: string; color?: string; icon: string };
const [uploadedIcons, setUploadedIcons] = useState<UploadedIcon[]>([]);
// search term for icons
const [iconSearch, setIconSearch] = useState<string>('');
const allIcons = (iconCategories.flatMap(cat => cat.icons) as IconDef[]).concat(uploadedIcons as IconDef[]);

    // Right-click handler: copy icon label to clipboard immediately and show a short toast
    const [copyMessage, setCopyMessage] = useState<string | null>(null);
    const handleIconContextMenu = async (e: React.MouseEvent, label: string) => {
      e.preventDefault();
      if (!label) return;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(label);
        } else {
          const ta = document.createElement('textarea');
          ta.value = label;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        setCopyMessage(`${label} copied`);
        setTimeout(() => setCopyMessage(null), 1500);
      } catch {
        setCopyMessage('Copy failed');
        setTimeout(() => setCopyMessage(null), 1500);
      }
    };

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
  const handleSaveSVG = async () => {
    const svg = document.querySelector('svg');
    if (!svg) return;
    const bbox = getDiagramBBox();

    // Clone and inline external images
    const clone = svg.cloneNode(true) as SVGSVGElement;
    try {
      const imgs = Array.from(clone.querySelectorAll('image')) as SVGImageElement[];
      await Promise.all(imgs.map(async (img) => {
        try {
          let href = img.getAttribute('href') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
          if (!href) return;
          if (href.startsWith('data:')) return;
          if (href.startsWith('/')) href = window.location.origin + href;
          const res = await fetch(href);
          if (!res.ok) return;
          const blob = await res.blob();
          const dataUrl = await new Promise<string>((resolve) => {
            const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsDataURL(blob);
          });
          img.setAttribute('href', dataUrl);
          img.removeAttribute('xlink:href');
  } catch { /* ignore */ }
      }));
  } catch { /* ignore */ }

    const inner = clone.innerHTML;
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
  // Clone the SVG and replace foreignObject emoji blocks with SVG <text> so rasterization works
  const clone = svg.cloneNode(true) as SVGSVGElement;
    try {
      const fobjs = Array.from(clone.querySelectorAll('foreignObject'));
      for (const f of fobjs) {
        // find inner text (emoji) if present
        let emoji = '';
        try {
          const div = f.querySelector('div');
          emoji = div ? (div.textContent || '') : (f.textContent || '');
  } catch {
          emoji = f.textContent || '';
        }
        const x = parseFloat(f.getAttribute('x') || '0');
        const y = parseFloat(f.getAttribute('y') || '0');
        const w = parseFloat(f.getAttribute('width') || '36');
        const h = parseFloat(f.getAttribute('height') || '36');
        const tx = x + w / 2;
        const ty = y + h / 2 + 6; // adjust baseline
        const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        textEl.setAttribute('x', String(tx));
        textEl.setAttribute('y', String(ty));
        textEl.setAttribute('font-size', '28');
        textEl.setAttribute('text-anchor', 'middle');
        textEl.setAttribute('fill', '#ffffff');
        textEl.textContent = emoji;
        f.parentNode?.replaceChild(textEl, f);
      }
    } catch {
      // if anything goes wrong, fall back to original innerHTML
    }
    // Inline external <image> hrefs so rasterization includes vendor icons
    try {
      const imgs = Array.from(clone.querySelectorAll('image')) as SVGImageElement[];
      await Promise.all(imgs.map(async (img) => {
        try {
          let href = img.getAttribute('href') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
          if (!href) return;
          if (href.startsWith('data:')) return;
          if (href.startsWith('/')) href = window.location.origin + href;
          const res = await fetch(href);
          if (!res.ok) return;
          const blob = await res.blob();
          const dataUrl = await new Promise<string>((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsDataURL(blob); });
          img.setAttribute('href', dataUrl);
          img.removeAttribute('xlink:href');
  } catch { /* ignore */ }
      }));
  } catch { /* ignore */ }
    const inner = clone.innerHTML;
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
          <img src="/vizcode.svg" alt="VizCode" style={{ width: 52, height: 52, borderRadius: 10 }} />
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 0.6, background: 'linear-gradient(90deg,#7dd3fc,#60a5fa)', WebkitBackgroundClip: 'text', color: 'transparent' }}>VizCode</div>
            <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}>Visual diagrams from code</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ color: '#9ca3af', fontSize: 13 }}>Beta</div>
          {/* Help button (?) opens a modal with detailed help content (fetched from public/help.html) */}
          <button title="Help" onClick={async () => {
            // fetch help HTML and display in modal
            try {
              const res = await fetch('/help.html');
              const html = await res.text();
              const modal = document.createElement('div');
              modal.setAttribute('id', 'vizcode-help-modal');
              modal.style.position = 'fixed';
              modal.style.left = '0'; modal.style.top = '0'; modal.style.right = '0'; modal.style.bottom = '0';
              modal.style.display = 'flex'; modal.style.alignItems = 'center'; modal.style.justifyContent = 'center';
              modal.style.background = 'rgba(2,6,23,0.6)'; modal.style.zIndex = '9999';
              // wrap fetched HTML in a viz-help container so css is scoped and prevent body scroll while open
              modal.innerHTML = `
                <div style="width:calc(100% - 80px); max-width:960px; max-height:88vh; background:transparent; border-radius:12px; overflow:hidden; box-shadow:0 12px 40px rgba(2,6,23,0.6);">
                  <div style="display:flex; justify-content:flex-end; padding:6px; background:transparent;">
                    <button id="vizcode-help-close" style="background:#0b1220; border:0; color:#ffffff; font-size:18px; padding:6px 10px; border-radius:8px; cursor:pointer">✕</button>
                  </div>
                  <div style="padding:0; height:calc(88vh - 56px); overflow:auto; background:transparent"><div class='viz-help'>${html}</div></div>
                </div>
              `;
              document.body.appendChild(modal);
              // prevent background from scrolling while modal is open
              const prevOverflow = document.body.style.overflow;
              document.body.style.overflow = 'hidden';
              const closeBtn = document.getElementById('vizcode-help-close');
              closeBtn?.addEventListener('click', () => { document.body.style.overflow = prevOverflow; modal.remove(); });
            } catch {
              alert('Failed to load help content');
            }
          }} style={{ background: '#ffa726', border: '0', color: '#071026', padding: '8px 12px', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 700 }}>
            Help
          </button>
        </div>
      </header>
  {/* Main content area */}
  <div className="main-content" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {/* Column 1: Icon & Arrow Library */}
      <aside className="icon-library" style={{ overflowY: 'auto', maxHeight: '90vh', minWidth: 180, background: '#23272f', color: '#fff', borderRight: '2px solid #333' }}>
  <h4 style={{ fontSize: 16, margin: '0 0 10px 0', fontWeight: 600 }}>Icons</h4>
  <div style={{ margin: '6px 0 10px 0' }}>
    <input value={iconSearch} onChange={e => setIconSearch(e.target.value)} placeholder="Search icons..." style={{ width: '100%', padding: '6px 8px', borderRadius: 8, border: '1px solid #374151', background: '#0f172a', color: '#fff' }} />
  </div>
  <div style={{ margin: '6px 0 10px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
    <label style={{ fontSize: 13, color: '#cbd5e1' }}>Upload SVG:</label>
    <input id="upload-svg-input" className="hidden-file-input" type="file" accept="image/svg+xml" onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
              const txt = String(ev.target?.result || '');
              // Basic sanitize: ensure it starts with <svg
  if (!/<svg[\s\S]*>/i.test(txt)) { alert('Invalid SVG'); return; }
              const dataUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(txt);
              const label = f.name.replace(/\.svg$/i, '');
              const id = label.toLowerCase().replace(/\s+/g,'-') + '-' + Date.now();
              setUploadedIcons(prev => [...prev, { type: id, label, icon: dataUrl }]);
            };
            reader.readAsText(f);
            // reset input so same file can be uploaded again
            (e.target as HTMLInputElement).value = '';
          }} />
  <label htmlFor="upload-svg-input" className="btn-help-small" style={{ cursor: 'pointer' }}>Choose File</label>
  </div>
  <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
    {uploadedIcons.filter(ic => ic.label.toLowerCase().includes(iconSearch.toLowerCase()) || ic.type.toLowerCase().includes(iconSearch.toLowerCase())).length > 0 && (
          <div style={{ marginTop: 4 }}>
            <div style={{ fontWeight: 700, fontSize: 15, margin: '8px 0 6px 0', color: '#ffa726', letterSpacing: 1 }}>Uploaded</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
  {uploadedIcons.filter(ic => ic.label.toLowerCase().includes(iconSearch.toLowerCase()) || ic.type.toLowerCase().includes(iconSearch.toLowerCase())).map(ic => (
        <div key={ic.type} draggable onDragStart={e => e.dataTransfer.setData('iconType', ic.type)} onContextMenu={e => handleIconContextMenu(e, ic.label)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'grab', border: '1px solid #444', borderRadius: 8, padding: '6px', background: '#2c313a', width: 54, height: 54, justifyContent: 'center' }} title={`Drag to add ${ic.label}`}>
                  {/* render SVG using <img> with data URL */}
                  <img src={ic.icon} alt={ic.label} style={{ width: 28, height: 28, objectFit: 'contain', display: 'block' }} />
                  <span style={{ fontSize: 11, color: '#ffa726', fontWeight: 500 }}>{ic.label}</span>
                </div>
      ))}
            </div>
          </div>
        )}

  {iconCategories.map(category => (
      <div key={category.name} style={{ marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15, margin: '8px 0 6px 0', color: '#ffa726', letterSpacing: 1 }}>{category.name}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {category.icons.filter(icon => icon.label.toLowerCase().includes(iconSearch.toLowerCase()) || icon.type.toLowerCase().includes(iconSearch.toLowerCase())).map(icon => (
                <div
              key={icon.type}
              draggable
              onDragStart={e => e.dataTransfer.setData('iconType', icon.type)}
              onContextMenu={e => handleIconContextMenu(e, icon.label)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'grab',
                    border: '1px solid #444', borderRadius: 8, padding: '6px', background: '#2c313a',
                    fontSize: 28, width: 54, height: 72, justifyContent: 'flex-start', color: '#fff', boxSizing: 'border-box',
              }}
              title={`Drag to add a ${icon.label}`}
            >
                  {/* Render SVG path icons as images, uploaded SVGs as img data URL, otherwise emoji text */}
                  {typeof icon.icon === 'string' && icon.icon.match(/\.svg$/i) ? (
                    <img src={`/icons/${icon.icon}`} alt={icon.label} style={{ width: 28, height: 28, objectFit: 'contain', display: 'block' }} />
                  ) : typeof icon.icon === 'string' && icon.icon.startsWith('data:image/svg+xml') ? (
                    <img src={icon.icon} alt={icon.label} style={{ width: 28, height: 28, objectFit: 'contain', display: 'block' }} />
                  ) : (
                    <span style={{ lineHeight: '28px' }}>{icon.icon}</span>
                  )}
              <div style={{ fontSize: 11, color: '#ffa726', fontWeight: 500, textAlign: 'center', width: 52, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: '12px', wordBreak: 'break-word', paddingTop: 2 }}>{icon.label}</div>
            </div>
          ))}
        </div>
      </div>
    ))}
        {uploadedIcons.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 15, margin: '8px 0 6px 0', color: '#ffa726', letterSpacing: 1 }}>Uploaded</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {uploadedIcons.map(ic => (
                <div key={ic.type} draggable onDragStart={e => e.dataTransfer.setData('iconType', ic.type)} onContextMenu={e => handleIconContextMenu(e, ic.label)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'grab', border: '1px solid #444', borderRadius: 8, padding: '6px', background: '#2c313a', width: 54, height: 54, justifyContent: 'center' }} title={`Drag to add ${ic.label}`}>
                  {/* render SVG using <img> with data URL scaled to match emoji icons */}
                  <img src={ic.icon} alt={ic.label} style={{ width: 28, height: 28, objectFit: 'contain', display: 'block' }} />
                  <span style={{ fontSize: 11, color: '#ffa726', fontWeight: 500 }}>{ic.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
</div>
</aside>

      {/* Column 2: Prompt Editor */}
      <section className="prompt-editor">
        <h4 style={{ fontSize: 16, margin: '0 0 10px 0', fontWeight: 600 }}>Diagram Prompt</h4>
        {/* Cluster creation UI */}
        <div className="control-row">
          <label>Add Cluster:</label>
          <input
            className="cluster-input"
            type="text"
            value={newClusterLabel}
            onChange={e => setNewClusterLabel(e.target.value)}
            placeholder="Cluster name"
            style={{ width: 140 }}
          />
          <button className="btn-neutral" onClick={() => {
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
          <div className="import-excel-group">
            <label>Import Excel:</label>
            <input id="excel-file-input" className="hidden-file-input" type="file" accept=".xlsx,.xls" onChange={(e) => {
              const inputEl = e.currentTarget as HTMLInputElement;
              const f = inputEl.files && inputEl.files[0];
              if (!f) return;
              const reader = new FileReader();
              reader.onload = async (ev) => {
                try {
                  const data = ev.target?.result;
                  const wb = XLSX.read(data, { type: 'array' });
                  // First sheet: nodes
                  const sn = wb.SheetNames[0];
                  const nodesRaw = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' }) as Record<string, unknown>[];
                  // Second sheet: edges (optional)
                  const edgesRaw = (wb.SheetNames[1]) ? XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[1]], { defval: '' }) as Record<string, unknown>[] : [];
                  // Build prompt from sheets
                  const lines: string[] = [];
                  // Group nodes by cluster and parent cluster
                  // Expected columns: Node, Name, Cluster, ParentCluster
                  type NodeRow = { nodeLabel: string; nodeName: string };
                  const byCluster = new Map<string, NodeRow[]>();
                  const clustersSet = new Map<string, string>();
                  for (const r of nodesRaw) {
                    const nodeLabel = String(r['Node'] || r['node'] || r['Label'] || r['label'] || '').trim();
                    const nodeName = String(r['Name'] || r['name'] || '').trim();
                    const cluster = String(r['Cluster'] || r['cluster'] || '').trim() || 'default';
                    const parent = String(r['Parent cluster'] || r['ParentCluster'] || r['parent'] || '').trim();
                    clustersSet.set(cluster, parent);
                    if (!byCluster.has(cluster)) byCluster.set(cluster, []);
                    byCluster.get(cluster)!.push({ nodeLabel, nodeName });
                  }
                  // Build a parent->children map and emit clusters recursively so
                  // the sheet's explicit Parent cluster relationships are preserved.
                  const childrenMap = new Map<string, string[]>();
                  const allClusters = Array.from(clustersSet.keys());
                  // initialize children arrays
                  for (const c of allClusters) childrenMap.set(c, []);
                  // populate children map
                  for (const c of allClusters) {
                    const p = (clustersSet.get(c) || '').trim();
                    if (p && allClusters.includes(p)) {
                      childrenMap.get(p)!.push(c);
                    }
                  }

                  // roots are clusters without a parent or whose parent is missing/empty
                  const roots = allClusters.filter(c => {
                    const p = (clustersSet.get(c) || '').trim();
                    return !p || !allClusters.includes(p);
                  });

                  const indent = (d: number) => '  '.repeat(d);
                  const emitCluster = (name: string, depth: number) => {
                    lines.push(`${indent(depth)}Cluster: ${name}`);
                    const arr = byCluster.get(name) || [];
                    for (const n of arr) {
                      let l = `${indent(depth + 1)}Node: ${n.nodeLabel}`;
                      if (n.nodeName) l += ` [name=${n.nodeName}]`;
                      lines.push(l);
                    }
                    const kids = childrenMap.get(name) || [];
                    for (const k of kids) emitCluster(k, depth + 1);
                  };

                  // Emit all root clusters in original order, recursively emitting children
                  for (const r of roots) emitCluster(r, 0);
                  // Edges sheet expected columns: Source, Destination, Type
                  for (const er of edgesRaw) {
                    const src = String(er['Source'] || er['source'] || er['From'] || er['from'] || '').trim();
                    const dst = String(er['Destination'] || er['destination'] || er['To'] || er['to'] || '').trim();
                    const typ = String(er['Type'] || er['type'] || er['Arrow'] || er['arrow'] || '').trim();
                    const edgeLabel = String(er['Label'] || er['label'] || '').trim();
                    if (src && dst) {
                      let ln = `${src} -> ${dst}`;
                      const attrs: string[] = [];
                      if (typ) attrs.push(`arrow=${typ}`);
                      if (edgeLabel) {
                        // escape single quotes inside the label
                        const esc = edgeLabel.replace(/'/g, "\\'");
                        attrs.push(`label='${esc}'`);
                      }
                      if (attrs.length) ln += ` [${attrs.join(', ')}]`;
                      lines.push(ln);
                    }
                  }
          const promptFromExcel = lines.join('\n');
          // Clear prompt first, then set generated prompt so editor updates
          setPrompt('');
          setPrompt(promptFromExcel);
          // Trigger the same Update Diagram action automatically and wait for it
          await handleParsePrompt(promptFromExcel);
          // Reset input so same file can be uploaded again
          inputEl.value = '';
                } catch (err) {
                  console.error('Failed to parse Excel', err);
                }
        };
              reader.readAsArrayBuffer(f);
            }} />
            <label htmlFor="excel-file-input" className="btn-help-small" style={{ cursor: 'pointer' }}>Choose File</label>
            {/* Template download button: same visual as Choose File and will download the template in repo root */}
            <a href="/VizCode-template.xlsx" download className="btn-help-small" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>Template</a>
          </div>
        </div>
        <div className="control-row">
          <label>Arrow Type:</label>
          <select value={arrowType} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleArrowSelectChange(e.target.value)} style={{ fontSize: 14 }}>
            <option value="single">Single</option>
            <option value="double">Double</option>
            <option value="dotted">Dotted</option>
            <option value="double-dotted">Double Dotted</option>
          </select>
          <span style={{ fontSize: 13, color: '#888', marginLeft: 12 }}>(Select before creating a new arrow)</span>
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
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center' }}>
          <button onClick={() => handleParsePrompt()} disabled={loading} className="btn-primary">Update Diagram</button>
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
              <button onClick={() => fitToContent()} style={{ fontSize: 12, padding: '4px 8px' }}>Fit</button>
            </div>
        </div>
          <div className="svg-wrapper"
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
            // make the preview area taller so users see more without zooming; 80vh gives plenty of vertical space
            style={{ width: '100%', overflowX: 'auto', overflowY: 'auto', border: '1px solid #2f363c', borderRadius: 12, height: '80vh' }}
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
            const route = computeRouteForNodes(from, to);
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
              <g key={edge.id} onClick={(ev: React.MouseEvent) => {
                  // require Ctrl+Shift+Click to delete an edge to avoid accidental deletions
                  const mods = { ctrl: ev.ctrlKey || ev.metaKey, shift: ev.shiftKey };
                  if (!(mods.ctrl && mods.shift)) return;
                  if (window.confirm('Delete this arrow? (Ctrl+Shift+Click confirmed)')) {
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
                      // ensure drawn polyline starts/ends at the computed icon-edge offsets so it doesn't overlap icons
                      const adjusted = route.points.slice();
                      if (adjusted.length > 0) {
                        adjusted[0] = { x: fromX, y: fromY };
                        adjusted[adjusted.length - 1] = { x: toX, y: toY };
                      }
                      const pointsStr = adjusted.map(p => `${p.x},${p.y}`).join(' ');
                      // polyline supports markers; render with start/end markers
                      return (
                        <g>
                          <polyline points={pointsStr} fill="none" stroke="#607d8b" strokeWidth={2} strokeDasharray={strokeDasharray} markerStart={markerStart} markerEnd={markerEnd} />
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
              const val = String(iconObj.icon);
              // data URL (uploaded SVG)
              if (val.startsWith('data:image/svg+xml')) {
                iconSvg = (
                  <image x={node.x - 18} y={node.y - 18} width={36} height={36} href={val} preserveAspectRatio="xMidYMid meet" />
                );
              } else if (val.match(/\.svg$/i)) {
                // vendor svg path (relative) - ensure correct src path
                const src = val.startsWith('/') ? val : `/icons/${val}`;
                iconSvg = (
                  <image x={node.x - 18} y={node.y - 18} width={36} height={36} href={src} preserveAspectRatio="xMidYMid meet" />
                );
              } else {
                // fallback to emoji/text
                iconSvg = (
                  <foreignObject x={node.x - 18} y={node.y - 18} width={36} height={36}>
                    <div style={{ pointerEvents: 'none', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', lineHeight: '36px', fontFamily: '"Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", "Android Emoji", sans-serif' }}>{iconObj.icon}</div>
                  </foreignObject>
                );
              }
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
            const route = computeRouteForNodes(fromNode, { id: 'tmp', label: '', x: pt.x, y: pt.y } as Node);
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
            // ensure preview starts/ends at icon-edge offsets
            const adj = route.points.slice();
            if (adj.length > 0) {
              adj[0] = { x: startX, y: startY };
              adj[adj.length - 1] = { x: endX, y: endY };
            }
            const pts = adj.map(p => `${p.x},${p.y}`).join(' ');
            return (
              <g pointerEvents="none" opacity={0.7}>
                <polyline points={pts} fill="none" stroke="#607d8b" strokeWidth={2} strokeDasharray={strokeDasharray} markerStart={markerStart} markerEnd={markerEnd} />
              </g>
            );
          })()}
          {/* (popup removed — edges are created immediately using the global Arrow Type selector) */}
        </svg>
          </div>
      </main>
      </div>
      {/* Toast for copy feedback */}
      {copyMessage && (
        <div style={{ position: 'fixed', right: 20, bottom: 76, background: 'rgba(15,23,42,0.96)', color: '#fff', padding: '8px 12px', borderRadius: 8, boxShadow: '0 6px 20px rgba(2,6,23,0.6)', zIndex: 9999, fontSize: 13 }}>
          {copyMessage}
        </div>
      )}

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