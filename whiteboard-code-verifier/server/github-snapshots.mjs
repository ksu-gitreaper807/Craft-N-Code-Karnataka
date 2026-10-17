import { readFile } from 'node:fs/promises';
import { prepareSnapshot, SNAPSHOT_ID } from './snapshots.mjs';
import { libraries } from '../src/libraries.js';

const fail = (message, status = 503, githubStatus) => Object.assign(new Error(message), { status, githubStatus });
const headers = new Set([...libraries.map((library) => library.file), 'board_contract.h']);
const pathEncode = (value) => value.split('/').map(encodeURIComponent).join('/');

export function githubSnapshotConfiguration(env = process.env) {
  const repository = env.SNAPSHOT_GITHUB_REPOSITORY?.trim() ?? '';
  const branch = env.SNAPSHOT_GITHUB_BRANCH?.trim() || 'boardroom-lessons';
  const valid = /^[\w.-]+\/[\w.-]+$/.test(repository) &&
    /^[\w-]+(?:[/.][\w-]+)*$/.test(branch) && !branch.includes('..') && !branch.endsWith('.lock');
  return { available: Boolean(valid && env.SNAPSHOT_GITHUB_TOKEN?.trim()),
    ...(valid ? { repository, branch } : {}),
    message: valid && env.SNAPSHOT_GITHUB_TOKEN?.trim()
      ? 'Lessons are committed directly to GitHub.'
      : 'Configure SNAPSHOT_GITHUB_REPOSITORY (owner/repo) and SNAPSHOT_GITHUB_TOKEN (Contents: read/write) in Vercel, then redeploy.' };
}

