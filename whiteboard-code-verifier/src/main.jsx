import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, restoreElements, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { CODE_COLOR, INPUT_COLOR, extractProgram, framesIn, isOverlay, programSignature } from './board.js';
import { addHandwritingFrame, createRegionFrame, describeRegion, fitProgramFrame, inkBounds, lessonScene, replaceChannel, resizeProgramFrame } from './canvas.js';
import { handwritingChannels, inkFingerprint } from './handwriting.js';
import HandwritingPanel from './HandwritingPanel.jsx';
import CodeEditor from './CodeEditor.jsx';
import SnippetBuilder from './SnippetBuilder.jsx';
import { composeSource, loadSnippetMode, loadTemplate, saveSnippetMode, saveTemplate } from './template.js';
import { lessons } from './lessons.js';
import { libraries } from './libraries.js';
import FrameControls from './FrameControls.jsx';
import WorkspaceLayout from './WorkspaceLayout.jsx';
import SnapshotHistory from './SnapshotHistory.jsx';
import './styles.css';

const labels = {
  success: 'Program completed', compile_error: 'Check the syntax', runtime_error: 'A runtime issue surfaced',
  timeout: 'Time limit reached', output_limit: 'Output limit reached', invalid_source: 'Check the source',
};
const EMPTY_PROGRAM = { source: '', stdin: '', codeIds: [], inputIds: [], lineMap: [] };
const MINIMUM_REGION = 24;

