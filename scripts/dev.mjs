import { spawn } from 'node:child_process';

const children = [];
function start(label, args) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
  children.push(child);
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`${label} exited with code ${code}`);
      stop(code);
    }
  });
}
function stop(code = 0) {
  for (const child of children) if (!child.killed) child.kill('SIGTERM');
  process.exit(code);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

start('Sonora AI API', ['server/index.mjs']);
start('Vite', ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0', '--port', '3000']);
