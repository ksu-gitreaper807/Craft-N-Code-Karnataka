import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const IMAGE = 'whiteboard-runner:local';

function command(args, { input, timeout = 4000, limit = 100_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let size = 0;
    let failure;
    const timer = setTimeout(() => {
      failure = new Error('The isolated runner exceeded its time limit.');
      child.kill('SIGKILL');
    }, timeout);
    function collect(kind, chunk) {
      size += chunk.length;
      if (size > limit) {
        failure = new Error('The isolated runner exceeded its response limit.');
        child.kill('SIGKILL');
        return;
      }
      if (kind === 'stdout') stdout += chunk;
      else stderr += chunk;
    }
    child.stdout.on('data', (data) => collect('stdout', data));
    child.stderr.on('data', (data) => collect('stderr', data));
    child.stdin.on('error', () => {}); // Early Docker failure can close stdin first.
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

export async function sandboxHealth() {
  try {
    const response = await command(['image', 'inspect', IMAGE, '--format', '{{.Id}}']);
    if (response.code === 0) return { available: true, engine: 'docker', image: IMAGE };
    return { available: false, engine: 'docker', message: 'Start Docker and run npm run runner:build.' };
  } catch {
    return { available: false, engine: 'docker', message: 'Docker is unavailable. Install/start Docker, then run npm run runner:build.' };
  }
}

export async function runSandbox(payload) {
  const name = `board-${randomUUID()}`;
  try {
    const response = await command([
      'run', '--rm', '--interactive', '--name', name,
      '--network', 'none', '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--pids-limit', '64',
      '--memory', '512m', '--memory-swap', '512m', '--cpus', '1',
      '--ulimit', 'core=0:0', '--ulimit', 'nofile=64:64',
      '--ulimit', 'fsize=16777216:16777216',
      '--tmpfs', '/tmp:rw,exec,nosuid,size=64m,mode=1777',
      '--user', '65534:65534', IMAGE,
    ], { input: JSON.stringify(payload), timeout: 22_000 });
    if (response.code !== 0) {
      throw new Error('The Docker runner stopped unexpectedly. Check Docker resources and rebuild the runner image.');
    }
    const result = JSON.parse(response.stdout);
    if (!['success', 'compile_error', 'runtime_error', 'timeout', 'output_limit', 'invalid_source'].includes(result.status)) {
      throw new Error('The isolated runner returned an invalid result.');
    }
    return result;
  } finally {
    // Also removes a container whose attached client was killed by the outer timeout.
    await command(['rm', '--force', name]).catch(() => {});
  }
}
