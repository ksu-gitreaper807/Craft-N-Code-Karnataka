import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { programSignature } from '../src/board.js';

// Immutable manifest for the same GCC 14.2 Bookworm image used by the application.
const IMAGE = 'gcc:14.2.0-bookworm@sha256:b99b86a28812b1e6453a231a947dc43d76fe192788a12f344a9b568bf9f5d24c';
const PUBLIC = new Set(['stack.h', 'linked_list.h', 'queue.h', 'search.h']);
const TRUSTED = new Set([...PUBLIC, 'board_contract.h']);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function includes(source) {
  // Match the runner's continuation/comment handling; strings are kept intact.
  const normalized = source.replace(/\\\r?\n/g, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (value) => value.startsWith('/*') || value.startsWith('//') ? value.replace(/[^\n]/g, ' ') : value);
  return [...normalized.matchAll(/^\s*#\s*include\s*[<"]([a-z0-9_.]+)[>"]/gm)].map((match) => match[1]);
}

const readAsset = (name) => readFile(new URL(`../runner/${name}`, import.meta.url));

export async function snapshotBundle(scene, program) {
  const files = new Map();
  async function vendor(name) {
    if (files.has(`lib/${name}`)) return;
    const content = await readAsset(`lib/${name}`);
    files.set(`lib/${name}`, content);
    for (const dependency of includes(content.toString())) {
      if (TRUSTED.has(dependency)) await vendor(dependency);
    }
  }
  if (program.language !== 'python') for (const header of includes(program.source)) if (PUBLIC.has(header)) await vendor(header);
  files.set('runner.py', await readAsset('runner.py'));
  files.set('replay.py', await readFile(new URL('./snapshot-replay.py', import.meta.url)));
  files.set('build.sh', '#!/usr/bin/env bash\nset -euo pipefail\ncd -- "$(dirname -- "$0")"\nexec python3 -I replay.py "$@"\n');
  const copies = [...files.keys()].filter((name) => name.startsWith('lib/')).sort()
    .map((name) => `COPY --chmod=644 ${name} /opt/${name}`).join('\n');
  files.set('Dockerfile', `FROM ${IMAGE}\nCOPY --chmod=644 runner.py /opt/runner.py\n${copies}\nRUN chmod -R a+rX /opt\nUSER 65534:65534\nENTRYPOINT ["python3", "-I", "-B", "/opt/runner.py"]\n`);
  files.set('.dockerignore', '**\n!Dockerfile\n!runner.py\n!lib/\n!lib/*.h\n');
  if (scene.verifier.ocr) files.set('ocr.json', JSON.stringify(scene.verifier.ocr) + '\n');
  const execution = scene.verifier.execution;
  const result = execution ? { ...execution.result, source: program.source, stdin: program.stdin,
    signature: programSignature(program, scene.verifier.frameId), level: execution.level, kind: execution.kind } : scene.verifier.result;
  if (result?.signature === programSignature(program, scene.verifier.frameId) &&
      result.source === program.source && result.stdin === program.stdin) {
    // Browser-supplied historical evidence, never accepted as a new verification.
    files.set('result.json', JSON.stringify({ provenance: 'browser-reported', result }) + '\n');
  }
  return { files, manifest: (allFiles) => JSON.stringify({ version: 1, compilerImage: IMAGE, language: program.language ?? 'c', sourceFile: program.language === 'python' ? 'board.py' : 'board.cpp',
    compiler: program.language === 'python' ? 'python3' : 'g++', standard: program.language === 'python' ? null : 'c++17',
    files: Object.fromEntries([...allFiles].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => [name, hash(bytes)])),
  }, null, 2) + '\n' };
}
