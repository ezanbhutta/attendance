// Build the dashboard (React/Vite) and copy its output into desktop/renderer/,
// which the Electron app loads as its window. Run before packaging.
import { execSync } from 'node:child_process';
import { cpSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = path.resolve(here, '..', '..', 'dashboard');
const dest = path.resolve(here, '..', 'renderer');

console.log('• Building dashboard renderer…');
if (!existsSync(path.join(dashboard, 'node_modules'))) {
  execSync('npm install', { cwd: dashboard, stdio: 'inherit' });
}
execSync('npm run build', { cwd: dashboard, stdio: 'inherit' });

rmSync(dest, { recursive: true, force: true });
cpSync(path.join(dashboard, 'dist'), dest, { recursive: true });
console.log(`• Renderer bundled into ${path.relative(process.cwd(), dest)}/`);
