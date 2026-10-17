import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, restoreElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { CODE_COLOR, INPUT_COLOR, extractProgram, framesIn, isOverlay, programSignature } from './board.js';
import { addHandwritingFrame, clearOverlays, fitProgramFrame, focusSourceLine, lessonScene, replaceChannel, resizeProgramFrame, showDiagnostics } from './canvas.js';
import { handwritingChannels, inkFingerprint } from './handwriting.js';
import HandwritingPanel from './HandwritingPanel.jsx';
import { lessons } from './lessons.js';
import { libraries } from './libraries.js';
import { PSEUDOCODE_LEVELS, preparePseudocode } from './pseudocode.js';
import FrameControls from './FrameControls.jsx';
import WorkspaceLayout from './WorkspaceLayout.jsx';
import SnapshotHistory from './SnapshotHistory.jsx';
import TestCases from './TestCases.jsx';
import './styles.css';

const labels = {
  success: 'Program completed', compile_error: 'Check the syntax', runtime_error: 'A runtime issue surfaced',
  timeout: 'Time limit reached', output_limit: 'Output limit reached', invalid_source: 'Check the source',
};
const EMPTY_PROGRAM = { source: '', stdin: '', codeIds: [], inputIds: [], lineMap: [] };

function Icon({ name, size = 18 }) {
  const paths = {
    play: <path d="m8 5 11 7-11 7Z" />,
    board: <><rect x="3" y="3" width="18" height="14" rx="2" /><path d="m8 21 4-4 4 4M8 8h8M8 12h5" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" /></>,
    upload: <><path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4" /></>,
    arrow: <path d="m9 5 7 7-7 7" />,
    check: <path d="m5 12 4 4L19 6" />,
    code: <><path d="m7 7-5 5 5 5m10-10 5 5-5 5m-3-14-4 22" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.code}</svg>;
}

function MemoryDiagram({ stdout }) {
  const pointer = stdout.match(/^Pointer on stack: (0x[\da-f]+)$/im)?.[1];
  const buffer = stdout.match(/^Buffer address: (0x[\da-f]+)$/im)?.[1];
  if (!pointer || !buffer) return null;
  return <figure className="memory-diagram" aria-label="Memory addresses printed by the program">
    <figcaption className="eyebrow">MEMORY IN THIS RUN</figcaption>
    <div className="memory-location"><span>STACK · POINTER VARIABLE</span><code>{pointer}</code><small>The address of <code>values</code></small></div>
    <div className="memory-link" aria-hidden="true">↓ points to</div>
    <div className="memory-location allocation"><span>DYNAMIC STORAGE · BUFFER</span><code>{buffer}</code><small>The address returned by <code>malloc</code></small></div>
    <p>Addresses are printed by this program. Sanitizers change allocation layout; these are not glibc region classifications.</p>
  </figure>;
}

