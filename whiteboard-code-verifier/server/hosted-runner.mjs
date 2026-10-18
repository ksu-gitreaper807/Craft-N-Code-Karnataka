import { readFile } from 'node:fs/promises';
import { validLanguage } from '../src/languages.js';

const HEADER_URLS = {
  'stack.h': new URL('../runner/lib/stack.h', import.meta.url),
  'linked_list.h': new URL('../runner/lib/linked_list.h', import.meta.url),
  'queue.h': new URL('../runner/lib/queue.h', import.meta.url),
  'search.h': new URL('../runner/lib/search.h', import.meta.url),
  // Curated headers include this shared contract implementation.
  'board_contract.h': new URL('../runner/lib/board_contract.h', import.meta.url),
};
const MAX_OUTPUT = 16_384;

export function hostedRunnerConfiguration(env = process.env) {
  const url = env.WANDBOX_API_URL?.trim();
  if (!url) return { available: false, engine: 'wandbox', message: 'Set WANDBOX_API_URL on the API host to enable hosted code execution.' };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
    return { available: true, engine: 'wandbox' };
  } catch {
    return { available: false, engine: 'wandbox', message: 'WANDBOX_API_URL must be an HTTPS API base URL.' };
  }
}

const compilerFor = (language, env) => language === 'python' ? env.WANDBOX_PYTHON_COMPILER || 'cpython-3.13.8' : env.WANDBOX_CPP_COMPILER || 'gcc-head';

export async function hostedRunnerHealth({ env = process.env, fetchImpl = fetch, language = 'c' } = {}) {
  const config = hostedRunnerConfiguration(env);
  if (!config.available) return config;
  try {
    const response = await fetchImpl(`${env.WANDBOX_API_URL.replace(/\/$/, '')}/list.json`, { signal: AbortSignal.timeout(5_000) });
    const compilers = response.ok ? await response.json() : null;
    if (!validLanguage(language) || !Array.isArray(compilers) || !compilers.some((compiler) => compiler.name === compilerFor(language, env))) throw new Error();
    return { ...config, language };
  } catch {
    return { available: false, engine: 'wandbox', message: `The hosted ${language === 'python' ? 'Python runtime' : 'C++ compiler'} is unavailable. Check WANDBOX_API_URL and its compiler name.` };
  }
}

export function validateHostedProgram(body) {
  if (!validLanguage(body?.language)) return 'Choose C++ or Python.';
  if (!body || typeof body.source !== 'string' || !body.source.trim()) return 'Write some code before running.';
  if (Buffer.byteLength(body.source) > 32_768 || body.source.includes('\0')) return 'Source must be at most 32 KiB without NUL characters.';
  if (body.stdin !== undefined && (typeof body.stdin !== 'string' || Buffer.byteLength(body.stdin) > 8192 || body.stdin.includes('\0'))) {
    return 'Input must be text of at most 8 KiB without NUL characters.';
  }
  return null;
}

function diagnosticLines(output, language = 'c') {
  if (language === 'python') {
    const message = output.trim().split('\n').at(-1) || 'Python error at this line.';
    const seen = new Set();
    return [...output.matchAll(/File "[^"\n]*(?:board|prog)\.py", line (\d+)/g)]
      .flatMap((match) => {
        const line = Number(match[1]);
        if (seen.has(line)) return [];
        seen.add(line);
        return [{ line, column: 1, severity: 'error', kind: /(?:SyntaxError|IndentationError|TabError):/.test(output) ? 'compiler' : 'runtime', message }];
      });
  }
  return [...output.matchAll(/(?:board|prog)\.c(?:pp|c)?:(\d+):(\d+):\s*(fatal error|error|warning):\s*([^\n]+)/g)]
    .map((match) => ({ line: Number(match[1]), column: Number(match[2]),
      severity: match[3] === 'warning' ? 'warning' : 'error', message: match[4], kind: 'compiler' }));
}

export async function runHostedProgram(body, { env = process.env, fetchImpl = fetch,
  readHeader = (file) => readFile(HEADER_URLS[file], 'utf8') } = {}) {
  const invalid = validateHostedProgram(body);
  if (invalid) throw Object.assign(new Error(invalid), { status: 400 });
  const config = hostedRunnerConfiguration(env);
  if (!config.available) throw Object.assign(new Error(config.message), { status: 503 });
  const codes = [];
  const language = body.language ?? 'c';
  if (language === 'c') for (const file of Object.keys(HEADER_URLS)) codes.push({ file, code: await readHeader(file) });
  const started = performance.now();
  let response;
  try {
    response = await fetchImpl(`${env.WANDBOX_API_URL.replace(/\/$/, '')}/compile.json`, {
      method: 'POST', signal: AbortSignal.timeout(25_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compiler: compilerFor(language, env),
        code: body.source, codes, stdin: body.stdin ?? '', save: false,
        ...(language === 'c' ? { 'compiler-option-raw': '-I. -std=c++17' } : {}) }),
    });
  } catch {
    throw Object.assign(new Error('Could not reach the hosted C++ compiler.'), { status: 502 });
  }
  if (!response.ok) throw Object.assign(new Error(response.status === 429 ?
    'The hosted C++ compiler is rate limited. Try again shortly.' : `Hosted C++ compiler returned HTTP ${response.status}.`),
  { status: response.status === 429 ? 429 : 502 });
  let data;
  try {
    const raw = await response.text();
    if (raw.length > 100_000) throw new Error();
    data = JSON.parse(raw);
  } catch { throw Object.assign(new Error('Hosted C++ compiler returned an invalid response.'), { status: 502 }); }
  if (!data || typeof data.status !== 'string' || typeof data.program_output !== 'string' ||
      typeof data.compiler_error !== 'string' || typeof data.program_error !== 'string') {
    throw Object.assign(new Error('Hosted C++ compiler returned an invalid result.'), { status: 502 });
  }
  const rawCompilerOutput = `${data.compiler_output ?? ''}${data.compiler_error}`;
  const rawStdout = data.program_output;
  const rawStderr = data.program_error;
  const compilerOutput = rawCompilerOutput.slice(0, MAX_OUTPUT);
  const stdout = rawStdout.slice(0, MAX_OUTPUT);
  const stderr = rawStderr.slice(0, MAX_OUTPUT);
  const exitCode = /^\d+$/.test(data.status) ? Number(data.status) : null;
  const status = rawCompilerOutput.length + rawStdout.length + rawStderr.length > MAX_OUTPUT ? 'output_limit' :
    /(?:SIGKILL|SIGXCPU)/.test(data.signal ?? '') ? 'timeout' :
    data.signal ? 'runtime_error' : exitCode === 0 ? 'success' :
      language === 'python' && /(?:SyntaxError|IndentationError|TabError):/.test(rawCompilerOutput + rawStderr) ? 'compile_error' :
      /(?:fatal )?error:/.test(rawCompilerOutput) && !rawStdout && !rawStderr ? 'compile_error' : 'runtime_error';
  return { status, stdout, stderr, compilerOutput, diagnostics: diagnosticLines(language === 'python' ? compilerOutput + '\n' + stderr : compilerOutput, language),
    notes: [], exitCode: status === 'compile_error' ? null : exitCode,
    durationMs: Math.round(performance.now() - started), engine: 'wandbox', language };
}
