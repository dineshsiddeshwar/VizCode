const XLSX = require('xlsx');

const nodes = [
  { Node: 'Chrome', Name: 'chrome', Cluster: 'Browsers', 'Parent cluster': 'Internet' },
  { Node: 'Firefox', Name: 'firefox', Cluster: 'Browsers', 'Parent cluster': 'Internet' },
  { Node: 'LoadBalancer', Name: 'lb', Cluster: 'Internet', 'Parent cluster': '' },
  { Node: 'API', Name: 'api', Cluster: 'Services', 'Parent cluster': '' },
  { Node: 'UsersDB', Name: 'usersdb', Cluster: 'Databases', 'Parent cluster': 'Services' },
  { Node: 'OrdersDB', Name: 'ordersdb', Cluster: 'Databases', 'Parent cluster': 'Services' },
  { Node: 'Redis1', Name: 'redis1', Cluster: 'CacheLayer', 'Parent cluster': 'Services' },
  { Node: 'Redis2', Name: 'redis2', Cluster: 'CacheLayer', 'Parent cluster': 'Services' },
  { Node: 'Prometheus', Name: 'prom', Cluster: 'Monitoring', 'Parent cluster': '' },
  { Node: 'Grafana', Name: 'graf', Cluster: 'Monitoring', 'Parent cluster': '' },
];

const edges = [
  { Source: 'chrome', Destination: 'api', Type: 'solid', Label: 'HTTP' },
  { Source: 'firefox', Destination: 'api', Type: 'solid', Label: '' },
  { Source: 'lb', Destination: 'api', Type: 'double', Label: 'round-robin' },
  { Source: 'api', Destination: 'usersdb', Type: 'dashed', Label: '' },
  { Source: 'api', Destination: 'ordersdb', Type: 'dashed', Label: '' },
  { Source: 'usersdb', Destination: 'ordersdb', Type: 'dotted', Label: 'replicate' },
  { Source: 'redis1', Destination: 'api', Type: 'solid', Label: '' },
  { Source: 'redis2', Destination: 'api', Type: 'solid', Label: '' },
  { Source: 'prom', Destination: 'graf', Type: 'solid', Label: 'scrape' },
  { Source: 'prom', Destination: 'api', Type: 'dashed', Label: '' },
];

const wb = XLSX.utils.book_new();
const ws1 = XLSX.utils.json_to_sheet(nodes);
const ws2 = XLSX.utils.json_to_sheet(edges);
XLSX.utils.book_append_sheet(wb, ws1, 'Nodes');
XLSX.utils.book_append_sheet(wb, ws2, 'Edges');

const outPath = 'example-diagram.xlsx';
XLSX.writeFile(wb, outPath);
console.log('Wrote', outPath);
