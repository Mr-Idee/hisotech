const fs = require('node:fs');
const path = require('node:path');

const distDirectory = path.resolve(__dirname, '..', 'dist');
const documentRoot = path.resolve(__dirname, '..');

for (const entry of fs.readdirSync(distDirectory, { withFileTypes: true })) {
  if (entry.name === 'index.source.html') {
    continue;
  }
  const source = path.join(distDirectory, entry.name);
  const target = path.join(documentRoot, entry.name);
  if (entry.isDirectory()) {
    fs.cpSync(source, target, { recursive: true, force: true });
  } else if (entry.name.endsWith('.html')) {
    const html = fs.readFileSync(source, 'utf8').replace(/\r\n?/g, '\n');
    fs.writeFileSync(source, html);
    fs.writeFileSync(target, html);
  } else {
    fs.copyFileSync(source, target);
  }
}