// Each request uses GitHub as the source of truth; no disk, background jobs, or
// warm-function memory is required for durability.
export function createGithubSnapshotStore({ env = process.env, fetchImpl = fetch, now = () => new Date() } = {}) {
  const config = githubSnapshotConfiguration(env);
  const deadline = AbortSignal.timeout(45_000);
  async function request(path, { method = 'GET', body, raw = false } = {}) {
    if (!config.available) throw fail(config.message);
    let response;
    try {
      response = await fetchImpl(`https://api.github.com/repos/${config.repository}${path}`, {
        method, redirect: 'error', signal: AbortSignal.any([deadline, AbortSignal.timeout(10_000)]),
        headers: { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          Authorization: `Bearer ${env.SNAPSHOT_GITHUB_TOKEN.trim()}`, 'User-Agent': 'Boardroom-Snapshots',
          'X-GitHub-Api-Version': '2026-03-10', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw fail('GitHub snapshot storage is unreachable or timed out. Refresh History before retrying a save.', 504); }
    if (!response.ok) {
      const status = response.status;
      const limited = status === 429 || (status === 403 && response.headers.get('x-ratelimit-remaining') === '0');
      throw fail(limited ? 'GitHub API rate limit reached. Wait before retrying.'
        : status === 401 || status === 403 ? 'GitHub snapshot access denied. Check token expiry, repository access, Contents: read/write, and branch protection.'
          : status === 404 ? 'GitHub archive or file not found. Check the repository name and token access.'
            : status === 409 ? 'Initialize the GitHub archive with a README before saving.'
              : 'GitHub could not record the snapshot. Check archive access and branch rules.', limited ? 429 : 503, status);
    }
    try { return raw ? await response.text() : await response.json(); }
    catch { throw fail('GitHub returned an unreadable snapshot response.'); }
  }

  const branchPath = pathEncode(config.branch ?? 'boardroom-lessons');
  async function head() {
    try { return (await request(`/git/ref/heads/${branchPath}`)).object.sha; }
    catch (error) {
      if (error.githubStatus !== 404) throw error;
      // GitHub also returns 404 for inaccessible repositories. Do not report
      // those as an empty, healthy archive.
      await request('');
      return null;
    }
  }
  async function readFileAt(id, file, sha) {
    if (!SNAPSHOT_ID.test(id)) throw fail('Snapshot not found.', 404);
    if (!sha) throw fail('Snapshot not found.', 404);
    try { return await request(`/contents/${pathEncode(`${id}/${file}`)}?ref=${encodeURIComponent(sha)}`, { raw: true }); }
    catch (error) { if (error.githubStatus === 404) throw fail('Snapshot not found in Git history.', 404); throw error; }
  }
  async function syncStatus() {
    const sha = await head();
    return { state: sha ? 'synced' : 'empty', remoteConfigured: true, storage: 'github',
      repository: config.repository, branch: config.branch, lastSyncedCommit: sha };
  }
  return {
    syncStatus, retrySync: syncStatus,
    async save(body) {
      // Validate before any outbound request, with exactly the same rules as disk snapshots.
      const snapshot = await prepareSnapshot(body, now());
      const entries = [...snapshot.files].map(([name, content]) => ({
        path: `${snapshot.id}/${name}`, mode: '100644', type: 'blob', content: Buffer.from(content).toString('utf8'),
      }));
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = await head();
        let parent = current;
        if (!parent) {
          const repository = await request('');
          parent = (await request(`/git/ref/heads/${pathEncode(repository.default_branch)}`)).object.sha;
        }
        const base = await request(`/git/commits/${parent}`);
        const tree = await request('/git/trees', { method: 'POST', body: { base_tree: base.tree.sha, tree: entries } });
        const commit = await request('/git/commits', { method: 'POST', body: {
          message: `board: ${snapshot.title}\n\nBoardroom-Snapshot: ${snapshot.id}\nBoardroom-Created-At: ${snapshot.createdAt}`,
          tree: tree.sha, parents: [parent],
        } });
        try {
          // The branch moves once, after the complete folder exists. Never force-push.
          await request(current ? `/git/refs/heads/${branchPath}` : '/git/refs', {
            method: current ? 'PATCH' : 'POST', body: current
              ? { sha: commit.sha, force: false } : { ref: `refs/heads/${config.branch}`, sha: commit.sha },
          });
          return { id: snapshot.id, title: snapshot.title, createdAt: snapshot.createdAt, commit: commit.sha };
        } catch (error) {
          if (![409, 422].includes(error.githubStatus)) throw error;
          // A lost race is safe to retry on the new parent, preserving both saves.
          if (await head() === current) throw error;
        }
      }
      throw fail('Other lessons are being saved. Refresh History, then retry.', 409);
    },
    async list() {
      const sha = await head();
      if (!sha) return [];
      const snapshots = [];
      for (let page = 1; page <= 3 && snapshots.length < 30; page++) {
        const commits = await request(`/commits?sha=${sha}&per_page=100&page=${page}`);
        for (const entry of commits) {
          const message = entry.commit.message;
          let id = /^Boardroom-Snapshot: (.+)$/m.exec(message)?.[1];
          // Older local archives use plain "board: title" commit messages.
          if (!id && message.startsWith('board: ')) {
            const detail = await request(`/commits/${entry.sha}`);
            id = detail.files?.find((file) => file.filename.endsWith('/board.excalidraw'))?.filename.slice(0, -'/board.excalidraw'.length);
          }
          if (!id || !SNAPSHOT_ID.test(id)) continue;
          snapshots.push({ id, commit: entry.sha, title: message.split('\n')[0].replace(/^board: /, ''),
            createdAt: /^Boardroom-Created-At: (.+)$/m.exec(message)?.[1] ?? entry.commit.author.date });
          if (snapshots.length === 30) break;
        }
        if (commits.length < 100) break;
      }
      return snapshots;
    },
    async read(id) {
      if (!SNAPSHOT_ID.test(id)) throw fail('Snapshot not found.', 404);
      try { return JSON.parse(await readFileAt(id, 'board.excalidraw', await head())); }
      catch (error) { if (error instanceof SyntaxError) throw fail('Saved board is unreadable.'); throw error; }
    },
    async libraries(id) {
      if (!SNAPSHOT_ID.test(id)) throw fail('Snapshot not found.', 404);
      const sha = await head();
      let manifest;
      try { manifest = JSON.parse(await readFileAt(id, 'lib.lock', sha)); }
      catch (error) {
        if (error.status === 404) {
          await readFileAt(id, 'board.excalidraw', sha);
          return { legacy: true, headers: [] };
        }
        if (error instanceof SyntaxError) throw fail('Saved library manifest is unreadable.');
        throw error;
      }
      if (!manifest?.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) throw fail('Saved library manifest is unreadable.');
      const savedHeaders = await Promise.all(Object.keys(manifest.files)
        .filter((name) => name.startsWith('lib/') && headers.has(name.slice(4))).sort().map(async (name) => {
          const [saved, current] = await Promise.all([readFileAt(id, name, sha),
            readFile(new URL(`../runner/${name}`, import.meta.url), 'utf8')]);
          return { file: name.slice(4), saved, current, changed: saved !== current };
        }));
      return { legacy: false, headers: savedHeaders };
    },
  };
}
