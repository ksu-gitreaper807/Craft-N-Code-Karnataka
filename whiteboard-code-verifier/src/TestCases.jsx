import React, { useState } from 'react';
import { apiFetch } from './api.js';

const MAX_CASES = 5;
const emptyCase = (id) => ({ id, name: `Case ${id}`, stdin: '', expectedStatus: 'success', checkOutput: false, expectedOutput: '' });
const statuses = [
  ['success', 'Completes'], ['compile_error', 'Compiler error'], ['runtime_error', 'Runtime issue'],
  ['timeout', 'Time limit'], ['output_limit', 'Output limit'],
];

export default function TestCases({ program, signature, disabled, onBusy }) {
  const [cases, setCases] = useState([emptyCase(1)]);
  const [nextId, setNextId] = useState(2);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function change(id, field, value) {
    setCases((previous) => previous.map((item) => item.id === id ? { ...item, [field]: value } : item));
    setResults(null);
  }

  async function run() {
    if (busy || disabled) return;
    const submitted = { ...program };
    if (!submitted.source?.trim()) { setError('Add code to the selected frame first.'); return; }
    const encoder = new TextEncoder();
    if (cases.some((item) => encoder.encode(item.stdin).length > 8192 || item.stdin.includes('\0') ||
        encoder.encode(item.expectedOutput).length > 16_384)) {
      setError('Each input must be at most 8 KiB without NUL characters; expected output must be at most 16 KiB.');
      return;
    }
    setBusy(true); onBusy(true); setError(''); setResults(null);
    const outcomes = [];
    try {
      for (const item of cases) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        try {
          const response = await apiFetch('/api/run', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: submitted.source, stdin: item.stdin }), signal: controller.signal,
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? `Runner returned HTTP ${response.status}.`);
          outcomes.push({ ...item, actualStatus: data.status, actualOutput: data.stdout,
            diagnostics: data.diagnostics, passed: data.status === item.expectedStatus &&
              (!item.checkOutput || data.stdout === item.expectedOutput) });
        } finally { clearTimeout(timer); }
      }
      setResults({ signature, outcomes });
    } catch (caught) {
      setError(caught.name === 'AbortError' ? 'A case timed out waiting for the API.' : caught.message);
      setResults({ signature, outcomes });
    } finally { setBusy(false); onBusy(false); }
  }

  const stale = results && results.signature !== signature;
  return <section className="test-cases" aria-label="Multiple input cases">
    <h3>Input cases</h3>
    <p className="panel-help">Run the selected board program once per case. Set the outcome you expect, including an intentional compiler or runtime issue. Output comparisons are exact, including newlines. Cases stay in this browser session.</p>
    {cases.map((item) => <div className="test-case-editor" key={item.id}>
      <label className="field-label" htmlFor={`case-name-${item.id}`}>CASE NAME</label>
      <input id={`case-name-${item.id}`} value={item.name} maxLength={60} disabled={busy} onChange={(event) => change(item.id, 'name', event.target.value)} />
      <label className="field-label" htmlFor={`case-input-${item.id}`}>INPUT · EOF AFTER LAST CHARACTER</label>
      <textarea id={`case-input-${item.id}`} value={item.stdin} disabled={busy} placeholder="Empty input sends EOF immediately" onChange={(event) => change(item.id, 'stdin', event.target.value)} />
      <label className="field-label" htmlFor={`case-status-${item.id}`}>EXPECTED OUTCOME</label>
      <select id={`case-status-${item.id}`} value={item.expectedStatus} disabled={busy} onChange={(event) => change(item.id, 'expectedStatus', event.target.value)}>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <label className="case-check"><input type="checkbox" checked={item.checkOutput} disabled={busy} onChange={(event) => change(item.id, 'checkOutput', event.target.checked)} /> Compare stdout exactly</label>
      {item.checkOutput && <><label className="field-label" htmlFor={`case-output-${item.id}`}>EXPECTED STDOUT</label><textarea id={`case-output-${item.id}`} value={item.expectedOutput} disabled={busy} onChange={(event) => change(item.id, 'expectedOutput', event.target.value)} /></>}
      {cases.length > 1 && <button className="quiet-button" disabled={busy} onClick={() => { setCases(cases.filter((entry) => entry.id !== item.id)); setResults(null); }}>Remove case</button>}
    </div>)}
    <div className="case-actions"><button className="quiet-button" disabled={busy || cases.length >= MAX_CASES} onClick={() => { setCases([...cases, emptyCase(nextId)]); setNextId(nextId + 1); setResults(null); }}>Add case</button><button className="quiet-button" disabled={disabled || busy} onClick={run}>{busy ? 'Running cases…' : `Run ${cases.length} case${cases.length === 1 ? '' : 's'}`}</button></div>
    {error && <div className="error-notice" role="alert">{error}</div>}
    {stale && <p className="stale-notice">The board changed. Run these cases again for the current code.</p>}
    {results && <ol className="case-results">{results.outcomes.map((item) => <li key={item.id} className={item.passed && !stale ? 'passed' : 'failed'}>
      <strong>{item.passed && !stale ? '✓' : '!'} {item.name || `Case ${item.id}`}</strong>
      <span>Expected {statuses.find(([value]) => value === item.expectedStatus)?.[1]}; got {statuses.find(([value]) => value === item.actualStatus)?.[1] ?? item.actualStatus}.</span>
      {item.checkOutput && <span>Stdout {item.actualOutput === item.expectedOutput ? 'matched' : 'differed'}.</span>}
      <pre>{item.actualOutput || '(no output)'}</pre>
      {item.diagnostics?.length > 0 && <p>{item.diagnostics.map((diagnostic) => diagnostic.message).join(' · ')}</p>}
    </li>)}</ol>}
  </section>;
}
