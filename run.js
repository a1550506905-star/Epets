// Launcher that clears ELECTRON_RUN_AS_NODE before spawning Electron
const { spawn } = require('child_process');
const path = require('path');

const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;

const electronPath = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainPath = path.join(__dirname, 'main.js');

const child = spawn(electronPath, [mainPath], {
  env: env,
  stdio: 'inherit',
  windowsHide: false
});

child.on('close', (code) => {
  process.exit(code);
});

// Forward SIGINT
process.on('SIGINT', () => {
  child.kill('SIGINT');
});
