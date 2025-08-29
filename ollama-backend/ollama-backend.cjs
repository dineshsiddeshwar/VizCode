// This is the entry point for the Node.js backend that will handle communication with the local Ollama LLM.
// It will expose endpoints for semantic parsing, icon suggestion, and layout optimization.

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());

let lastPrompt = '';

// Placeholder: Replace with actual Ollama LLM integration
app.post('/api/ollama/parse', async (req, res) => {
  const { prompt } = req.body;
  lastPrompt = prompt;

  if (prompt && typeof prompt === 'string') {
    // Parse clusters and nodes with correct assignment, including multi-level nested clusters
    const lines = prompt.split(/\r?\n/);
    let clusterStack = [];
    let clusterOrder = [];
    let clusterNodes = {};
    let clusters = [];
    for (let line of lines) {
      const indent = line.match(/^([ \t]*)/)[1].length;
      const clusterMatch = line.match(/^[ \t]*Cluster: (.+)$/);
      if (clusterMatch) {
        const clusterLabel = clusterMatch[1].trim();
        const clusterId = clusterLabel.toLowerCase().replace(/\s+/g, '-');
        // Pop stack until the top has a lower indent
        while (clusterStack.length && clusterStack[clusterStack.length - 1].indent >= indent) {
          clusterStack.pop();
        }
        let parentId = clusterStack.length ? clusterStack[clusterStack.length - 1].id : null;
        clusters.push({ id: clusterId, label: clusterLabel, parentId });
        clusterOrder.push(clusterId);
        clusterNodes[clusterId] = [];
        clusterStack.push({ id: clusterId, indent });
        continue;
      }
      const nodeMatch = line.match(/^[ \t]*Node: (.+)$/);
      if (nodeMatch && clusterStack.length) {
        const nodeText = nodeMatch[1].trim();
        const nameMatch = nodeText.match(/\[name=([^\]]+)\]/);
        let label = nodeText;
        let name = '';
        if (nameMatch) {
          label = nodeText.replace(nameMatch[0], '').trim();
          name = nameMatch[1].trim();
        }
        const nodeId = name ? name.toLowerCase().replace(/\s+/g, '-') : label.toLowerCase().replace(/\s+/g, '-');
        let color = '#e3f2fd';
        let type = label.toLowerCase().replace(/\s+/g, '-');
        if (/database|db/i.test(label)) { color = '#e8f5e9'; type = 'database'; }
        else if (/api/i.test(label)) { color = '#c8e6c9'; type = 'api'; }
        // Always assign node to the current cluster at the top of the stack
        const currentCluster = clusterStack[clusterStack.length - 1].id;
        clusterNodes[currentCluster].push({
          id: nodeId,
          label: label,
          name: name,
          color: color,
          type: type,
          clusterId: currentCluster
        });
      }
    }
    // Improved auto-layout for multi-level nested clusters
    let nodes = [];
    let clusterPositions = {};
    // Recursive layout function
    function layoutCluster(clusterId, x, y, depth) {
      clusterPositions[clusterId] = { x, y };
      const childClusters = clusters.filter(c => c.parentId === clusterId);
      let childY = y + 80;
      childClusters.forEach((child, i) => {
        layoutCluster(child.id, x + 80, childY + i * 160, depth + 1);
      });
    }
    // Layout top-level clusters
    clusters.filter(c => !c.parentId).forEach((cluster, i) => {
      layoutCluster(cluster.id, 120 + i * 350, 120, 0);
    });
    // Layout nodes in clusters
    clusters.forEach((cluster, i) => {
      const pos = clusterPositions[cluster.id];
      const nodesInCluster = clusterNodes[cluster.id] || [];
      nodesInCluster.forEach((node, j) => {
        nodes.push({
          ...node,
          x: pos.x + j * 120,
          y: pos.y + 80,
          clusterId: cluster.id
        });
      });
    });
    // Parse edges
    const edgeRegex = /^\s*([\w\s]+)->([\w\s]+)\s*(?:\[arrow=(\w+),?\s*label='([^']*)'\])?/gm;
    let edges = [];
    let match;
    while ((match = edgeRegex.exec(prompt)) !== null) {
      function findNodeId(ref) {
        ref = ref.trim();
        let node = nodes.find(n => n.name && n.name === ref);
        if (node) return node.id;
        node = nodes.find(n => n.label === ref);
        if (node) return node.id;
        return ref.toLowerCase().replace(/\s+/g, '-');
      }
      const fromId = findNodeId(match[1]);
      const toId = findNodeId(match[2]);
      edges.push({
        id: `e-${fromId}-${toId}`,
        from: fromId,
        to: toId,
        label: match[4] || '',
        type: match[3] || 'solid'
      });
    }
    // Return clusters, nodes, edges
    return res.json({ nodes, edges, clusters, icons: [], message: 'Multi-level nested clustering supported.' });
  }

  res.json({
    nodes: [],
    edges: [],
    clusters: [],
    icons: [],
    message: 'Mocked Ollama LLM response.'
  });
});

app.get('/api/ollama/last-prompt', (req, res) => {
  res.json({ prompt: lastPrompt });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Ollama backend listening on port ${PORT}`);
});
