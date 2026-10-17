import { authorize, sendJson, jsonBody, apiError } from '../server/hosted-api.mjs';
import { createGithubSnapshotStore } from '../server/github-snapshots.mjs';
import { SNAPSHOT_BODY_LIMIT } from '../server/snapshots.mjs';

export function createSnapshotHandler(createStore = createGithubSnapshotStore) {
  return async function handler(req, res) {
    if (!authorize(req, res)) return;
    try {
      const store = createStore();
      const url = new URL(req.url ?? '/', 'https://localhost');
      // Vercel rewrites nested paths here; the query value survives the rewrite.
      const path = decodeURIComponent(url.searchParams.get('snapshotPath') ?? url.pathname.replace(/^\/api\/snapshots\/?/, ''));
      if (path === 'sync' && ['GET', 'POST'].includes(req.method)) return sendJson(res, 200, await store.syncStatus());
      if (!path && req.method === 'GET') return sendJson(res, 200, { snapshots: await store.list() });
      if (!path && req.method === 'POST') return sendJson(res, 201, await store.save(jsonBody(req, SNAPSHOT_BODY_LIMIT)));
      if (path && req.method === 'GET') {
        if (path.endsWith('/libraries')) return sendJson(res, 200, await store.libraries(path.slice(0, -'/libraries'.length)));
        return sendJson(res, 200, { scene: await store.read(path) });
      }
      return sendJson(res, 405, { error: 'Method not allowed.' });
    } catch (error) {
      if (error instanceof URIError) return sendJson(res, 400, { error: 'Invalid snapshot path.' });
      apiError(res, error);
    }
  };
}

export default createSnapshotHandler();
