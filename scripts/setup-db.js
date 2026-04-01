import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

console.log('[v0] Starting database setup...');

async function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with code ${code}`));
      } else {
        resolve();
      }
    });

    child.on('error', reject);
  });
}

async function setup() {
  try {
    console.log('[v0] Generating Prisma client...');
    await runCommand('npx', ['prisma', 'generate']);

    console.log('[v0] Creating database and running migrations...');
    await runCommand('npx', ['prisma', 'db', 'push', '--skip-generate']);

    console.log('[v0] Database setup complete!');
  } catch (error) {
    console.error('[v0] Setup failed:', error.message);
    process.exit(1);
  }
}

setup();
