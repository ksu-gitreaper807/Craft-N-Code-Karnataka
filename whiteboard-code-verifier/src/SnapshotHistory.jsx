import React, { useEffect, useState } from 'react';
import { apiFetch, readApiJson } from './api.js';

export default function SnapshotHistory({ onOpen }) {
  const [snapshots, setSnapshots] = useState([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [sync, setSync] = useState(null);
  const [inspected, setInspected] = useState(null);
  async function refresh() {
    setBusy(true); setError('');
    try {
      const response = await apiFetch('/api/snapshots');
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error ?? 'Could not read lesson history.');
      setSnapshots(data.snapshots);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }
  async function refreshSync() {
    try {
      const response = await apiFetch('/api/snapshots/sync');
      const data = await readApiJson(response);
      if (response.ok) setSync(data);
    } catch { /* History remains usable while status is temporarily unavailable. */ }
  }
  async function retrySync() {
    try {
      const response = await apiFetch('/api/snapshots/sync', { method: 'POST' });
      if (!response.ok) throw new Error('Could not start Git sync. Try again.');
      setSync(await readApiJson(response));
    } catch (caught) { setError(caught.message); }
  }
  useEffect(() => {
    refresh();
    refreshSync();
    const timer = setInterval(refreshSync, 5000);
    return () => clearInterval(timer);
  }, []);
  async function open(id) {
    setBusy(true); setError('');
    try {
      const response = await apiFetch(`/api/snapshots/${encodeURIComponent(id)}`);
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error ?? 'Could not open this snapshot.');
      onOpen(data.scene);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }
  async function inspect(snapshot) {
    if (inspected?.id === snapshot.id) { setInspected(null); return; }
    setError('');
    setInspected({ id: snapshot.id, title: snapshot.title, busy: true });
    try {
      const response = await apiFetch(`/api/snapshots/${encodeURIComponent(snapshot.id)}/libraries`);
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error ?? 'Could not read saved libraries.');
      setInspected({ id: snapshot.id, title: snapshot.title, ...data, file: data.headers[0]?.file ?? '' });
    } catch (caught) { setInspected({ id: snapshot.id, title: snapshot.title, error: caught.message }); }
  }
  const selectedHeader = inspected?.headers?.find((header) => header.file === inspected.file);
  return <section className="snapshot-history" aria-label="Saved lesson history">
    <h3>Lesson history</h3>
    <p className="panel-help">Every compile or run automatically snapshots the whole board, including annotations outside the selected region. The replay bundle saves the exact C++ or Python source and input used. Opening replaces this canvas; save current work first. Handwriting needs fresh review after opening.</p>
    <button className="quiet-button" disabled={busy} onClick={() => { refresh(); refreshSync(); }}>{busy ? 'Loading…' : 'Refresh history'}</button>
    {sync && <div className="panel-help" role="status">
      {sync.state === 'empty' && 'No lessons saved yet.'}
      {sync.state === 'local_only' && 'Lessons are saved on this machine. Configure a private archive remote to sync them.'}
      {sync.state === 'pending' && 'Git sync is queued; local lessons are safe.'}
      {sync.state === 'syncing' && 'Syncing lesson history…'}
      {sync.state === 'synced' && 'Lesson history is synced to the archive remote.'}
      {sync.state === 'error' && 'Git sync failed. Local lessons are safe; the remote may be offline or have newer commits.'}
      {(sync.state === 'pending' || sync.state === 'error') && <button className="quiet-button" onClick={retrySync}>Retry sync</button>}
    </div>}
    {error && <div className="error-notice" role="alert">{error}</div>}
    {!busy && !snapshots.length && !error && <p className="panel-help">No committed lessons yet. Use Snapshot to save the current lesson.</p>}
    <ol>{snapshots.map((snapshot) => <li key={snapshot.id}>
      <h4>{snapshot.title}</h4>
      <time dateTime={snapshot.createdAt}>{new Date(snapshot.createdAt).toLocaleString()}</time>
      <code>{snapshot.id}</code><small>Git commit {snapshot.commit.slice(0, 8)}</small>
      <button className="quiet-button" disabled={busy} onClick={() => open(snapshot.id)}>Open saved board</button>
      <button className="quiet-button" disabled={busy} onClick={() => inspect(snapshot)}>{inspected?.id === snapshot.id ? 'Close library comparison' : 'Compare saved libraries'}</button>
    </li>)}</ol>
    {inspected && <div className="snapshot-comparison" aria-label="Saved library comparison">
      <h4>Libraries in {inspected.title}</h4>
      {inspected.busy && <p className="panel-help">Loading committed headers…</p>}
      {inspected.error && <div className="error-notice" role="alert">{inspected.error}</div>}
      {inspected.legacy && <p className="panel-help">This older snapshot did not bundle its library files.</p>}
      {inspected.headers?.length === 0 && !inspected.legacy && <p className="panel-help">This program did not use a curated library header.</p>}
      {inspected.headers?.length > 0 && <>
        <label className="field-label" htmlFor="saved-library-select">SAVED HEADER</label>
        <select id="saved-library-select" className="frame-select" value={inspected.file} onChange={(event) => setInspected({ ...inspected, file: event.target.value })}>
          {inspected.headers.map((header) => <option key={header.file} value={header.file}>{header.file} · {header.changed ? 'changed' : 'same as current'}</option>)}
        </select>
        <p className="panel-help">{selectedHeader.changed ? 'The current header differs from the saved lesson.' : 'The current header matches the saved lesson.'} Replaying the bundle uses the saved copy.</p>
        <div className="library-comparison"><div><strong>Saved with lesson</strong><pre>{selectedHeader.saved}</pre></div><div><strong>Current application</strong><pre>{selectedHeader.current}</pre></div></div>
      </>}
    </div>}
  </section>;
}
