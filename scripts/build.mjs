// Builds what the package ships: the CLI, and the simulator it serves.
//
//   dist/index.js      the CLI, bundled by tsup
//   dist/simulator/    the simulator, built by Next as static files
//
// The simulator is a project of its own in simulator/, with its own
// dependencies, none of which the published package needs: only its built
// files go into dist.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const simulator = join(root, 'simulator');
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: 'inherit' });

rmSync(join(root, 'dist'), { recursive: true, force: true });
run('npx', ['tsup']);

// A fresh clone has not installed the simulator's dependencies yet.
if (!existsSync(join(simulator, 'node_modules'))) run('npm', ['ci'], simulator);
run('npm', ['run', 'build'], simulator);
cpSync(join(simulator, 'out'), join(root, 'dist', 'simulator'), { recursive: true });
