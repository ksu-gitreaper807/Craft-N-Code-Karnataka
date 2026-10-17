import React, { useEffect, useState } from 'react';

export default function SnapshotHistory({ onOpen }) {
  const [snapshots, setSnapshots] = useState([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  async function refresh() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/snapshots');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not read lesson history.');
      setSnapshots(data.snapshots);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }
  useEffect(() => { refresh(); }, []);
  async function open(id) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/snapshots/${encodeURIComponent(id)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not open this snapshot.');
      onOpen(data.scene);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }
  return <section className="snapshot-history" aria-label="Saved lesson history">
    <h3>Lesson history</h3>
    <p className="panel-help">Each snapshot saves the board, C source, and input in a dated folder with a local Git commit. Opening replaces this canvas; save current work first. Handwriting needs fresh review after opening.</p>
    <button className="quiet-button" disabled={busy} onClick={refresh}>{busy ? 'Loading…' : 'Refresh history'}</button>
    {error && <div className="error-notice" role="alert">{error}</div>}
    {!busy && !snapshots.length && !error && <p className="panel-help">No committed lessons yet. Use Snapshot to save the current lesson.</p>}
    <ol>{snapshots.map((snapshot) => <li key={snapshot.id}>
      <h4>{snapshot.title}</h4>
      <time dateTime={snapshot.createdAt}>{new Date(snapshot.createdAt).toLocaleString()}</time>
      <code>{snapshot.id}</code><small>Git commit {snapshot.commit.slice(0, 8)}</small>
      <button className="quiet-button" disabled={busy} onClick={() => open(snapshot.id)}>Open saved board</button>
    </li>)}</ol>
  </section>;
}
