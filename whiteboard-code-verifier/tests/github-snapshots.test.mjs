import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGithubSnapshotStore, githubSnapshotConfiguration } from '../server/github-snapshots.mjs';
import { createSnapshotHandler } from '../api/snapshots.js';

const env = { SNAPSHOT_GITHUB_REPOSITORY: 'teacher/lessons', SNAPSHOT_GITHUB_TOKEN: 'private-test-key' };
const date = '2026-10-17T12:30:05.000Z';
function scene(language = 'c') {
  return { type: 'excalidraw', elements: [
    { id: 'frame', type: 'frame', x: 0, y: 0, width: 800, height: 600 },
    { id: 'code', type: 'text', frameId: 'frame', x: 20, y: 20, width: 500, height: 120, fontSize: 18,
      strokeColor: '#1e1e1e', text: language === 'c' ? '#include <queue.h>\nint main(void) { return 0; }' : 'print(input())' },
    { id: 'input', type: 'text', frameId: 'frame', x: 20, y: 200, width: 100, height: 40, fontSize: 18,
      strokeColor: '#1971c2', text: 'hello\n\n' },
  ], verifier: { frameId: 'frame', language } };
}

// A Git object model enforces fast-forward updates and preserves base trees.
function github({ race = false, reject = null } = {}) {
  let counter = 0, branch = null;
  const trees = new Map([['seed-tree', new Map([['README.md', 'Archive']])]]);
  const commits = new Map([['seed', { tree: { sha: 'seed-tree' }, parents: [], message: 'Initialize archive' }]]);
  const requests = [];
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
  async function fetchImpl(url, options) {
    const path = new URL(url).pathname.replace('/repos/teacher/lessons', '');
    const body = options.body && JSON.parse(options.body);
    requests.push({ path, ...options, body });
    assert.equal(options.headers.Authorization, 'Bearer private-test-key');
    if (reject) return new Response('provider response contains private-test-key', { status: reject });
    if (!path) return json({ default_branch: 'main' });
    if (path === '/git/ref/heads/main') return json({ object: { sha: 'seed' } });
    if (path === '/git/ref/heads/boardroom-lessons') return branch ? json({ object: { sha: branch } }) : json({}, 404);
    if (path.startsWith('/git/commits/') && options.method === 'GET') return json(commits.get(path.split('/').at(-1)));
    if (path === '/git/trees') {
      const sha = `tree-${++counter}`, files = new Map(trees.get(body.base_tree));
      for (const entry of body.tree) files.set(entry.path, entry.content);
      trees.set(sha, files);
      return json({ sha }, 201);
    }
    if (path === '/git/commits') {
      const sha = `commit-${++counter}`;
      commits.set(sha, { ...body, tree: { sha: body.tree } });
      return json({ sha }, 201);
    }
    if (path === '/git/refs' || path === '/git/refs/heads/boardroom-lessons') {
      assert.notEqual(body.force, true);
      if (race) {
        race = false;
        commits.set('other-teacher', { tree: { sha: 'seed-tree' }, parents: ['seed'], message: 'Other teacher' });
        branch = 'other-teacher';
        return json({}, 422);
      }
      if (branch && commits.get(body.sha).parents[0] !== branch) return json({}, 422);
      branch = body.sha;
      return json({ object: { sha: branch } });
    }
    if (path.startsWith('/contents/')) {
      const sha = new URL(url).searchParams.get('ref');
      const files = trees.get(commits.get(sha)?.tree.sha);
      const value = files?.get(decodeURIComponent(path.slice('/contents/'.length)));
      return value === undefined ? json({}, 404) : new Response(value);
    }
    if (path === '/commits') {
      const history = [];
      let sha = branch;
      while (sha) {
        const entry = commits.get(sha);
        history.push({ sha, commit: { message: entry.message, author: { date } } });
        sha = entry.parents[0];
      }
      return json(history);
    }
    throw new Error(`Unexpected request ${options.method} ${path}`);
  }
  return { fetchImpl, requests, trees, commits, head: () => branch };
}

test('hosted archive requires scoped configuration and never exposes its GitHub token', () => {
  assert.equal(githubSnapshotConfiguration({}).available, false);
  assert.equal(githubSnapshotConfiguration({ ...env, SNAPSHOT_GITHUB_BRANCH: '../main' }).available, false);
  const config = githubSnapshotConfiguration(env);
  assert.equal(config.available, true);
  assert.equal(config.branch, 'boardroom-lessons');
  assert.ok(!JSON.stringify(config).includes(env.SNAPSHOT_GITHUB_TOKEN));
});

test('GitHub stores a complete atomic C bundle and fresh instances reopen committed history and headers', async () => {
  const remote = github();
  const store = () => createGithubSnapshotStore({ env, fetchImpl: remote.fetchImpl, now: () => new Date(date) });
  assert.deepEqual(await store().list(), []);
  const saved = await store().save({ title: 'Queue lesson', scene: scene() });
  assert.match(saved.id, /^2026-10-17\/12-30-05-queue-lesson-/);
  assert.equal(remote.head(), saved.commit);
  const commit = remote.commits.get(saved.commit);
  const files = remote.trees.get(commit.tree.sha);
  assert.equal(files.get('README.md'), 'Archive');
  assert.equal(files.get(`${saved.id}/board.cpp`), scene().elements[1].text);
  assert.equal(files.get(`${saved.id}/input.txt`), 'hello\n\n');
  const manifest = JSON.parse(files.get(`${saved.id}/lib.lock`));
  for (const [path, hash] of Object.entries(manifest.files)) {
    assert.equal(createHash('sha256').update(files.get(`${saved.id}/${path}`)).digest('hex'), hash);
  }
  assert.equal((await store().read(saved.id)).verifier.snapshot.title, 'Queue lesson');
  assert.deepEqual(await store().list(), [saved]);
  assert.ok((await store().libraries(saved.id)).headers.every((header) => !header.changed));
  assert.equal((await store().syncStatus()).state, 'synced');
  // The archive branch alone is written, once per complete snapshot.
  const writes = remote.requests.filter((request) => request.path.startsWith('/git/refs'));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.ref, 'refs/heads/boardroom-lessons');
});

