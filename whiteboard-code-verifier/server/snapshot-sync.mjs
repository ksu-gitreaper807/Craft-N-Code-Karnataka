// Git commits are the durable queue: HEAD can always be compared with the last pushed ref.
const REMOTE = 'origin';
const BRANCH = 'boardroom-lessons';
const SYNCED_REF = 'refs/boardroom-sync/origin';
const RETRY_MS = 60_000;

export function createSnapshotSync({ git, hasHistory }) {
  let inFlight = null;
  let timer = null;
  let lastError = false;

  async function ref(name) {
    try { return (await git(['rev-parse', '--verify', name])).trim(); }
    catch { return null; }
  }

  async function status() {
    if (!await hasHistory()) return { state: 'empty', remoteConfigured: false, branch: BRANCH };
    const remotes = (await git(['remote'])).trim().split('\n');
    const remoteConfigured = remotes.includes(REMOTE);
    const localCommit = await ref('HEAD');
    if (!localCommit) return { state: 'empty', remoteConfigured, branch: BRANCH };
    if (!remoteConfigured) return { state: 'local_only', remoteConfigured, branch: BRANCH, localCommit };
    const lastSyncedCommit = await ref(SYNCED_REF);
    return {
      state: lastSyncedCommit === localCommit ? 'synced' : inFlight ? 'syncing' : lastError ? 'error' : 'pending',
      remoteConfigured, branch: BRANCH, localCommit, lastSyncedCommit,
    };
  }

  async function sync() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const current = await status();
      if (!current.remoteConfigured || !current.localCommit || current.localCommit === current.lastSyncedCommit) return current;
      try {
        // A non-fast-forward rejection is deliberate: never overwrite another archive's commits.
        await git(['push', REMOTE, `HEAD:refs/heads/${BRANCH}`], 30_000);
        await git(['update-ref', SYNCED_REF, current.localCommit]);
        lastError = false;
      } catch {
        // Git errors can include remote URLs or credentials. Expose only a fixed message.
        lastError = true;
      }
      return status();
    })();
    try { return await inFlight; }
    finally {
      inFlight = null;
      // A save during a push leaves a newer HEAD. Start its push after the first one completes.
      if (!lastError) {
        void status().then((current) => {
          if (current.remoteConfigured && current.localCommit && current.localCommit !== current.lastSyncedCommit) queue();
        }).catch(() => {});
      }
    }
  }

  function queue() { void sync().catch(() => { lastError = true; }); }

  return {
    status,
    sync,
    queue,
    start() {
      if (timer) return;
      queue();
      timer = setInterval(queue, RETRY_MS);
      timer.unref();
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}
