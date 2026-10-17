import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSnapshotStore } from '../server/snapshots.mjs';
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

test('saves exactly three files with literal source/input, dated unique folders, and real Git history', async (t) => {
  const { root, store } = await archive(t);
  assert.deepEqual(await store.list(), []);
  const first = await store.save({ title: 'Linked list / lesson', scene: scene() });
  const second = await store.save({ title: 'Linked list / lesson', scene: scene() });
  assert.match(first.id, /^2026-10-17\/12-30-05-linked-list-lesson-[a-f0-9]{8}$/);
  assert.notEqual(first.id, second.id);
  assert.match(first.commit, /^[a-f0-9]{40,64}$/);
  assert.deepEqual((await readdir(join(root, first.id))).sort(), ['board.c', 'board.excalidraw', 'input.txt']);
  assert.equal(await readFile(join(root, first.id, 'board.c'), 'utf8'), source);
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
  assert.equal(await readFile(join(root, saved.id, 'board.c'), 'utf8'), reviewed);
  assert.equal((await store.read(saved.id)).elements.find((el) => el.id === 'ink').type, 'freedraw');
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
  for (const id of ['../../.env', '2026-10-17/../../../.env', 'HEAD:board.c']) {
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
  assert.equal(await readFile(join(root, first.id, 'board.c'), 'utf8'), source);
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
  assert.equal((await git(root, 'ls-tree', '-r', '--name-only', 'HEAD')).split('\n').length, 3);
  assert.equal(await git(root, 'remote'), '');
});
