const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const sourceIndex = path.join(root, 'index.source.html');
const productionIndex = path.join(root, 'index.html');
const previousProductionIndex = fs.readFileSync(productionIndex);

const sourceHtml = fs.readFileSync(sourceIndex, 'utf8').replace(/\r\n?/g, '\n');
fs.writeFileSync(productionIndex, sourceHtml);
const result = spawnSync(
  process.execPath,
  [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'],
  { cwd: root, stdio: 'inherit' }
);

if (result.error || result.status !== 0) {
  fs.writeFileSync(productionIndex, previousProductionIndex);
  if (result.error) {
    console.error(result.error);
  }
  process.exit(result.status || 1);
}

require('./copy-production-root.cjs');