function Icon({ name, size = 18 }) {
  const paths = {
    play: <path d="m8 5 11 7-11 7Z" />,
    board: <><rect x="3" y="3" width="18" height="14" rx="2" /><path d="m8 21 4-4 4 4M8 8h8M8 12h5" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" /></>,
    upload: <><path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4" /></>,
    arrow: <path d="m9 5 7 7-7 7" />,
    check: <path d="m5 12 4 4L19 6" />,
    code: <><path d="m7 7-5 5 5 5m10-10 5 5-5 5m-3-14-4 22" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    region: <><rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 3" /><path d="m13 13 6 6" /></>,
    page: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
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

const boxBetween = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

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
  const [edited, setEdited] = useState(null);
  const [editedBase, setEditedBase] = useState('');
  const [snippetMode, setSnippetMode] = useState(loadSnippetMode);
  const [template, setTemplate] = useState(loadTemplate);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [regionMode, setRegionMode] = useState(false);
  const [draftBox, setDraftBox] = useState(null);
  const [selection, setSelection] = useState(null);
  const [pendingRead, setPendingRead] = useState(null);
  const upload = useRef(null);
  const ocrPanel = useRef(null);
  const editorRef = useRef(null);
  const regionLayer = useRef(null);
  const regionDrag = useRef(null);
  const controller = useRef(null);
  const frames = useMemo(() => framesIn(elements), [elements]);
  const typedProgram = useMemo(() => extractProgram(elements, frameId), [elements, frameId]);
  const inkChannels = useMemo(() => handwritingChannels(elements, frameId), [elements, frameId]);
  const hasInk = inkChannels.code || inkChannels.stdin;
  const fingerprint = useMemo(() => inkFingerprint(elements, frameId), [elements, frameId]);
  const recognizedProgram = confirmedOcr?.frameId === frameId && confirmedOcr.fingerprint === fingerprint ? confirmedOcr.program : null;
  const program = hasInk ? recognizedProgram ?? EMPTY_PROGRAM : typedProgram;
  const signature = programSignature(program, frameId);
  // The board supplies a snippet or a full program; the editor holds the exact text that runs.
  const composed = composeSource(program.source, template, snippetMode);
  const runSource = edited ?? composed.source;
  const boardMovedOn = edited !== null && composed.source !== editedBase;
  const stale = result && (result.source !== runSource || result.stdin !== program.stdin);
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
    if (!regionMode) return undefined;
    const leave = (event) => { if (event.key === 'Escape') cancelRegion(); };
    window.addEventListener('keydown', leave);
    return () => window.removeEventListener('keydown', leave);
  }, [regionMode]);
  // A new region is selected one render before React sees its ink, so reading waits for both.
  useEffect(() => {
    if (pendingRead && frameId === pendingRead && hasInk && ocrPanel.current && !reading) {
      setPendingRead(null);
      ocrPanel.current.read();
    }
  }, [pendingRead, frameId, hasInk, reading]);

  const onChange = useCallback((next) => {
    // The scene array and stroke objects can retain their identities while being edited.
    setElements([...next]);
    const nextFrames = framesIn(next);
    setFrameId((previous) => nextFrames.some((el) => el.id === previous) ? previous : (nextFrames[0]?.id ?? ''));
  }, []);

  function resetWork() {
    setConfirmedOcr(null);
    setResult(null);
    setError('');
    setEdited(null);
  }

  function chooseLesson(id) {
    if (!api) return;
    const next = lessonScene(lessons.find((item) => item.id === id));
    api.updateScene({ elements: next });
    api.scrollToContent(next, { fitToContent: true, maxZoom: 1 });
    setFrameId('lesson-frame');
    setLessonId(id);
    resetWork();
    setNotice('Lesson loaded. Download your board before switching lessons to keep edits.');
  }

  function changeFrame(id) {
    setFrameId(id);
    setEdited(null);
  }

  function editCode(value) {
    if (value === composed.source) { setEdited(null); return; }
    if (edited === null) setEditedBase(composed.source);
    setEdited(value);
  }

  async function run() {
    if (!api || running || reading) return;
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
    const submittedSource = edited ?? composeSource(liveProgram.source, template, snippetMode).source;
    if (!submittedSource.trim()) { setError('Add black text inside a frame, or type code in the editor below.'); return; }
    setRunning(true);
    setResult(null);
    setTab('output');
    const submittedSignature = programSignature(liveProgram, frameId);
    const submittedStdin = liveProgram.stdin;
    const submittedEdited = edited !== null;
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 30_000);
    try {
      const response = await fetch('/api/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: submittedSource, stdin: submittedStdin }), signal: abort.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `Runner returned HTTP ${response.status}.`);
      setResult({ ...data, signature: submittedSignature, source: submittedSource, stdin: submittedStdin, edited: submittedEdited });
      checkHealth();
    } catch (caught) {
      setError(caught.name === 'AbortError' ? 'The request timed out. Check the API and try again.' : caught.message);
      checkHealth();
    } finally { clearTimeout(timeout); setRunning(false); controller.current = null; }
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
      verifier: { frameId, result: currentProgram && !result?.edited && result?.signature === programSignature(currentProgram, frameId) ? result : null,
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
    setFrameId(nextFrameId); setLessonId(''); resetWork();
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
    editorRef.current?.focusLine(diagnostic.line);
  }

  function newHandwrittenBoard() {
    if (!api || reading || running) return;
    cancelRegion();
    setFrameId(addHandwritingFrame(api));
    setLessonId('');
    resetWork();
    setNotice('Write inside the new frame. Black ink is code; blue ink is program input.');
    setTab('handwriting');
  }

  function selectPen(color) {
    if (!api) return;
    cancelRegion();
    api.updateScene({ appState: { currentItemStrokeColor: color } });
    api.setActiveTool({ type: 'freedraw' });
  }

  function startRegion() {
    if (!api || reading || running) return;
    setRegionMode(true);
    setSelection(null);
    setDraftBox(null);
  }

  function cancelRegion() {
    regionDrag.current = null;
    setRegionMode(false);
    setSelection(null);
    setDraftBox(null);
  }

  function regionPoint(event) {
    const rect = regionLayer.current.getBoundingClientRect();
    return { x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width), y: Math.min(Math.max(event.clientY - rect.top, 0), rect.height) };
  }

  function finishRegionDrag(event) {
    if (!regionDrag.current) return;
    const box = boxBetween(regionDrag.current, regionPoint(event));
    regionDrag.current = null;
    if (box.w < MINIMUM_REGION || box.h < MINIMUM_REGION) { setDraftBox(null); return; }
    const layer = regionLayer.current.getBoundingClientRect();
    const state = api.getAppState();
    const first = viewportCoordsToSceneCoords({ clientX: layer.left + box.x, clientY: layer.top + box.y }, state);
    const last = viewportCoordsToSceneCoords({ clientX: layer.left + box.x + box.w, clientY: layer.top + box.y + box.h }, state);
    const scene = { x: first.x, y: first.y, width: last.x - first.x, height: last.y - first.y };
    setDraftBox(box);
    setSelection({ box, scene, ...describeRegion(api, scene) });
  }

  // The region becomes the frame the program is taken from.
  function adoptFrame(created) {
    cancelRegion();
    setFrameId(created.id);
    setLessonId('');
    resetWork();
    if (created.strokes > 0) {
      setTab('handwriting');
      setPendingRead(created.id);
      setNotice('Reading the ink in this region. Review it before running.');
    } else {
      setTab('output');
      setNotice(created.texts ? 'Region selected. The typed text inside it is your program.' : 'That region is empty. Write inside it or choose another area.');
    }
  }

  function transcribeWholePage() {
    if (!api || reading || running) return;
    const rect = inkBounds(api);
    if (!rect) { setError('Write or type something on the board first.'); return; }
    setError('');
    adoptFrame(createRegionFrame(api, rect));
  }

  function applyTemplate(next) {
    setTemplate(next);
    saveTemplate(next);
    setSnippetMode(true);
    saveSnippetMode(true);
    setBuilderOpen(false);
    setNotice('Snippet mode is on. Your board text runs inside this template.');
  }

  function turnSnippetOff() {
    setSnippetMode(false);
    saveSnippetMode(false);
    setBuilderOpen(false);
    setNotice('Snippet mode is off. The board text runs exactly as written.');
  }

  const busy = running || reading;
  const lineCount = runSource ? runSource.split('\n').length : 0;
  const shownDiagnostics = result && !stale ? result.diagnostics : [];

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Boardroom home"><span className="brand-mark"><Icon name="board" size={23} /></span><span>boardroom<span className="brand-dot">.</span></span></a>
        <div className="project-name"><span className="small-divider" />Whiteboard Code Verifier<span className="tag">EARLY BUILD</span></div>
        <div className="header-actions">
          <button className="quiet-button" aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={toggleFullscreen}>⛶ <span>{fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</span></button>
          <button className="quiet-button" aria-pressed={!panelVisible} onClick={() => setPanelVisible((visible) => !visible)}>{panelVisible ? 'Hide panel' : 'Show panel'}</button>
          <button className="quiet-button" aria-label="Save lesson snapshot" onClick={saveSnapshot}
            disabled={!api || !frameId || busy || savingSnapshot || !program.source.trim() || (hasInk && !recognizedProgram)}
            title={hasInk && !recognizedProgram ? 'Confirm the handwriting before saving.' : 'Save board, source, and input with local Git history.'}>
            <Icon name="board" /><span>{savingSnapshot ? 'Saving…' : 'Snapshot'}</span></button>
          <button className="quiet-button" onClick={() => upload.current.click()} disabled={!api || busy}><Icon name="upload" /> <span>Open board</span></button>
          <button className="quiet-button" onClick={download} disabled={!api}><Icon name="download" /><span>Download</span></button>
          <input ref={upload} type="file" accept=".excalidraw,.json" hidden onChange={importBoard} />
        </div>
      </header>

      <main>
        <div className="workspace-bar">
          <div className="board-title"><Icon name="board" /><span>Lesson board</span><span className="tag subtle">C11</span></div>
          <label className="lesson-select"><span>Start with a lesson</span><select aria-label="Demo lesson" value={lessonId} disabled={busy || !api} onChange={(event) => chooseLesson(event.target.value)}>{!lessonId && <option value="">Custom board</option>}{lessons.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        </div>

        <div className="stage">
          <nav className="rail" aria-label="Board tools">
            <button aria-label="+ New handwritten board" onClick={newHandwrittenBoard} disabled={!api || busy}><Icon name="plus" size={20} /><span>New board</span></button>
            <button aria-label="Pen: code" onClick={() => selectPen(CODE_COLOR)} disabled={!api || busy}><i className="ink code-ink" /><span>Code pen</span></button>
            <button aria-label="Pen: input" onClick={() => selectPen(INPUT_COLOR)} disabled={!api || busy}><i className="ink input-ink" /><span>Input pen</span></button>
            <hr />
            <button aria-label="Select region" aria-pressed={regionMode} onClick={regionMode ? cancelRegion : startRegion} disabled={!api || busy}><Icon name="region" size={20} /><span>Region</span></button>
            <button aria-label="Transcribe whole page" onClick={transcribeWholePage} disabled={!api || busy}><Icon name="page" size={20} /><span>Whole page</span></button>
            <hr />
            <button aria-label="Snippet mode" aria-pressed={snippetMode} onClick={() => snippetMode ? turnSnippetOff() : setBuilderOpen(true)} disabled={!api}><Icon name="code" size={20} /><span>Snippet {snippetMode ? 'on' : 'off'}</span></button>
          </nav>

          <WorkspaceLayout focused={!panelVisible} onResize={refreshCanvas}>
            <section className="board-pane" aria-label="Interactive lesson whiteboard">
              <FrameControls frame={selectedFrame} disabled={busy}
                onResize={(width, height) => resizeProgramFrame(api, frameId, width, height)}
                onFit={() => fitProgramFrame(api, frameId)} />
              <div className="canvas-container"><Excalidraw
                initialData={{ elements: initial, appState: { viewBackgroundColor: '#ffffff', currentItemFontFamily: 3, currentItemStrokeColor: CODE_COLOR }, scrollToContent: true }}
                excalidrawAPI={setApi} onChange={onChange} theme="light" name="Boardroom lesson"
                UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false } }}
              />
                {regionMode && <div className="region-layer" ref={regionLayer} data-testid="region-layer"
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    regionDrag.current = regionPoint(event);
                    setSelection(null);
                    setDraftBox({ ...regionDrag.current, w: 0, h: 0 });
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => { if (regionDrag.current) setDraftBox(boxBetween(regionDrag.current, regionPoint(event))); }}
                  onPointerUp={finishRegionDrag}
                  onLostPointerCapture={() => { regionDrag.current = null; }}>
                  {draftBox && <div className="region-box" style={{ left: draftBox.x, top: draftBox.y, width: draftBox.w, height: draftBox.h }} />}
                </div>}
                {regionMode && <div className="region-bar" role="group" aria-label="Region selection">
                  {!selection && <p>Drag a box around the code to transcribe. Arrows, flowcharts and notes outside it are left out.</p>}
                  {selection && <p><b>Region selected.</b> {selection.strokes} pen stroke{selection.strokes === 1 ? '' : 's'} and {selection.texts} text block{selection.texts === 1 ? '' : 's'} inside. Anything outside stays out of the program.</p>}
                  <div className="region-actions">
                    <button className="run-button region-go" disabled={!selection || (!selection.strokes && !selection.texts)} onClick={() => adoptFrame(createRegionFrame(api, selection.scene))}>{selection?.strokes ? 'Transcribe selection' : 'Use selection'}</button>
                    <button className="quiet-button" onClick={cancelRegion}>Cancel</button>
                  </div>
                </div>}
              </div>
              <div className="canvas-footer"><span><i className="ink code-ink" />Black = code</span><span><i className="ink input-ink" />Blue = stdin</span><span className="annotation-key">Other colors = your annotations</span></div>
            </section>

            <aside className="dock" aria-label="Code, verification controls and results" hidden={!panelVisible}>
              <div className="dock-head">
                <div className="dock-frame"><label className="field-label" htmlFor="program-frame">PROGRAM FRAME</label>
                  <select id="program-frame" className="frame-select" value={frameId} title={lesson?.description} disabled={busy} onChange={(event) => changeFrame(event.target.value)}>{!frames.length && <option value="">Create a frame on the board</option>}{frames.map((frame) => <option key={frame.id} value={frame.id}>{frame.name || 'Untitled program'}</option>)}</select></div>
                <span className={`connection ${health?.available ? 'online' : ''}`} title={health?.message ?? 'Checking runner'}><i />{health ? (health.available ? 'Runner ready' : 'Runner offline') : 'Connecting'}</span>
                <button className="run-button" onClick={run} disabled={busy || !api || !frameId}><span className={busy ? 'spinner' : ''}>{!busy && <Icon name="play" size={18} />}</span>{reading ? 'Reading handwriting…' : running ? 'Compiling & running…' : hasInk && !recognizedProgram ? 'Read & review handwriting' : 'Verify & run'}{!busy && <span className="run-button-hint">C →</span>}</button>
              </div>
              {(error || notice || hasInk || (health && !health.available)) && <div className="dock-notices">
                {hasInk && <p className="handwriting-state">{recognizedProgram ? 'Handwriting reviewed. Ready to compile.' : 'Handwriting needs recognition and teacher confirmation.'}</p>}
                {health && !health.available && <div className="runner-notice"><span>{health.message}</span><button onClick={checkHealth}>Check again</button></div>}
                {error && <div className="error-notice" role="alert">{error}</div>}
                {notice && <p className="notice" role="status">{notice}</p>}
              </div>}

              <div className="dock-body">
                <div className="dock-code">
                  <div className="code-heading">
                    <label className="field-label" htmlFor="source-editor">CODE THAT RUNS · {lineCount} LINES</label>
                    <span className="code-badges">
                      {snippetMode && <button className="badge" onClick={() => setBuilderOpen(true)} title="Open the template builder">{composed.skipped ? 'Snippet mode · has main()' : 'Snippet mode · template'}</button>}
                      {edited !== null && <button className="badge edited" onClick={() => setEdited(null)} title="Discard your edits and use the board's version">Edited by hand · reset</button>}
                    </span>
                  </div>
                  {boardMovedOn && <p className="code-note">The board changed after your edits. Reset to pick up the board's version.</p>}
                  {composed.skipped && <p className="code-note">Your text already declares main(), so it runs as a full program, not inside the template.</p>}
                  <CodeEditor id="source-editor" ref={editorRef} value={runSource} onChange={editCode}
                    diagnostics={shownDiagnostics} disabled={busy}
                    placeholder={hasInk && !recognizedProgram ? 'Confirmed handwriting appears here. You can also type code directly.' : 'Type C here, or write it on the board.'} />
                  <label className="field-label" htmlFor="stdin-editor">STANDARD INPUT · BLUE INK</label>
                  <textarea id="stdin-editor" className="input-editor" value={program.stdin} spellCheck={false} readOnly={hasInk}
                    placeholder="No input: the program receives EOF." disabled={busy || !frameId}
                    onChange={(event) => !hasInk && replaceChannel(api, frameId, program.inputIds, event.target.value, INPUT_COLOR)} />
                </div>

                <div className="dock-side">
                  <div className="result-tabs" role="tablist" aria-label="Run details">{[['output', 'Output'], ['handwriting', 'Handwriting'], ['library', 'Libraries'], ['history', 'History']].map(([id, label]) => <button key={id} id={`tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`panel-${id}`} onClick={() => id === 'library' ? viewLibrary() : setTab(id)}>{label}</button>)}</div>
                  <div className="result-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
                    <div hidden={tab !== 'handwriting'}><HandwritingPanel ref={ocrPanel}
                      api={api} frameId={frameId} fingerprint={fingerprint}
                      configuration={ocrHealth} hasInk={hasInk}
                      busy={busy} onBusy={setReading} onInvalidate={() => setConfirmedOcr(null)}
                      onConfirm={(confirmed) => {
                        setConfirmedOcr(confirmed); setResult(null); setTab('output');
                        setNotice('Transcription confirmed. Verify & run will compile exactly this reviewed code.');
                      }}
                    /></div>
                    {tab === 'history' && <SnapshotHistory key={snapshotRevision} onOpen={(scene) => {
                      const ink = restoreBoard(scene);
                      setTab(ink ? 'handwriting' : 'output');
                      setNotice(ink ? 'Saved board opened. Review its handwriting again before running. The confirmed source is also stored in board.c.' : 'Saved board opened. Run it to verify the saved code.');
                    }} />}
                    {tab === 'output' && <>
                      {stale && <div className="stale-notice">{edited !== null ? 'The code changed. Run again to update these results.' : 'The board changed. Run again to update these results.'}</div>}
                      {!result && !running && <div className="empty-state"><div className="terminal-glyph">&gt;_</div><h3>Let the code do the talking.</h3><p>Output appears here. Errors are underlined in the code on the left.</p><span>GCC · AddressSanitizer · UBSan</span></div>}
                      {running && <div className="empty-state" role="status"><div className="terminal-glyph">…</div><h3>Testing the lesson</h3><p>Compiling C and checking the run in an isolated container.</p></div>}
                      {result && <div aria-live="polite"><div className={`result-status ${result.status === 'success' ? 'passed' : 'failed'}`}><span>{result.status === 'success' ? '✓' : '!'}</span><strong>{labels[result.status] ?? result.status}</strong><small>{result.durationMs} ms</small></div>
                        <div className="terminal"><div className="terminal-title"><span>STDOUT</span><span>exit {result.exitCode ?? '—'}</span></div><pre>{result.stdout || '(no output)'}</pre></div>
                        <MemoryDiagram stdout={result.stdout} />
                        {result.diagnostics.length > 0 && <div className="diagnostics"><h3>What the tools found</h3>{result.diagnostics.map((diagnostic, index) => <button key={index} className={`diagnostic ${diagnostic.severity}`} disabled={Boolean(stale)} onClick={() => focusDiagnostic(diagnostic)}><span className="line-number">L{diagnostic.line}</span><span><b>{diagnostic.kind} · {diagnostic.severity}</b>{diagnostic.message}</span><Icon name="arrow" size={14} /></button>)}</div>}
                        {result.notes.map((note) => <article className="teaching-note" key={note.title}><span className="eyebrow">TEACHING NOTE</span><h3>{note.title}</h3><p>{note.body}</p></article>)}
                        {(result.stderr || result.compilerOutput) && <details className="raw-output"><summary>Full compiler & runtime messages</summary><pre>{[result.compilerOutput, result.stderr].filter(Boolean).join('\n')}</pre></details>}
                      </div>}
                    </>}
                    {tab === 'library' && <div className="library-panel">
                      <label className="field-label" htmlFor="library-select">CURATED C LIBRARIES</label>
                      <select id="library-select" className="frame-select" value={libraryFile} onChange={(event) => viewLibrary(event.target.value)}>{libraries.map((item) => <option key={item.file} value={item.file}>{item.title} · {item.file}</option>)}</select>
                      <h3>{library.title}</h3><p className="panel-help">{library.description}</p>
                      <p className="library-methods">{library.methods}</p>
                      <p className="panel-help">Include with <code>#include &lt;{libraryFile}&gt;</code>. These are project-provided teaching headers compiled by the runner.</p>
                      <button className="quiet-button" disabled={busy || !api} onClick={() => { chooseLesson(library.lessonId); setTab('output'); }}>Load example on board</button>
                      <pre className="library-source">{librarySources[libraryFile] || `Loading ${libraryFile}…`}</pre>
                    </div>}
                  </div>
                </div>
              </div>
            </aside>
          </WorkspaceLayout>
        </div>
      </main>
      <SnippetBuilder open={builderOpen} template={template} snippet={program.source} enabled={snippetMode}
        onApply={applyTemplate} onTurnOff={turnSnippetOff} onClose={() => setBuilderOpen(false)} />
    </div>
  );
}

async function mount() {
  // Measure program text with its actual font; fallback metrics clip long lines.
  await document.fonts.load('18px Cascadia').catch(() => {});
  createRoot(document.getElementById('root')).render(<App />);
}
mount();
