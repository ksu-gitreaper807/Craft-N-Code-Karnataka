import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { apiFetch, readApiJson } from './api.js';
import { languagePayload } from './languages.js';

import { MAX_CASES, CASE_STATUSES as statuses, emptyCase, suiteKey, validateSuite, compareOutput } from './test-cases.js';

const TestCases = forwardRef(function TestCases({ program, signature, disabled, onBusy, captureScene, onCompiled }, ref) {
  const language = program.language ?? 'c';
  const [cases, setCases] = useState(() => {
    try {
      const saved = localStorage.getItem(suiteKey(language));
      return saved ? validateSuite(JSON.parse(saved), language) : [emptyCase(1)];
    } catch { return [emptyCase(1)]; }
  });
  const [nextId, setNextId] = useState(() => cases.length + 1);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [storageWarning, setStorageWarning] = useState('');
  const controller = useRef(null);
  const canceled = useRef(false);
  const upload = useRef(null);
  useEffect(() => {
    try { localStorage.setItem(suiteKey(language), JSON.stringify({ version: 1, language, cases })); setStorageWarning(''); }
    catch { setStorageWarning('Browser storage is unavailable or full. Export this suite to keep it.'); }
  }, [cases, language]);
  useEffect(() => () => controller.current?.abort(), []);

  useImperativeHandle(ref, () => ({
    addInput(stdin) {
      if (busy) throw new Error('Wait for the current cases to finish.');
      const pristine = cases.length === 1 && JSON.stringify(cases[0]) === JSON.stringify(emptyCase(cases[0].id));
      if (!pristine && cases.length >= MAX_CASES) throw new Error(`This suite already has ${MAX_CASES} cases. Remove a case before saving another scan.`);
      const item = { ...emptyCase(nextId), name: `Scanned input ${nextId}`, stdin };
      const updated = pristine ? [item] : [...cases, item];
      validateSuite({ version: 1, language, cases: updated }, language);
      setCases(updated); setNextId(nextId + 1); setResults(null); setError('');
    },
  }));

  async function importSuite(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('Suite files must be at most 1 MiB.');
      const imported = validateSuite(JSON.parse(await file.text()), language);
      setCases(imported); setNextId(imported.length + 1); setResults(null); setError('');
    } catch (caught) { setError(`Could not import suite: ${caught.message}`); }
  }
  function exportSuite() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, language, cases }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `boardroom-${language === 'python' ? 'python' : 'cpp'}-cases.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function change(id, field, value) {
    setCases((previous) => previous.map((item) => item.id === id ? { ...item, [field]: value } : item));
    setResults(null);
  }

  async function run() {
    if (busy || disabled) return;
    const submitted = { ...program };
    if (!submitted.source?.trim()) { setError('Add code to the selected frame first.'); return; }
    try { validateSuite({ version: 1, language, cases }, language); }
    catch (caught) { setError(caught.message); return; }
    canceled.current = false;
    setBusy(true); onBusy(true); setError(''); setResults(null);
    const outcomes = [];
    try {
      for (const item of cases) {
        if (canceled.current) break;
        const requestController = new AbortController();
        controller.current = requestController;
        const timer = setTimeout(() => requestController.abort(), 30_000);
        try {
          const scene = captureScene();
          const response = await apiFetch('/api/run', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: submitted.source, stdin: item.stdin, ...languagePayload(submitted.language) }), signal: requestController.signal,
          });
          const data = await readApiJson(response);
          if (!response.ok) throw new Error(data.error ?? `Runner returned HTTP ${response.status}.`);
          const comparison = compareOutput(item.expectedOutput, data.stdout, item.comparison);
          outcomes.push({ ...item, actualStatus: data.status, actualOutput: data.stdout, actualStderr: data.stderr, compilerOutput: data.compilerOutput, durationMs: data.durationMs, comparisonResult: comparison,
            diagnostics: data.diagnostics, passed: data.status === item.expectedStatus &&
              (!item.checkOutput || comparison.matched) });
          clearTimeout(timer);
          controller.current = null;
          setResults({ signature, outcomes: [...outcomes] });
          await onCompiled(scene, { ...submitted, stdin: item.stdin }, data);
        } finally { clearTimeout(timer); }
      }
      setResults({ signature, outcomes });
      if (canceled.current) setError('Case run stopped. Completed results are shown below.');
    } catch (caught) {
      setError(canceled.current ? 'Case run stopped. Completed results are shown below.' : caught.name === 'AbortError' ? 'A case timed out waiting for the API.' : caught.message);
      setResults({ signature, outcomes });
    } finally { controller.current = null; setBusy(false); onBusy(false); }
  }

  const stale = results && results.signature !== signature;
  return <section className="test-cases" aria-label="Multiple input cases">
    <h3>Input cases</h3>
    <p className="panel-help">Run the selected board program once per case. Set the outcome you expect, including an intentional compiler or runtime issue. Output comparisons are exact by default, including newlines. Suites are saved in this browser separately for C++ and Python; export them to share or back them up.</p>
    <div className="case-actions"><button className="quiet-button" disabled={busy} onClick={() => upload.current.click()}>Import suite</button><button className="quiet-button" disabled={busy} onClick={exportSuite}>Export suite</button></div>
    <input ref={upload} aria-label="Import test suite file" type="file" accept=".json,application/json" hidden onChange={importSuite} />
    {storageWarning && <p role="status" className="panel-help">{storageWarning}</p>}
    {cases.map((item) => <div className="test-case-editor" key={item.id}>
      <label className="field-label" htmlFor={`case-name-${item.id}`}>CASE NAME</label>
      <input id={`case-name-${item.id}`} value={item.name} maxLength={60} disabled={busy} onChange={(event) => change(item.id, 'name', event.target.value)} />
      <label className="field-label" htmlFor={`case-input-${item.id}`}>INPUT · EOF AFTER LAST CHARACTER</label>
      <textarea id={`case-input-${item.id}`} value={item.stdin} disabled={busy} placeholder="Empty input sends EOF immediately" onChange={(event) => change(item.id, 'stdin', event.target.value)} />
      <label className="field-label" htmlFor={`case-status-${item.id}`}>EXPECTED OUTCOME</label>
      <select id={`case-status-${item.id}`} value={item.expectedStatus} disabled={busy} onChange={(event) => change(item.id, 'expectedStatus', event.target.value)}>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <label className="case-check"><input type="checkbox" checked={item.checkOutput} disabled={busy} onChange={(event) => change(item.id, 'checkOutput', event.target.checked)} /> Compare stdout</label>
      {item.checkOutput && <><label className="field-label" htmlFor={`case-comparison-${item.id}`}>OUTPUT COMPARISON</label><select id={`case-comparison-${item.id}`} value={item.comparison} disabled={busy} onChange={event => change(item.id, 'comparison', event.target.value)}><option value="exact">Exact characters</option><option value="trim">Ignore surrounding whitespace</option><option value="whitespace">Ignore whitespace differences</option></select><label className="field-label" htmlFor={`case-output-${item.id}`}>EXPECTED STDOUT</label><textarea id={`case-output-${item.id}`} value={item.expectedOutput} disabled={busy} onChange={(event) => change(item.id, 'expectedOutput', event.target.value)} /></>}
      {cases.length > 1 && <button className="quiet-button" disabled={busy} onClick={() => { setCases(cases.filter((entry) => entry.id !== item.id)); setResults(null); }}>Remove case</button>}
    </div>)}
    <div className="case-actions"><button className="quiet-button" disabled={busy || cases.length >= MAX_CASES} onClick={() => { setCases([...cases, emptyCase(nextId)]); setNextId(nextId + 1); setResults(null); }}>Add case</button><button className="quiet-button" disabled={disabled || busy} onClick={run}>{busy ? 'Running cases…' : `Run ${cases.length} case${cases.length === 1 ? '' : 's'}`}</button>{busy && <button className="quiet-button" onClick={() => { canceled.current = true; controller.current?.abort(); }}>Stop cases</button>}</div>
    {error && <div className="error-notice" role="alert">{error}</div>}
    {stale && <p className="stale-notice">The board changed. Run these cases again for the current code.</p>}
    {results && <p role="status" className="panel-help">{results.outcomes.filter(item => item.passed).length} / {results.outcomes.length} completed cases passed{stale ? ' · results are stale' : ''}.</p>}
    {results && <ol className="case-results">{results.outcomes.map((item) => <li key={item.id} className={item.passed && !stale ? 'passed' : 'failed'}>
      <strong>{item.passed && !stale ? '✓' : '!'} {item.name || `Case ${item.id}`}</strong>
      <span>Expected {statuses.find(([value]) => value === item.expectedStatus)?.[1]}; got {statuses.find(([value]) => value === item.actualStatus)?.[1] ?? item.actualStatus}.</span>
      {item.checkOutput && <span>Stdout {item.comparisonResult.matched ? 'matched' : 'differed'}.</span>}
      {item.checkOutput && <><span>Expected stdout</span><pre aria-label="Expected stdout">{JSON.stringify(item.expectedOutput)}</pre>
        {!item.comparisonResult.matched && <span>First difference in compared output at line {item.comparisonResult.line}, column {item.comparisonResult.column}: expected {item.comparisonResult.expected}, got {item.comparisonResult.actual}.</span>}</>}
      <span>Actual stdout · {item.durationMs ?? 0} ms</span><pre aria-label="Actual stdout">{item.actualOutput ? JSON.stringify(item.actualOutput) : '(no output)'}</pre>
      {item.actualStderr && <details><summary>Stderr</summary><pre>{item.actualStderr}</pre></details>}
      {item.compilerOutput && <details><summary>Compiler output</summary><pre>{item.compilerOutput}</pre></details>}
      {item.diagnostics?.length > 0 && <p>{item.diagnostics.map((diagnostic) => diagnostic.message).join(' · ')}</p>}
    </li>)}</ol>}
  </section>;
});

export default TestCases;