function App() {
  const initial = useMemo(() => lessonScene(lessons[0]), []);
  const [api, setApi] = useState(null);
  const [elements, setElements] = useState(initial);
  const [frameId, setFrameId] = useState('lesson-frame');
  const [lessonId, setLessonId] = useState('sum');
  const [tab, setTab] = useState('output');
  const [health, setHealth] = useState(null);
  const [ocrHealth, setOcrHealth] = useState(null);
  const [reading, setReading] = useState(false);
  const [confirmedOcr, setConfirmedOcr] = useState(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [librarySources, setLibrarySources] = useState({});
  const [libraryFile, setLibraryFile] = useState('stack.h');
  const [panelVisible, setPanelVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [snapshotRevision, setSnapshotRevision] = useState(0);
  const [pseudoLevel, setPseudoLevel] = useState(1);
  const [pseudoDraft, setPseudoDraft] = useState(null);
  const upload = useRef(null);
  const ocrPanel = useRef(null);
  const currentSignature = useRef('');
  const controller = useRef(null);
  const frames = useMemo(() => framesIn(elements), [elements]);
  const typedProgram = useMemo(() => extractProgram(elements, frameId), [elements, frameId]);
  const inkChannels = useMemo(() => handwritingChannels(elements, frameId), [elements, frameId]);
  const hasInk = inkChannels.code || inkChannels.stdin;
  const fingerprint = useMemo(() => inkFingerprint(elements, frameId), [elements, frameId]);
  const recognizedProgram = confirmedOcr?.frameId === frameId && confirmedOcr.fingerprint === fingerprint ? confirmedOcr.program : null;
  const program = hasInk ? recognizedProgram ?? EMPTY_PROGRAM : typedProgram;
  const signature = programSignature(program, frameId);
  currentSignature.current = signature;
  const stale = result && result.signature !== signature;
  const lesson = lessons.find((item) => item.id === lessonId);
  const selectedFrame = frames.find((frame) => frame.id === frameId);
  const library = libraries.find((item) => item.file === libraryFile);
  const refreshCanvas = useCallback(() => api?.refresh(), [api]);

  const checkHealth = useCallback(async () => {
    try {
      const response = await fetch('/api/health');
      if (!response.ok) throw new Error('API unavailable');
      const data = await response.json();
      setHealth(data.runner);
      setOcrHealth(data.ocr);
    } catch {
      setHealth({ available: false, message: 'Start the API with npm run dev or npm start.' });
      setOcrHealth({ available: false, message: 'Start the API to connect handwriting recognition.' });
    }
  }, []);
  useEffect(() => { checkHealth(); }, [checkHealth]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const changed = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  useEffect(() => {
    if (api && stale && api.getSceneElements().some(isOverlay)) clearOverlays(api);
  }, [api, stale, signature]);

  const onChange = useCallback((next) => {
    // The scene array and stroke objects can retain their identities while being edited.
    setElements([...next]);
    const nextFrames = framesIn(next);
    setFrameId((previous) => nextFrames.some((el) => el.id === previous) ? previous : (nextFrames[0]?.id ?? ''));
  }, []);

  function chooseLesson(id) {
    if (!api) return;
    const next = lessonScene(lessons.find((item) => item.id === id));
    api.updateScene({ elements: next });
    api.scrollToContent(next, { fitToContent: true, maxZoom: 1 });
    setFrameId('lesson-frame');
    setLessonId(id);
    setConfirmedOcr(null);
    setResult(null);
    setPseudoDraft(null);
    setError('');
    setNotice('Lesson loaded. Download your board before switching lessons to keep edits.');
  }

  async function run() {
    if (!api || running || reading || (pseudoDraft && pseudoDraft.originalSignature === signature)) return;
    setError('');
    setNotice('');
    setPanelVisible(true);
    const liveElements = api.getSceneElements();
    const liveChannels = handwritingChannels(liveElements, frameId);
    const liveHasInk = liveChannels.code || liveChannels.stdin;
    const liveFingerprint = inkFingerprint(liveElements, frameId);
    if (liveHasInk && (confirmedOcr?.frameId !== frameId || confirmedOcr.fingerprint !== liveFingerprint)) {
      setTab('handwriting');
      ocrPanel.current?.read();
      return;
    }
    const liveProgram = liveHasInk ? confirmedOcr.program : extractProgram(liveElements, frameId);
    if (!liveProgram.source.trim()) { setError('Add black text inside a frame, or edit the source below.'); return; }
    setRunning(true);
    setResult(null);
    setTab('output');
    clearOverlays(api);
    const submittedSignature = programSignature(liveProgram, frameId);
    const submitted = { ...liveProgram };
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 30_000);
    try {
      const response = await fetch('/api/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: submitted.source, stdin: submitted.stdin }), signal: abort.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `Runner returned HTTP ${response.status}.`);
      setResult({ ...data, signature: submittedSignature, source: submitted.source, stdin: submitted.stdin });
      if (currentSignature.current === submittedSignature) showDiagnostics(api, data.diagnostics, submitted.lineMap);
      checkHealth();
    } catch (caught) {
      setError(caught.name === 'AbortError' ? 'The request timed out. Check the API and try again.' : caught.message);
      checkHealth();
    } finally { clearTimeout(timeout); setRunning(false); controller.current = null; }
  }

  function preparePseudo() {
    if (!api || hasInk || !program.source.trim()) return;
    const prepared = preparePseudocode(program.source, pseudoLevel);
    setPseudoDraft({ ...prepared, originalSignature: signature });
    setError('');
    setNotice('Review and edit the proposed C. Use it on the board before running.');
  }

  function usePseudoDraft() {
    if (!pseudoDraft || pseudoDraft.originalSignature !== signature || !pseudoDraft.source.trim() || hasInk) return;
    replaceChannel(api, frameId, program.codeIds, pseudoDraft.source, CODE_COLOR);
    setPseudoDraft(null);
    setResult(null);
    setNotice('Prepared C is on the board. Verify & run will compile exactly this source.');
  }

  function boardScene() {
    const current = structuredClone(api.getSceneElements().filter((el) => !isOverlay(el)));
    const reviewed = confirmedOcr?.frameId === frameId && confirmedOcr.fingerprint === inkFingerprint(current, frameId) ? confirmedOcr : null;
    const channels = handwritingChannels(current, frameId);
    const currentProgram = channels.code || channels.stdin ? reviewed?.program : extractProgram(current, frameId);
    return {
      type: 'excalidraw', version: 2, source: 'boardroom',
      elements: current,
      appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: api.getFiles(),
      verifier: { frameId, result: currentProgram && result?.signature === programSignature(currentProgram, frameId) ? result : null,
        ocr: reviewed },
    };
  }

  function download() {
    const snapshot = boardScene();
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `boardroom-${new Date().toISOString().replace(/[:.]/g, '-')}.excalidraw`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('Board downloaded with its scene and current run result.');
  }

  async function saveSnapshot() {
    if (!api || savingSnapshot || running || reading) return;
    const scene = boardScene();
    const channels = handwritingChannels(scene.elements, frameId);
    if ((channels.code || channels.stdin) && !scene.verifier.ocr) {
      setError('Review and confirm the current handwriting before saving a snapshot.');
      setPanelVisible(true); setTab('handwriting'); return;
    }
    setSavingSnapshot(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: selectedFrame?.name || lesson?.title || 'Lesson', scene }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not save the lesson snapshot.');
      setPanelVisible(true);
      setNotice(`Snapshot saved: ${data.id}${data.commit ? ` · Git ${data.commit.slice(0, 8)}` : ''}`);
      if (data.warning) setError(data.warning);
      else { setSnapshotRevision((revision) => revision + 1); setTab('history'); }
    } catch (caught) { setPanelVisible(true); setError(caught.message); }
    finally { setSavingSnapshot(false); }
  }

  function restoreBoard(data) {
    if (data.type !== 'excalidraw' || !Array.isArray(data.elements) || data.elements.length > 2000) throw new Error('Choose an Excalidraw scene with at most 2,000 elements.');
    const restored = restoreElements(data.elements.filter((el) => !isOverlay(el)), null);
    const nextFrames = framesIn(restored);
    if (!nextFrames.length) throw new Error('This board needs a frame. Create one in Excalidraw before importing.');
    const nextFrameId = nextFrames.some((frame) => frame.id === data.verifier?.frameId) ? data.verifier.frameId : nextFrames[0].id;
    api.updateScene({ elements: restored });
    if (data.files) api.addFiles(Object.values(data.files));
    api.scrollToContent(restored, { fitToContent: true, maxZoom: 1 });
    setFrameId(nextFrameId); setLessonId(''); setConfirmedOcr(null); setResult(null); setPseudoDraft(null); setError('');
    const channels = handwritingChannels(restored, nextFrameId);
    return channels.code || channels.stdin;
  }

  async function importBoard(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !api) return;
    try {
      if (file.size > 2_000_000) throw new Error('Choose a board smaller than 2 MB.');
      const data = JSON.parse(await file.text());
      restoreBoard(data);
      setNotice('Board imported. Run it to verify the current code.');
    } catch (caught) { setError(`Could not import: ${caught.message}`); }
  }

  async function viewLibrary(file = libraryFile) {
    setTab('library');
    setLibraryFile(file);
    if (librarySources[file]) return;
    try {
      const response = await fetch(`/api/library/${file}`);
      if (!response.ok) throw new Error(`Could not load ${file}. Check the API.`);
      const source = await response.text();
      setLibrarySources((previous) => ({ ...previous, [file]: source }));
    } catch (caught) { setError(caught.message); }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { setError('Fullscreen is unavailable in this browser. The workspace still fills the browser window.'); }
  }

  function focusDiagnostic(diagnostic) {
    focusSourceLine(api, program.lineMap[diagnostic.line - 1]);
  }

  function newHandwrittenBoard() {
    if (!api || reading || running) return;
    setFrameId(addHandwritingFrame(api));
    setLessonId('');
    setConfirmedOcr(null);
    setResult(null);
    setPseudoDraft(null);
    setError('');
    setNotice('Write inside the new frame. Black ink is code; blue ink is program input.');
    setTab('handwriting');
  }

  function selectPen(color) {
    if (!api) return;
    api.updateScene({ appState: { currentItemStrokeColor: color } });
    api.setActiveTool({ type: 'freedraw' });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Boardroom home"><span className="brand-mark"><Icon name="board" size={23} /></span><span>boardroom<span className="brand-dot">.</span></span></a>
        <div className="project-name"><span className="small-divider" />Whiteboard Code Verifier<span className="tag">EARLY BUILD</span></div>
        <div className="header-actions">
          <button className="quiet-button" aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={toggleFullscreen}>⛶ <span>{fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</span></button>
          <button className="quiet-button" aria-pressed={!panelVisible} onClick={() => setPanelVisible((visible) => !visible)}>{panelVisible ? 'Hide panel' : 'Show panel'}</button>
          <button className="quiet-button" aria-label="Save lesson snapshot" onClick={saveSnapshot}
            disabled={!api || !frameId || running || reading || savingSnapshot || !program.source.trim() || (hasInk && !recognizedProgram)}
            title={hasInk && !recognizedProgram ? 'Confirm the handwriting before saving.' : 'Save board, source, and input with local Git history.'}>
            <Icon name="board" /><span>{savingSnapshot ? 'Saving…' : 'Snapshot'}</span></button>
          <button className="quiet-button" onClick={() => upload.current.click()} disabled={!api || running || reading}><Icon name="upload" /> <span>Open board</span></button>
          <button className="quiet-button" onClick={download} disabled={!api}><Icon name="download" /><span>Download</span></button>
          <input ref={upload} type="file" accept=".excalidraw,.json" hidden onChange={importBoard} />
        </div>
      </header>

      <main>
        <div className="workspace-bar">
          <div className="board-title"><Icon name="board" /><span>Lesson board</span><span className="tag subtle">C11</span></div>
          <label className="lesson-select"><span>Start with a lesson</span><select aria-label="Demo lesson" value={lessonId} disabled={running || reading || !api} onChange={(event) => chooseLesson(event.target.value)}>{!lessonId && <option value="">Custom board</option>}{lessons.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        </div>

        <WorkspaceLayout focused={!panelVisible} onResize={refreshCanvas}>
          <section className="board-pane" aria-label="Interactive lesson whiteboard">
            <div className="handwriting-tools">
              <button onClick={newHandwrittenBoard} disabled={!api || reading || running}>+ New handwritten board</button>
              <button onClick={() => selectPen(CODE_COLOR)} disabled={!api || reading || running}><i className="ink code-ink" />Pen: code</button>
              <button onClick={() => selectPen(INPUT_COLOR)} disabled={!api || reading || running}><i className="ink input-ink" />Pen: input</button>
            </div>
            <FrameControls frame={selectedFrame} disabled={running || reading}
              onResize={(width, height) => resizeProgramFrame(api, frameId, width, height)}
              onFit={() => fitProgramFrame(api, frameId)} />
            <div className="canvas-container"><Excalidraw
              initialData={{ elements: initial, appState: { viewBackgroundColor: '#ffffff', currentItemFontFamily: 3, currentItemStrokeColor: CODE_COLOR }, scrollToContent: true }}
              excalidrawAPI={setApi} onChange={onChange} theme="light" name="Boardroom lesson"
              UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false } }}
            /></div>
            <div className="canvas-footer"><span><i className="ink code-ink" />Black = code</span><span><i className="ink input-ink" />Blue = stdin</span><span className="annotation-key">Other colors = your annotations</span><button onClick={() => api && clearOverlays(api)} disabled={!api}>Clear highlights</button></div>
          </section>

          <aside className="inspector" aria-label="Verification controls and results" hidden={!panelVisible}>
            <div className="run-heading"><div><span className="eyebrow">THE REALITY CHECK</span><h2>Run this lesson</h2></div><span className={`connection ${health?.available ? 'online' : ''}`} title={health?.message ?? 'Checking runner'}><i />{health ? (health.available ? 'Runner ready' : 'Runner offline') : 'Connecting'}</span></div>
            <label className="field-label" htmlFor="program-frame">PROGRAM FRAME</label>
            <select id="program-frame" className="frame-select" value={frameId} disabled={running || reading} onChange={(event) => setFrameId(event.target.value)}>{!frames.length && <option value="">Create a frame on the board</option>}{frames.map((frame) => <option key={frame.id} value={frame.id}>{frame.name || 'Untitled program'}</option>)}</select>
            <p className="lesson-description">{lesson?.description ?? 'Black text in the selected frame becomes your program. Blue text becomes its input.'}</p>
            <button className="run-button" onClick={run} disabled={running || reading || !api || !frameId || Boolean(pseudoDraft && pseudoDraft.originalSignature === signature)}><span className={running || reading ? 'spinner' : ''}>{!running && !reading && <Icon name="play" size={18} />}</span>{reading ? 'Reading handwriting…' : running ? 'Compiling & running…' : pseudoDraft && pseudoDraft.originalSignature === signature ? 'Review pseudocode draft' : hasInk && !recognizedProgram ? 'Read & review handwriting' : 'Verify & run'}{!running && !reading && <span className="run-button-hint">C →</span>}</button>
            {hasInk && <p className="handwriting-state">{recognizedProgram ? 'Handwriting reviewed. Ready to compile.' : 'Handwriting needs recognition and teacher confirmation.'}</p>}
            {health && !health.available && <div className="runner-notice"><span>{health.message}</span><button onClick={checkHealth}>Check again</button></div>}
            {error && <div className="error-notice" role="alert">{error}</div>}
            {notice && <p className="notice" role="status">{notice}</p>}
            <div className="result-tabs" role="tablist" aria-label="Run details">{[['output', 'Output'], ['handwriting', 'Handwriting'], ['source', 'Source & input'], ['cases', 'Cases'], ['library', 'Libraries'], ['history', 'History']].map(([id, label]) => <button key={id} id={`tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`panel-${id}`} onClick={() => id === 'library' ? viewLibrary() : setTab(id)}>{label}</button>)}</div>

            <div className="result-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
              <div hidden={tab !== 'handwriting'}><HandwritingPanel ref={ocrPanel}
                api={api} frameId={frameId} fingerprint={fingerprint}
                configuration={ocrHealth} hasInk={hasInk}
                busy={reading || running} onBusy={setReading} onInvalidate={() => setConfirmedOcr(null)}
                onConfirm={(confirmed) => {
                  setConfirmedOcr(confirmed); setResult(null); setTab('source');
                  setNotice('Transcription confirmed. Verify & run will compile exactly this reviewed code.');
                }}
              /></div>
              <div hidden={tab !== 'cases'}><TestCases program={program} signature={signature}
                disabled={running || reading || !api || !frameId || !program.source.trim() || Boolean(pseudoDraft && pseudoDraft.originalSignature === signature)} onBusy={setRunning} /></div>
              {tab === 'history' && <SnapshotHistory key={snapshotRevision} onOpen={(scene) => {
                const ink = restoreBoard(scene);
                setTab(ink ? 'handwriting' : 'source');
                setNotice(ink ? 'Saved board opened. Review its handwriting again before running. The confirmed source is also stored in board.c.' : 'Saved board opened. Run it to verify the saved code.');
              }} />}
              {tab === 'output' && <>
                {stale && <div className="stale-notice">The board changed. Run again to update these results.</div>}
                {!result && !running && <div className="empty-state"><div className="terminal-glyph">&gt;_</div><h3>Let the code do the talking.</h3><p>Output and line-by-line diagnostics will appear here after a run.</p><span>GCC · AddressSanitizer · UBSan</span></div>}
                {running && <div className="empty-state" role="status"><div className="terminal-glyph">…</div><h3>Testing the lesson</h3><p>Compiling C and checking the run in an isolated container.</p></div>}
                {result && <div aria-live="polite"><div className={`result-status ${result.status === 'success' ? 'passed' : 'failed'}`}><span>{result.status === 'success' ? '✓' : '!'}</span><strong>{labels[result.status] ?? result.status}</strong><small>{result.durationMs} ms</small></div>
                  <div className="terminal"><div className="terminal-title"><span>STDOUT</span><span>exit {result.exitCode ?? '—'}</span></div><pre>{result.stdout || '(no output)'}</pre></div>
                  <MemoryDiagram stdout={result.stdout} />
                  {result.diagnostics.length > 0 && <div className="diagnostics"><h3>What the tools found</h3>{result.diagnostics.map((diagnostic, index) => <button key={index} className={`diagnostic ${diagnostic.severity}`} disabled={Boolean(stale)} onClick={() => focusDiagnostic(diagnostic)}><span className="line-number">L{diagnostic.line}</span><span><b>{diagnostic.kind} · {diagnostic.severity}</b>{diagnostic.message}</span><Icon name="arrow" size={14} /></button>)}</div>}
                  {result.notes.map((note) => <article className="teaching-note" key={note.title}><span className="eyebrow">TEACHING NOTE</span><h3>{note.title}</h3><p>{note.body}</p></article>)}
                  {(result.stderr || result.compilerOutput) && <details className="raw-output"><summary>Full compiler & runtime messages</summary><pre>{[result.compilerOutput, result.stderr].filter(Boolean).join('\n')}</pre></details>}
                </div>}
              </>}
              {tab === 'source' && <div className="source-panel">
                <p className="panel-help">{hasInk ? 'Review changes in the Handwriting tab. The original strokes stay on the board.' : 'Edit here or use the canvas text tool. Changes here replace the selected frame’s black or blue text.'}</p>
                <label className="field-label" htmlFor="source-editor">CONFIRMED SOURCE · {program.lineMap.length} LINES</label>
                <textarea id="source-editor" className="code-editor" value={program.source} spellCheck={false} readOnly={hasInk} disabled={running || reading || !frameId} onChange={(event) => { if (!hasInk) { setPseudoDraft(null); replaceChannel(api, frameId, program.codeIds, event.target.value, CODE_COLOR); } }} />
                <div className="pseudocode-panel" aria-label="Pseudocode mode">
                  <h3>Pseudocode mode</h3>
                  <p className="panel-help">Each level adds more help. Prepare a draft, check every change, then place the C on the board. Nothing runs during preparation.</p>
                  <label className="field-label" htmlFor="pseudocode-level">CORRECTION LEVEL</label>
                  <select id="pseudocode-level" className="frame-select" value={pseudoLevel} disabled={running || reading || hasInk} onChange={(event) => setPseudoLevel(Number(event.target.value))}>{PSEUDOCODE_LEVELS.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}</select>
                  <button className="quiet-button" onClick={preparePseudo} disabled={running || reading || hasInk || !program.source.trim()}>Prepare pseudocode</button>
                  {hasInk && <p className="panel-help">Pseudocode mode currently edits typed code. Keep handwriting in the review flow.</p>}
                  {pseudoDraft && <div className="pseudocode-review">
                    {pseudoDraft.originalSignature !== signature && <p className="error-notice" role="alert">The board changed. Prepare a new draft before using it.</p>}
                    <label className="field-label" htmlFor="pseudocode-draft">PROPOSED C · REVIEW AND EDIT</label>
                    <textarea id="pseudocode-draft" className="code-editor" spellCheck={false} value={pseudoDraft.source} disabled={running || reading || pseudoDraft.originalSignature !== signature} onChange={(event) => setPseudoDraft({ ...pseudoDraft, source: event.target.value })} />
                    {pseudoDraft.issues.length > 0 && <div className="pseudocode-issues"><strong>Check before running:</strong><ul>{pseudoDraft.issues.map((issue, index) => <li key={index}>Original line {issue.line}: {issue.message}</li>)}</ul></div>}
                    <p className="panel-help">Using this draft replaces the selected frame’s black text. Save or download the original board first if you want to keep it.</p>
                    <button className="quiet-button" onClick={usePseudoDraft} disabled={running || reading || hasInk || pseudoDraft.originalSignature !== signature || !pseudoDraft.source.trim()}>Use prepared code</button>
                    <button className="quiet-button" onClick={() => setPseudoDraft(null)}>Discard draft</button>
                  </div>}
                </div>
                <label className="field-label" htmlFor="stdin-editor">STANDARD INPUT · BLUE INK</label>
                <textarea id="stdin-editor" className="input-editor" value={program.stdin} spellCheck={false} readOnly={hasInk} placeholder="No input: the program receives EOF." disabled={running || reading || !frameId} onChange={(event) => { if (!hasInk) { setPseudoDraft(null); replaceChannel(api, frameId, program.inputIds, event.target.value, INPUT_COLOR); } }} />
                <span className="panel-help">{hasInk ? 'Compiler diagnostics map to approximate regions of the reviewed handwriting.' : 'Handwritten code uses the pen controls and a review step before execution.'}</span>
              </div>}
              {tab === 'library' && <div className="library-panel">
                <label className="field-label" htmlFor="library-select">CURATED C LIBRARIES</label>
                <select id="library-select" className="frame-select" value={libraryFile} onChange={(event) => viewLibrary(event.target.value)}>{libraries.map((item) => <option key={item.file} value={item.file}>{item.title} · {item.file}</option>)}</select>
                <h3>{library.title}</h3><p className="panel-help">{library.description}</p>
                <p className="library-methods">{library.methods}</p>
                <p className="panel-help">Include with <code>#include &lt;{libraryFile}&gt;</code>. These are project-provided teaching headers compiled by the runner.</p>
                <button className="quiet-button" disabled={running || reading || !api} onClick={() => { chooseLesson(library.lessonId); setTab('source'); }}>Load example on board</button>
                <pre className="library-source">{librarySources[libraryFile] || `Loading ${libraryFile}…`}</pre>
              </div>}
            </div>
          </aside>
        </WorkspaceLayout>
      </main>
    </div>
  );
}

async function mount() {
  // Measure program text with its actual font; fallback metrics clip long lines.
  await document.fonts.load('18px Cascadia').catch(() => {});
  createRoot(document.getElementById('root')).render(<App />);
}
mount();
