// npm run check: revisa que todos los .js tengan sintaxis válida (app y página del panda).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const files = [
  ...fs.readdirSync(root).filter((f) => f.endsWith('.js')).map((f) => path.join(root, f)),
  ...fs.readdirSync(path.join(root, 'test')).filter((f) => f.endsWith('.js')).map((f) => path.join(root, 'test', f)),
  path.join(root, '..', 'personaje', 'desktop.js'),
  path.join(root, '..', 'personaje', 'rig.js'),
  path.join(root, '..', 'plugins-ejemplo', 'chiste.js'),
];

let failed = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (err) {
    failed++;
    console.error(`✖ ${path.relative(path.join(root, '..'), f)}\n${err.stderr}`);
  }
}
// rig.json debe ser JSON válido
try { JSON.parse(fs.readFileSync(path.join(root, '..', 'personaje', 'rig.json'), 'utf8')); } catch (err) { failed++; console.error('✖ personaje/rig.json', err.message); }

if (failed) process.exit(1);
console.log(`✔ ${files.length + 1} archivos sin errores de sintaxis`);