test('Python archives preserve input and existing lessons when subsequent commits are saved', async () => {
  const remote = github();
  const store = createGithubSnapshotStore({ env, fetchImpl: remote.fetchImpl });
  const first = await store.save({ scene: scene() });
  const second = await store.save({ scene: scene('python') });
  const files = remote.trees.get(remote.commits.get(second.commit).tree.sha);
  assert.equal(files.get(`${second.id}/board.py`), 'print(input())');
  assert.ok(!files.has(`${second.id}/board.cpp`));
  assert.ok(!files.has(`${second.id}/lib/queue.h`));
  assert.ok(files.has(`${first.id}/board.cpp`));
  assert.equal((await store.read(second.id)).verifier.language, 'python');
  assert.deepEqual((await store.list()).map((entry) => entry.id), [second.id, first.id]);
});

test('concurrent branch creation rebases the snapshot on the winning commit without a force update', async () => {
  const remote = github({ race: true });
  const store = createGithubSnapshotStore({ env, fetchImpl: remote.fetchImpl });
  const saved = await store.save({ scene: scene() });
  assert.deepEqual(remote.commits.get(saved.commit).parents, ['other-teacher']);
  assert.equal((await store.read(saved.id)).elements[1].text, scene().elements[1].text);
});

test('overlapping teachers retain both complete lessons on a single history chain', async () => {
  const remote = github();
  const store = () => createGithubSnapshotStore({ env, fetchImpl: remote.fetchImpl });
  const saved = await Promise.all([store().save({ title: 'Teacher one', scene: scene() }),
    store().save({ title: 'Teacher two', scene: scene('python') })]);
  assert.deepEqual(new Set((await store().list()).map((entry) => entry.id)), new Set(saved.map((entry) => entry.id)));
  const files = remote.trees.get(remote.commits.get(remote.head()).tree.sha);
  for (const entry of saved) assert.ok(files.has(`${entry.id}/board.excalidraw`));
});

test('validation and traversal rejection happen before GitHub requests; failures expose safe actionable messages', async () => {
  const remote = github();
  const store = createGithubSnapshotStore({ env, fetchImpl: remote.fetchImpl });
  await assert.rejects(store.save({ scene: {} }), { status: 400 });
  await assert.rejects(store.read('../../.env'), { status: 404 });
  await assert.rejects(store.libraries('../../.env'), { status: 404 });
  assert.equal(remote.requests.length, 0);
  for (const status of [401, 403, 429, 500]) {
    const denied = github({ reject: status });
    await assert.rejects(createGithubSnapshotStore({ env, fetchImpl: denied.fetchImpl }).save({ scene: scene() }), (error) => {
      assert.ok(!error.message.includes(env.SNAPSHOT_GITHUB_TOKEN));
      assert.match(error.message, status === 429 ? /rate limit/ : status < 500 ? /access denied/ : /could not record/);
      return true;
    });
    assert.equal(denied.head(), null);
  }
});

test('public hosted routes dispatch encoded folders, libraries, and sync without a token', async () => {
  const previous = process.env.BOARDROOM_API_TOKEN;
  process.env.BOARDROOM_API_TOKEN = 'classroom';
  const calls = [];
  const handler = createSnapshotHandler(() => ({
    list: async () => [], read: async (id) => { calls.push(id); return { type: 'excalidraw' }; },
    libraries: async (id) => { calls.push(id); return { headers: [] }; }, syncStatus: async () => ({ state: 'synced' }),
  }));
  async function call(url, token = 'classroom') {
    let body;
    const res = { setHeader() {}, end(value) { body = JSON.parse(value); } };
    await handler({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } }, res);
    return { status: res.statusCode, body };
  }
  try {
    assert.equal((await call('/api/snapshots', 'wrong')).status, 200);
    assert.equal(calls.length, 0);
    assert.deepEqual((await call('/api/snapshots')).body, { snapshots: [] });
    const id = '2026-10-17/12-30-05-lesson-1234abcd';
    assert.equal((await call(`/api/snapshots/${encodeURIComponent(id)}`)).status, 200);
    assert.equal((await call(`/api/snapshots?snapshotPath=${encodeURIComponent(`${id}/libraries`)}`)).status, 200);
    assert.deepEqual(calls, [id, id]);
    assert.equal((await call('/api/snapshots?snapshotPath=sync')).body.state, 'synced');
    assert.equal((await call('/api/snapshots/%zz')).status, 400);
  } finally {
    if (previous === undefined) delete process.env.BOARDROOM_API_TOKEN;
    else process.env.BOARDROOM_API_TOKEN = previous;
  }
});
