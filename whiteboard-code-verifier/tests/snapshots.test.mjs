import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, rename, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSnapshotStore } from '../server/snapshots.mjs';
import { extractProgram, programSignature } from '../src/board.js';
import { inkFingerprint } from '../src/handwriting.js';

const execute = promisify(execFile);
const git = async (root, ...args) => (await execute('git', ['-C', root, ...args])).stdout.trim();
const source = '#include <stdio.h>\n\nint main(void) {\n    puts("snapshot");\n}\n';
function scene() {
  return { type: 'excalidraw', version: 2, source: 'boardroom', files: {}, elements: [
    { id: 'frame', type: 'frame', x: 0, y: 0, width: 800, height: 700 },
    { id: 'code', type: 'text', frameId: 'frame', x: 32, y: 40, width: 600, height: 160, fontSize: 18, strokeColor: '#1e1e1e', text: source },
    { id: 'input', type: 'text', frameId: 'frame', x: 32, y: 500, width: 100, height: 30, fontSize: 18, strokeColor: '#1971c2', text: '3 5\n\n' },
  ], verifier: { frameId: 'frame', result: null, ocr: null } };
}
async function archive(t) {
  const parent = await mkdtemp(join(tmpdir(), 'boardroom-snapshots-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, 'snapshots');
  return { root, parent, store: createSnapshotStore({ root, now: () => new Date('2026-10-17T12:30:05.000Z') }) };
}

test('saves a portable bundle with literal source/input, dated unique folders, and real Git history', async (t) => {
  const { root, store } = await archive(t);
  assert.deepEqual(await store.list(), []);
  const first = await store.save({ title: 'Linked list / lesson', scene: scene() });
  const second = await store.save({ title: 'Linked list / lesson', scene: scene() });
  assert.match(first.id, /^2026-10-17\/12-30-05-linked-list-lesson-[a-f0-9]{8}$/);
  assert.notEqual(first.id, second.id);
  assert.match(first.commit, /^[a-f0-9]{40,64}$/);
  assert.deepEqual((await readdir(join(root, first.id))).sort(), ['.dockerignore', 'Dockerfile', 'board.cpp', 'board.excalidraw', 'build.sh', 'input.txt', 'lib.lock', 'replay.py', 'runner.py']);
  assert.equal(await readFile(join(root, first.id, 'board.cpp'), 'utf8'), source);
  assert.equal(await readFile(join(root, first.id, 'input.txt'), 'utf8'), '3 5\n\n');
  const history = await store.list();
  assert.deepEqual(history.map((entry) => entry.id), [second.id, first.id]);
  assert.equal(history[0].title, 'Linked list / lesson');
  assert.equal(await git(root, 'rev-list', '--count', 'HEAD'), '2');
  // Opening uses the committed version, even if someone edits the working file.
  await writeFile(join(root, first.id, 'board.excalidraw'), '{}');
  assert.equal((await store.read(first.id)).elements[1].text, source);
  assert.equal((await store.read(first.id)).verifier.snapshot.createdAt, first.createdAt);
});

test('requires current handwriting confirmation and saves the reviewed source while preserving ink', async (t) => {
  const { root, store } = await archive(t);
  const board = scene();
  board.elements.push({ id: 'ink', type: 'freedraw', frameId: 'frame', x: 50, y: 50, width: 20, height: 20,
    strokeColor: '#1e1e1e', points: [[0, 0], [20, 20]] });
  await assert.rejects(store.save({ scene: board }), /confirm/);
  const reviewed = 'int main(void) {\n    return 0;\n}\n';
  board.verifier.ocr = { frameId: 'frame', fingerprint: inkFingerprint(board.elements, 'frame'),
    confirmedAt: '2026-10-17T12:00:00Z', program: { source: reviewed, stdin: '3 5\n\n' },
    reviewed: { code: reviewed.split('\n'), stdin: ['3 5', '', ''] } };
  const saved = await store.save({ scene: board });
  assert.equal(await readFile(join(root, saved.id, 'board.cpp'), 'utf8'), reviewed);
  assert.equal((await store.read(saved.id)).elements.find((el) => el.id === 'ink').type, 'freedraw');
  assert.deepEqual(JSON.parse(await readFile(join(root, saved.id, 'ocr.json'), 'utf8')), board.verifier.ocr);
  board.elements.at(-1).points.push([30, 30]);
  await assert.rejects(store.save({ scene: board }), /confirm/);
});

test('large stroke scenes remain within the file-import limit and reopen from Git intact', async (t) => {
  const { root, store } = await archive(t);
  const board = scene();
  board.elements.push({ id: 'annotation', type: 'freedraw', frameId: 'frame', x: 20, y: 20, width: 100, height: 100,
    strokeColor: '#e03131', points: Array.from({ length: 60_000 }, (_, i) => [i % 100, i % 100]) });
  const saved = await store.save({ scene: board });
  const bytes = await readFile(join(root, saved.id, 'board.excalidraw'));
  assert.ok(bytes.length <= 2_000_000);
  assert.equal((await store.read(saved.id)).elements.at(-1).points.length, 60_000);
});

test('rejects malformed or empty snapshots and traversal paths without creating archives', async (t) => {
  const { root, parent, store } = await archive(t);
  for (const value of [null, {}, { scene: {} }, { scene: { ...scene(), elements: [null] } },
    { scene: { ...scene(), verifier: { frameId: 'missing' } } }]) {
    await assert.rejects(store.save(value), (error) => error.status === 400);
  }
  const empty = scene(); empty.elements = empty.elements.filter((el) => el.id !== 'code');
  await assert.rejects(store.save({ scene: empty }), /nonempty/);
  assert.deepEqual(await readdir(parent), []);
  for (const id of ['../../.env', '2026-10-17/../../../.env', 'HEAD:board.cpp']) {
    await assert.rejects(store.read(id), (error) => error.status === 404);
  }
});

test('preserves saved files when Git fails and releases the save lock for retry', async (t) => {
  const { root, parent, store } = await archive(t);
  // Initialize an empty dedicated repo and make its index temporarily unavailable.
  await execute('git', ['init', '--quiet', root]);
  await writeFile(join(root, '.git/index.lock'), 'test lock');
  const first = await store.save({ scene: scene() });
  assert.equal(first.commit, null);
  assert.match(first.warning, /Files were saved/);
  assert.equal(await readFile(join(root, first.id, 'board.cpp'), 'utf8'), source);
  assert.deepEqual(await store.list(), []);
  await rm(join(root, '.git/index.lock'));
  const second = await store.save({ scene: scene() });
  assert.ok(second.commit);
  assert.deepEqual((await store.list()).map((entry) => entry.id), [second.id]);
});

test('serializes saves and leaves staged application work untouched', async (t) => {
  const { root, parent, store } = await archive(t);
  await execute('git', ['init', '--quiet', parent]);
  await writeFile(join(parent, 'notes.txt'), 'Unrelated staged work');
  await git(parent, 'add', 'notes.txt');
  const first = store.save({ scene: scene() });
  await assert.rejects(store.save({ scene: scene() }), (error) => error.status === 429);
  const saved = await first;
  assert.ok(saved.commit);
  assert.equal(await git(parent, 'diff', '--cached', '--name-only'), 'notes.txt');
  assert.equal((await git(root, 'ls-tree', '-r', '--name-only', 'HEAD')).split('\n').length, 9);
  assert.equal(await git(root, 'remote'), '');
});

test('vendors only referenced curated headers and their internal dependencies, and refuses changed files before replay', async (t) => {
  const { root, parent, store } = await archive(t);
  const board = scene();
  board.elements[1].text = '#include <queue.h>\r\n/* #include <stack.h> */\r\nint main(void) { Queue q; queue_init(&q); queue_free(&q); }\r\n';
  const saved = await store.save({ scene: board });
  const folder = join(root, saved.id);
  assert.deepEqual((await readdir(join(folder, 'lib'))).sort(), ['board_contract.h', 'queue.h']);
  assert.equal(await readFile(join(folder, 'board.cpp'), 'utf8'), board.elements[1].text);
  const comparison = await store.libraries(saved.id);
  assert.equal(comparison.legacy, false);
  assert.deepEqual(comparison.headers.map((header) => header.file), ['board_contract.h', 'queue.h']);
  assert.ok(comparison.headers.every((header) => !header.changed && header.saved === header.current));
  await assert.rejects(store.libraries('../../.env'), (error) => error.status === 404);
  const manifest = JSON.parse(await readFile(join(folder, 'lib.lock'), 'utf8'));
  assert.match(manifest.compilerImage, /@sha256:[a-f0-9]{64}$/);
  assert.match(manifest.files['lib/queue.h'], /^[a-f0-9]{64}$/);
  assert.equal(await git(root, 'show', `HEAD:${saved.id}/lib/queue.h`),
    (await readFile(new URL('../runner/lib/queue.h', import.meta.url), 'utf8')).trim());
  const run = (...args) => execute('bash', [join(folder, 'build.sh'), ...args]);
  assert.match((await run('--verify')).stdout, /integrity verified/);
  const portable = join(parent, 'copied lesson');
  await cp(folder, portable, { recursive: true });
  assert.match((await execute('bash', [join(portable, 'build.sh'), '--verify'], { cwd: parent })).stdout, /integrity verified/);
  await writeFile(join(folder, 'lib/queue.h'), 'tampered');
  await assert.rejects(run(), (error) => error.code === 1 && /integrity check failed: lib\/queue.h/.test(error.stderr));
  assert.equal(await readFile(join(folder, 'board.cpp'), 'utf8'), board.elements[1].text);
});

test('records OCR review provenance and only a result matching the saved program', async (t) => {
  const { root, store } = await archive(t);
  const board = scene();
  const program = extractProgram(board.elements, 'frame');
  board.verifier.result = { source: program.source, stdin: program.stdin,
    signature: programSignature(program, 'frame'), status: 'compile_error', diagnostics: [] };
  const saved = await store.save({ scene: board });
  const evidence = JSON.parse(await readFile(join(root, saved.id, 'result.json'), 'utf8'));
  assert.equal(evidence.provenance, 'browser-reported');
  assert.equal(evidence.result.status, 'compile_error');
  board.elements[1].text += '\n// edited since run';
  const stale = await store.save({ scene: board });
  await assert.rejects(readFile(join(root, stale.id, 'result.json')), { code: 'ENOENT' });
});

async function waitForSync(store, expected) {
  for (let i = 0; i < 100; i++) {
    const status = await store.syncStatus();
    if (status.state === expected) return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal((await store.syncStatus()).state, expected);
}

test('pushes committed lessons to a configured archive remote and recovers after a restart', async (t) => {
  const { root, parent, store } = await archive(t);
  assert.equal((await store.syncStatus()).state, 'empty');
  const first = await store.save({ scene: scene() });
  assert.equal((await store.syncStatus()).state, 'local_only');
  const remote = join(parent, 'remote.git');
  await execute('git', ['init', '--bare', '--quiet', remote]);
  await git(root, 'remote', 'add', 'origin', remote);
  await store.retrySync();
  await waitForSync(store, 'synced');
  assert.equal(await git(remote, 'rev-parse', 'refs/heads/boardroom-lessons'), first.commit);

  const offline = join(parent, 'offline.git');
  await rename(remote, offline);
  const second = await store.save({ scene: scene() });
  await store.retrySync();
  await waitForSync(store, 'error');
  assert.equal(await git(root, 'rev-parse', 'HEAD'), second.commit);
  assert.equal(await git(root, 'rev-parse', 'refs/boardroom-sync/origin'), first.commit);

  // The sync cursor lives in Git, so a new server process resumes from the local commits.
  await rename(offline, remote);
  const restarted = createSnapshotStore({ root });
  restarted.startSync();
  t.after(() => restarted.stopSync());
  await restarted.retrySync();
  await waitForSync(restarted, 'synced');
  assert.equal(await git(remote, 'rev-parse', 'refs/heads/boardroom-lessons'), second.commit);
});

test('a divergent remote cannot overwrite local or remote lesson history', async (t) => {
  const { root, parent, store } = await archive(t);
  const first = await store.save({ scene: scene() });
  const remote = join(parent, 'remote.git');
  await execute('git', ['init', '--bare', '--quiet', remote]);
  await git(root, 'remote', 'add', 'origin', remote);
  await store.retrySync();
  await waitForSync(store, 'synced');
  const other = join(parent, 'other');
  await execute('git', ['clone', '--quiet', '--branch', 'boardroom-lessons', remote, other]);
  await writeFile(join(other, 'other.txt'), 'another teacher\n');
  await git(other, 'add', 'other.txt');
  await execute('git', ['-C', other, '-c', 'user.name=Teacher', '-c', 'user.email=teacher@localhost', 'commit', '--quiet', '-m', 'Other lesson']);
  await git(other, 'push', 'origin', 'HEAD:boardroom-lessons');
  const remoteCommit = await git(remote, 'rev-parse', 'refs/heads/boardroom-lessons');
  const local = await store.save({ scene: scene() });
  await store.retrySync();
  await waitForSync(store, 'error');
  assert.equal(await git(remote, 'rev-parse', 'refs/heads/boardroom-lessons'), remoteCommit);
  assert.equal(await git(root, 'rev-parse', 'HEAD'), local.commit);
  assert.equal(await git(root, 'rev-parse', 'refs/boardroom-sync/origin'), first.commit);
});

test('a lesson saved during an in-flight push is sent afterward', async (t) => {
  const { root, parent, store } = await archive(t);
  const first = await store.save({ scene: scene() });
  const remote = join(parent, 'remote.git');
  await execute('git', ['init', '--bare', '--quiet', remote]);
  // Delay the remote transaction so the second save overlaps the first push.
  await writeFile(join(remote, 'hooks/pre-receive'), '#!/bin/sh\nsleep 1\n', { mode: 0o755 });
  await git(root, 'remote', 'add', 'origin', remote);
  store.startSync();
  t.after(() => store.stopSync());
  for (let i = 0; i < 100 && (await store.syncStatus()).state !== 'syncing'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal((await store.syncStatus()).state, 'syncing');
  const second = await store.save({ scene: scene() });
  assert.notEqual(first.commit, second.commit);
  for (let i = 0; i < 300 && (await store.syncStatus()).state !== 'synced'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal((await store.syncStatus()).state, 'synced');
  assert.equal(await git(remote, 'rev-parse', 'refs/heads/boardroom-lessons'), second.commit);
});

test('Python snapshots preserve language, save board.py and verify portable replay metadata', async (t) => {
  const { root, store } = await archive(t);
  const board = scene();
  board.verifier.language = 'python';
  board.elements.find((el) => el.id === 'code').text = '#include <queue.h>\nfrom collections import deque\n\nprint(sum(deque(map(int, input().split()))))\n';
  const saved = await store.save({ title: 'Python lesson', scene: board });
  const files = await readdir(join(root, saved.id));
  assert.ok(files.includes('board.py'));
  assert.ok(!files.includes('board.cpp'));
  assert.ok(!files.includes('lib'));
  const manifest = JSON.parse(await readFile(join(root, saved.id, 'lib.lock'), 'utf8'));
  assert.equal(manifest.language, 'python');
  assert.ok(manifest.files['board.py']);
  assert.equal((await store.read(saved.id)).verifier.language, 'python');
  const verified = await execute('bash', ['build.sh', '--verify'], { cwd: join(root, saved.id), timeout: 5000 });
  assert.match(verified.stdout, /integrity verified/);
});

test('automatic snapshots keep the whole original board but bundle the actual compiled source, case input and result', async (t) => {
  const { root, store } = await archive(t);
  const board = scene();
  board.elements.push({ id: 'outside-note', type: 'text', x: 4000, y: 3000, width: 300, height: 30,
    strokeColor: '#7048e8', fontSize: 20, text: 'Explanation outside the program' });
  const actual = '#include <queue.h>\nint main(void) { broken; }';
  board.verifier.result = { status: 'success', stdout: 'Old result from a previous run' };
  board.verifier.execution = { kind: 'case', level: 2, language: 'c', source: actual, stdin: 'different case input\n\n',
    result: { status: 'compile_error', stdout: '', compilerOutput: 'broken is undeclared', diagnostics: [] } };
  const saved = await store.save({ title: 'Automatic compile', scene: board });
  const folder = join(root, saved.id);
  const reopened = await store.read(saved.id);
  assert.equal(reopened.elements[1].text, source);
  assert.equal(reopened.elements.at(-1).text, 'Explanation outside the program');
  assert.equal(reopened.verifier.execution.source, actual);
  assert.equal(reopened.verifier.result, null);
  assert.equal(await readFile(join(folder, 'board.cpp'), 'utf8'), actual);
  assert.equal(await readFile(join(folder, 'input.txt'), 'utf8'), 'different case input\n\n');
  assert.ok((await readdir(join(folder, 'lib'))).includes('queue.h'));
  const evidence = JSON.parse(await readFile(join(folder, 'result.json'), 'utf8'));
  assert.equal(evidence.provenance, 'browser-reported');
  assert.equal(evidence.result.status, 'compile_error');
  assert.equal(evidence.result.source, actual);
  assert.equal(evidence.result.kind, 'case');
  assert.match((await execute('bash', ['build.sh', '--verify'], { cwd: folder })).stdout, /integrity verified/);
});

test('automatic Python snapshots support editor-only source on an empty writing frame', async (t) => {
  const { root, store } = await archive(t);
  const board = scene();
  board.elements = board.elements.filter(el => el.type === 'frame');
  board.verifier.language = 'python';
  board.verifier.execution = { kind: 'run', level: 1, language: 'python', source: 'print(8)', stdin: '', result: { status: 'success', stdout: '8\n' } };
  const saved = await store.save({ scene: board });
  assert.equal(await readFile(join(root, saved.id, 'board.py'), 'utf8'), 'print(8)');
  assert.equal((await store.read(saved.id)).elements.length, 1);
});

test('execution metadata cannot bypass language, size or handwriting review checks', async (t) => {
  const { store } = await archive(t);
  const board = scene();
  const execution = { kind: 'run', level: 1, language: 'c', source: 'int main(void) {}', stdin: '', result: { status: 'success' } };
  for (const changes of [{ language: 'python' }, { level: 0 }, { kind: 'unknown' }, { result: {} },
    { source: 'x'.repeat(32_769) }, { stdin: '\0' }, { source: null }]) {
    board.verifier.execution = { ...execution, ...changes };
    await assert.rejects(store.save({ scene: board }), { status: 400 });
  }
  board.verifier.execution = execution;
  board.elements.push({ id: 'ink', type: 'freedraw', frameId: 'frame', x: 50, y: 50, width: 20, height: 20,
    strokeColor: '#1e1e1e', points: [[0, 0], [20, 20]] });
  await assert.rejects(store.save({ scene: board }), /confirm/);
});


test('new C++ bundles record their compiler and old .c manifests still verify', async (t) => {
  const { root, store } = await archive(t);
  const saved = await store.save({ scene: scene() });
  const folder = join(root, saved.id);
  const manifest = JSON.parse(await readFile(join(folder, 'lib.lock'), 'utf8'));
  assert.equal(manifest.sourceFile, 'board.cpp');
  assert.equal(manifest.compiler, 'g++');
  assert.equal(manifest.standard, 'c++17');
  const source = await readFile(join(folder, 'board.cpp'));
  await writeFile(join(folder, 'board.c'), source);
  manifest.files['board.c'] = manifest.files['board.cpp'];
  delete manifest.files['board.cpp'];
  delete manifest.sourceFile; delete manifest.compiler; delete manifest.standard;
  await writeFile(join(folder, 'lib.lock'), JSON.stringify(manifest));
  assert.match((await execute('bash', [join(folder, 'build.sh'), '--verify'])).stdout, /integrity verified/);
});
