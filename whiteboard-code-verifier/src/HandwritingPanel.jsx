import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { captureHandwriting } from './capture.js';
import { extractProgram } from './board.js';
import { handwritingChannels, inkFingerprint, makeReviewDraft, reviewedProgram } from './handwriting.js';
import { apiFetch, readApiJson } from './api.js';
import { languagePayload } from './languages.js';

const HandwritingPanel = forwardRef(function HandwritingPanel({
  api, frameId, fingerprint, configuration, hasInk, language = 'c',
  busy, onBusy, onConfirm, onInvalidate, confirmedOcr, onConfirmInput,
}, ref) {
  const [draft, setDraft] = useState(null);
  const [scanMode, setScanMode] = useState('all');
  const [error, setError] = useState('');
  const [diagnostic, setDiagnostic] = useState(null);
  const [selected, setSelected] = useState({ channel: 'code', index: 0 });
  const [acknowledged, setAcknowledged] = useState(false);
  const controller = useRef(null);
  const inFlight = useRef(false);
  const stale = draft && draft.frameId === frameId && draft.fingerprint !== fingerprint;
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { setDraft(null); setAcknowledged(false); setError(''); setDiagnostic(null); }, [language]);

  async function read(mode = 'all') {
    if (inFlight.current || busy || !api || !hasInk) return;
    setScanMode(mode);
    setError('');
    setDiagnostic(null);
    if (!configuration?.available) {
      setError(configuration?.message ?? 'The OCR service is unavailable. Check the API.');
      return;
    }
    inFlight.current = true;
    onBusy(true);
    if (mode === 'all') onInvalidate();
    setDraft(null);
    setAcknowledged(false);
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 75_000);
    try {
      // Excalidraw mutates strokes in place. Freeze the image and its signature together.
      const snapshot = structuredClone(api.getSceneElements());
      const snapshotFingerprint = inkFingerprint(snapshot, frameId);
      let typed = extractProgram(snapshot, frameId);
      const codeFingerprint = inkFingerprint(snapshot, frameId, ['code']);
      const channels = handwritingChannels(snapshot, frameId);
      const previous = confirmedOcr?.frameId === frameId && confirmedOcr.codeFingerprint === codeFingerprint &&
        (confirmedOcr.language ?? 'c') === language ? confirmedOcr : null;
      if (mode === 'stdin') {
        if (!channels.stdin) throw new Error('Write input with the blue “Pen: input” inside the selected frame first.');
        // Reuse only code that was reviewed against these exact black strokes.
        if (previous) typed = previous.program;
        else if (channels.code) typed = { ...typed, source: '', lineMap: [] };
      }
      const captures = await captureHandwriting(api, snapshot, frameId, mode === 'stdin' ? ['stdin'] : ['code', 'stdin']);
      const response = await apiFetch('/api/ocr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
        body: JSON.stringify({ ...Object.fromEntries(Object.entries(captures).map(([channel, capture]) => [channel, capture.dataUrl])), ...languagePayload(language) }),
      });
      const recognition = await readApiJson(response);
      if (!response.ok) {
        setDiagnostic(recognition.diagnostic ?? null);
        throw new Error(recognition.error ?? `OCR returned HTTP ${response.status}.`);
      }
      setDraft({ ...makeReviewDraft(recognition, captures, typed, snapshotFingerprint, frameId),
        mode, codeFingerprint, codeConfirmedAt: mode === 'stdin' ? (previous?.codeConfirmedAt ?? previous?.confirmedAt) : undefined });
      setSelected({ channel: mode === 'stdin' ? 'stdin' : 'code', index: 0 });
    } catch (caught) {
      if (caught.diagnostic) setDiagnostic(caught.diagnostic);
      if (caught.name === 'AbortError') setDiagnostic({ provider: 'gemini', reason: 'browser_timeout', quotaStatus: 'unknown' });
      setError(caught.name === 'AbortError' ? 'Handwriting recognition timed out. Gemini token/quota status is unknown. Nothing was executed.' : caught.message);
    } finally {
      clearTimeout(timeout);
      inFlight.current = false;
      controller.current = null;
      onBusy(false);
    }
  }
  useImperativeHandle(ref, () => ({ read: () => read(), readInput: () => read('stdin') }));

  function edit(channel, transform) {
    setDraft((previous) => ({ ...previous, [channel]: transform(previous[channel]) }));
    setAcknowledged(false);
    if (draft.mode !== 'stdin') onInvalidate();
  }

  function confirm(saveCase = false) {
    if (!draft || stale || !acknowledged || busy) return;
    try {
      const stdin = draft.stdin.map(line => line.text).join('\n');
      if (stdin.includes('\0') || new TextEncoder().encode(stdin).length > 8192) throw new Error('Input must be at most 8 KiB and contain no NUL characters.');
      const program = draft.mode === 'stdin' && !draft.code.length ? null : reviewedProgram(draft);
      const confirmed = program ? { frameId, fingerprint, codeFingerprint: draft.codeFingerprint,
        codeConfirmedAt: draft.codeConfirmedAt, language, program: { ...program, language }, raw: draft.raw,
        reviewed: { code: draft.code.map((line) => line.text), stdin: draft.stdin.map((line) => line.text) },
        confirmedAt: new Date().toISOString() } : null;
      if (draft.mode === 'stdin') onConfirmInput(confirmed, stdin, saveCase);
      else onConfirm(confirmed);
      setError('');
    } catch (caught) { setError(caught.message); }
  }

  return <section className="handwriting-panel" aria-label="Handwriting recognition and review">
    <h3>{scanMode === 'stdin' ? 'Scan input. Keep the code.' : 'Read the ink. Check the code.'}</h3>
    <p className="panel-help">{scanMode === 'stdin' ? 'Scan input sends only blue input ink from this frame to Gemini. Review it before using it. Previously confirmed code is preserved.' : 'Read sends black and blue ink from this frame to Google Gemini. Review every line before compiling. Other annotation colors stay out of the images.'}</p>
    <button className="ocr-read-button" onClick={() => read(scanMode)} disabled={!api || !hasInk || !configuration?.available || busy}>{busy ? 'Reading handwriting…' : scanMode === 'stdin' ? 'Scan input again' : 'Read handwriting'}</button>
    {!configuration?.available && <div className="runner-notice">{configuration?.message ?? 'Checking OCR configuration…'}</div>}
    {!hasInk && <p className="panel-help">Write with “Pen: code” or “Pen: input”, then use “Select code & input” in the top bar and drag around your writing.</p>}
    {error && <div className="error-notice" role="alert">{error}</div>}
    {error && diagnostic && <details className="raw-output"><summary>Gemini OCR diagnostics</summary>
      <pre>{JSON.stringify(diagnostic, null, 2)}</pre>
      <p>Token usage logs describe individual requests; remaining account quota is not returned here.</p>
      <a href="https://aistudio.google.com/usage" target="_blank" rel="noreferrer">Check Gemini usage and limits in AI Studio</a>
    </details>}
    {stale && <div className="stale-notice">The ink changed. Read the frame again before confirming.</div>}
    {draft && draft.frameId === frameId && <>
      <p className="ocr-provenance">{draft.raw.provider} · {draft.raw.model} · {draft.raw.durationMs} ms</p>
      <p className="panel-help">“Check” marks model-reported ambiguity, not a measured confidence score. Compare the text with the captured image; text-only recognition does not provide line locations.</p>
      {(draft.mode === 'stdin' ? ['stdin'] : ['code', 'stdin']).map((channel) => <div className="ocr-channel" key={channel}>
        <h4>{channel === 'code' ? 'Code or algorithm' : 'Standard input'}</h4>
        {draft.captures[channel] && <div className="ocr-preview-scroll"><div className="ocr-preview">
          <img src={draft.captures[channel].dataUrl} alt={channel === 'code' ? 'Captured code handwriting' : 'Captured input handwriting'} />
          {selected.channel === channel && draft[channel][selected.index]?.box && <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"><rect
            x={draft[channel][selected.index].box[1]} y={draft[channel][selected.index].box[0]}
            width={draft[channel][selected.index].box[3] - draft[channel][selected.index].box[1]}
            height={draft[channel][selected.index].box[2] - draft[channel][selected.index].box[0]}
          /></svg>}
        </div></div>}
        {!draft.captures[channel] && <p className="panel-help">Typed text preserved directly; OCR was not used for this channel.</p>}
        <ol className="ocr-lines">{draft[channel].map((line, index) => <li key={index} className={line.uncertain ? 'uncertain-line' : ''}>
          <div className="ocr-line-editor"><span>{index + 1}</span><input
            aria-label={`${channel === 'code' ? 'Code' : 'Input'} line ${index + 1}`}
            value={line.text} spellCheck={false} disabled={Boolean(stale) || busy}
            onFocus={() => setSelected({ channel, index })}
            onChange={(event) => edit(channel, (lines) => lines.map((item, at) => at === index ? { ...item, text: event.target.value } : item))}
          /><button aria-label={`Insert ${channel} line after ${index + 1}`} disabled={Boolean(stale) || busy} onClick={() => {
            edit(channel, (lines) => [...lines.slice(0, index + 1), { text: '', box: null, location: null, uncertain: false, alternatives: [] }, ...lines.slice(index + 1)]);
            setSelected({ channel, index: index + 1 });
          }}>+</button><button aria-label={`Remove ${channel} line ${index + 1}`} disabled={Boolean(stale) || busy} onClick={() => edit(channel, (lines) => lines.filter((_, at) => at !== index))}>×</button></div>
          {line.uncertain && <span className="ocr-uncertain-label">Check this line</span>}
          {line.alternatives.length > 0 && <details><summary>Other readings</summary>{line.alternatives.map((alternative, at) => <button key={at} disabled={Boolean(stale) || busy} onClick={() => edit(channel, (lines) => lines.map((item, pos) => pos === index ? { ...item, text: alternative } : item))}><code>{alternative}</code></button>)}</details>}
        </li>)}</ol>
        <button className="ocr-add-line" disabled={Boolean(stale) || busy} onClick={() => edit(channel, (lines) => [...lines, { text: '', box: null, location: null, uncertain: false, alternatives: [] }])}>+ Add line</button>
      </div>)}
      <label className="ocr-confirm-check"><input type="checkbox" checked={acknowledged} disabled={Boolean(stale) || busy} onChange={(event) => setAcknowledged(event.target.checked)} />{draft.mode === 'stdin' ? 'I checked the input against the handwriting.' : 'I checked the code and input against the handwriting.'}</label>
      {draft.mode === 'stdin' ? <>
        <button className="ocr-confirm-button" disabled={!acknowledged || Boolean(stale) || busy || !draft.code.length} onClick={() => confirm(false)}>Use input for next run</button>
        <button className="quiet-button" disabled={!acknowledged || Boolean(stale) || busy} onClick={() => confirm(true)}>Save input as test case</button>
        <p className="panel-help">Scan new blue input for each run, or save scans as separate cases in this browser. Code is preserved. {!draft.code.length && 'Read and confirm the code before using input for a run.'}</p>
      </> : <button className="ocr-confirm-button" disabled={!acknowledged || Boolean(stale) || busy} onClick={() => confirm()}>Use confirmed code</button>}
      <p className="panel-help">Confirmation keeps the original ink. Use the run button at your selected pseudocode level to compile.</p>
    </>}
  </section>;
});

export default HandwritingPanel;
