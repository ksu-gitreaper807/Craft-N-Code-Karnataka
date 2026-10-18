import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, restoreElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { CODE_COLOR, INPUT_COLOR, extractProgram, framesIn, isOverlay, programSignature } from './board.js';
import { clearOverlays, createRegionFrame, fitProgramFrame, inkBounds, lessonScene, replaceChannel, resizeProgramFrame } from './canvas.js';
import { handwritingChannels, inkFingerprint } from './handwriting.js';
import HandwritingPanel from './HandwritingPanel.jsx';
import CodeEditor from './CodeEditor.jsx';
import SnippetBuilder from './SnippetBuilder.jsx';
import DrawToolbar from './DrawToolbar.jsx';
import { checkStructure, loadTemplate, saveTemplate, splitPreamble, templateBlock } from './template.js';
import { lessons } from './lessons.js';
import { composeBoardSource } from './linked-list-drawing.js';
import { libraries, standardLibraries } from './libraries.js';
import { CODE_MODES, PYTHON_CODE_MODES } from './pseudocode.js';
import { LANGUAGES, languageInfo, languagePayload, validLanguage } from './languages.js';
import FrameControls from './FrameControls.jsx';
import ProgramRegions from './ProgramRegions.jsx';
import WorkspaceLayout from './WorkspaceLayout.jsx';
import SnapshotHistory from './SnapshotHistory.jsx';
import TestCases from './TestCases.jsx';
import { readApiJson, apiFetch } from './api.js';
import stackHeader from '../runner/lib/stack.h?raw';
import listHeader from '../runner/lib/linked_list.h?raw';
import queueHeader from '../runner/lib/queue.h?raw';
import searchHeader from '../runner/lib/search.h?raw';
import './styles.css';

const libraryCatalog = [...libraries, ...standardLibraries];
const bundledHeaders = { 'stack.h': stackHeader, 'linked_list.h': listHeader, 'queue.h': queueHeader, 'search.h': searchHeader };

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
    region: <><rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 3" /><path d="m13 13 6 6" /></>,
    page: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
    save: <><path d="M5 4h12l2 2v14H5z" /><path d="M8 4v5h8V4M8 20v-6h8v6" /></>,
    panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>,
    zoomIn: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35M11 8v6M8 11h6" /></>,
    zoomOut: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35M8 11h6" /></>,
    fit: <><path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />,
    trash: <><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
    dual: <><rect x="2" y="3" width="9" height="18" rx="2" /><rect x="13" y="3" width="9" height="18" rx="2" /></>,
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
  const initial = useMemo(() => [], []);
  const [api, setApi] = useState(null);
  const [elements, setElements] = useState(initial);
  const [frameId, setFrameId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [language, setLanguage] = useState('c');
  const currentLanguage = useRef(language);
  currentLanguage.current = language;
  const healthRequest = useRef(0);
  const languageLabel = languageInfo(language).label;
  const codeModes = language === 'python' ? PYTHON_CODE_MODES : CODE_MODES;
  const [tab, setTab] = useState('output');
  const [health, setHealth] = useState(null);
  const [ocrHealth, setOcrHealth] = useState(null);
  const [snapshotAvailable, setSnapshotAvailable] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState('Connect the API to check lesson storage.');

  const [reading, setReading] = useState(false);
  const [confirmedOcr, setConfirmedOcr] = useState(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [librarySources, setLibrarySources] = useState({});
  const [libraryFile, setLibraryFile] = useState('stack.h');
  const [panelVisible, setPanelVisible] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [snapshotRevision, setSnapshotRevision] = useState(0);
  const [automaticSnapshot, setAutomaticSnapshot] = useState('');
  const [pseudoLevel, setPseudoLevel] = useState(1);
  const [pseudoDraft, setPseudoDraft] = useState(null);
  const [phase, setPhase] = useState('');
  const [geminiDiagnostic, setGeminiDiagnostic] = useState(null);
  const [edited, setEdited] = useState(null);
  const [editedBase, setEditedBase] = useState('');
  const snippetMode = pseudoLevel === 2;
  const mode = codeModes[pseudoLevel - 1];
  const [activeTool, setActiveToolState] = useState('selection');
  const [toolLocked, setToolLocked] = useState(false);
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('boardroom.theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } });
  const [template, setTemplate] = useState(loadTemplate);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [tabs, setTabs] = useState([{ id: 'tab-1', title: 'Board 1', elements: [] }]);
  const [activeTabId, setActiveTabId] = useState('tab-1');
  const [dualMode, setDualMode] = useState(false);
  const [secondaryTabId, setSecondaryTabId] = useState('');
  const [apiSecondary, setApiSecondary] = useState(null);
  const [secondaryElements, setSecondaryElements] = useState([]);
  const [focusedBoard, setFocusedBoard] = useState('primary'); // 'primary' | 'secondary'
  const [penColor, setPenColor] = useState(CODE_COLOR);
  const [pen, setPen] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [regionPending, setRegionPending] = useState(false);
  const selectingRegion = useRef(null);
  const upload = useRef(null);
  const ocrPanel = useRef(null);
  const casesPanel = useRef(null);
  const editorRef = useRef(null);
  const currentKey = useRef('');
  const currentFrameId = useRef(frameId);
  currentFrameId.current = frameId;
  const controller = useRef(null);
  const frames = useMemo(() => framesIn(elements), [elements]);
  const typedProgram = useMemo(() => extractProgram(elements, frameId), [elements, frameId]);
  const inkChannels = useMemo(() => handwritingChannels(elements, frameId), [elements, frameId]);
  const hasInk = inkChannels.code || inkChannels.stdin;
  const fingerprint = useMemo(() => inkFingerprint(elements, frameId), [elements, frameId]);
  const recognizedProgram = confirmedOcr?.frameId === frameId && confirmedOcr.fingerprint === fingerprint && (confirmedOcr.language ?? 'c') === language ? confirmedOcr.program : null;
  const codeReviewCurrent = confirmedOcr?.frameId === frameId && (confirmedOcr.language ?? 'c') === language &&
    confirmedOcr.codeFingerprint === inkFingerprint(elements, frameId, ['code']);
  const program = { ...(hasInk ? recognizedProgram ?? (codeReviewCurrent ? { ...confirmedOcr.program, stdin: '' } : EMPTY_PROGRAM) : typedProgram), language };
  const signature = programSignature(program, frameId);
  // The board supplies the writing; the editor holds the exact text that is compiled.
  const composed = composeBoardSource(program.source, template, snippetMode && language === 'c', language, pseudoLevel === 3);
  const runSource = edited ?? composed.source;
  const runKey = `${signature}\u0000${runSource}`;
  currentKey.current = runKey;
  const boardMovedOn = edited !== null && composed.source !== editedBase;
  const stale = result && (result.key !== runKey || result.level !== pseudoLevel);
  const currentDraft = pseudoDraft?.originalKey === runKey && pseudoDraft.level === pseudoLevel && (pseudoDraft.language ?? 'c') === language ? pseudoDraft : null;
  const casesNeedPreparedCode = pseudoLevel === 3 || (pseudoLevel === 2 && language === 'c' && !composed.drawing);
  const caseProgram = currentDraft && casesNeedPreparedCode ? { ...program, source: currentDraft.source, lineMap: [] } : { ...program, source: runSource };
  const shownDiagnostics = result && !stale && !result.transformed ? result.diagnostics : [];
  const lesson = lessons.find((item) => item.id === lessonId);
  const selectedFrame = frames.find((frame) => frame.id === frameId);
  const library = libraryCatalog.find((item) => item.file === libraryFile);
  const refreshCanvas = useCallback(() => api?.refresh(), [api]);
  const busy = running || reading;
  const lineCount = runSource ? runSource.split('\n').length : 0;

  const checkHealth = useCallback(async () => {
    const requestId = ++healthRequest.current;
    try {
      const response = await apiFetch(language === 'python' ? '/api/health?language=python' : '/api/health');
      if (!response.ok) {
        const data = await readApiJson(response).catch(() => ({}));
        throw new Error(data.error ?? (response.status === 404 ?
          'Boardroom API endpoint is missing. Set the Vercel Root Directory to whiteboard-code-verifier and redeploy.' :
          `Boardroom API returned HTTP ${response.status}.`));
      }
      const data = await readApiJson(response);
      if (requestId !== healthRequest.current || currentLanguage.current !== language) return;
      if (!data || typeof data.runner?.available !== 'boolean' || typeof data.ocr?.available !== 'boolean') throw new Error('Invalid API response');
      setSnapshotAvailable(data.snapshots?.available !== false);
      setSnapshotMessage(data.snapshots?.message ?? 'Lesson history is unavailable. You can download this board from the top bar.');
      setHealth(data.runner);
      setOcrHealth(data.ocr);
    } catch (caught) {
      if (requestId !== healthRequest.current || currentLanguage.current !== language) return;
      const local = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
      const message = caught.message && caught.message !== 'Failed to fetch' ? caught.message : local ? 'Boardroom API is offline. Start it with npm run dev or npm start.' :
        'This site has no Boardroom API connection. Board editing and downloads work; verification and handwriting recognition need the hosted API.';
      setSnapshotAvailable(false);
      setHealth({ available: false, message });
      setOcrHealth({ available: false, message });
    }
  }, [language]);
  useEffect(() => { checkHealth(); }, [checkHealth]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const changed = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  useEffect(() => {
    const leave = (event) => {
      if (event.key !== 'Escape' || builderOpen) return;
      if (selectingRegion.current) cancelRegion();
      setToolsOpen(false);
    };
    window.addEventListener('keydown', leave);
    return () => window.removeEventListener('keydown', leave);
  }, [builderOpen, api]);

  // Opening or closing the panel resizes the board, so bring the selected program back into view.
  const panelRendered = useRef(false);
  useEffect(() => {
    if (!panelRendered.current) { panelRendered.current = true; return undefined; }
    if (!api || !frameId) return undefined;
    let second;
    const first = setTimeout(() => { api.refresh(); second = setTimeout(() => fitProgramFrame(api, currentFrameId.current), 150); }, 500);
    return () => { clearTimeout(first); clearTimeout(second); };
  }, [panelVisible]);

  const onChange = useCallback((next, appState) => {
    if (appState?.activeTool?.type) setActiveToolState(appState.activeTool.type);
    // The scene array and stroke objects can retain their identities while being edited.
    setElements([...next]);
    const nextFrames = framesIn(next);
    const newRegion = selectingRegion.current && nextFrames.find((el) => !selectingRegion.current.has(el.id));
    if (newRegion) {
      selectingRegion.current = null;
      setRegionPending(false);
      setFrameId(newRegion.id);
      setEdited(null);
      setNotice('Region selected. Black writing is code; blue writing inside this region is stdin.');
    } else setFrameId((previous) => nextFrames.some((el) => el.id === previous) ? previous : (nextFrames[0]?.id ?? ''));
  }, []);

  function resetWork() {
    setConfirmedOcr(null);
    setResult(null);
    setPseudoDraft(null);
    setError('');
    setEdited(null);
  }

  function chooseLesson(id) {
    if (!api) return;
    const next = lessonScene(lessons.find((item) => item.id === id));
    selectingRegion.current = null;
    setRegionPending(false);
    api.updateScene({ elements: next });
    api.scrollToContent(next, { fitToContent: true, maxZoom: 1 });
    setFrameId('lesson-frame');
    setLessonId(id);
    setLanguage('c');
    resetWork();
    setNotice('Lesson loaded. Download your board before switching lessons to keep edits.');
  }

  function changeFrame(id) {
    setFrameId(id);
    setEdited(null);
    setFocusedBoard('primary');
    if (api) fitProgramFrame(api, id);
  }

  function editCode(value) {
    if (value === composed.source) { setEdited(null); return; }
    if (edited === null) setEditedBase(composed.source);
    setPseudoDraft(null);
    setEdited(value);
  }

  async function requestJson(path, body, timeoutMs) {
    const abort = new AbortController();
    controller.current = abort;
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const response = await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: abort.signal });
      const data = await readApiJson(response);
      if (!response.ok) {
        if (data.diagnostic) setGeminiDiagnostic(data.diagnostic);
        throw new Error(data.error ?? `API returned HTTP ${response.status}.`);
      }
      return data;
    } catch (caught) {
      if (caught.diagnostic) setGeminiDiagnostic(caught.diagnostic);
      throw caught;
    } finally { clearTimeout(timer); controller.current = null; }
  }

  function scanInput() {
    setPanelVisible(true); setToolsOpen(false); setTab('handwriting');
    ocrPanel.current?.readInput();
  }

  async function run() {
    if (!api || running || reading) return;
    setError('');
    setNotice('');
    setPanelVisible(true);
    setToolsOpen(false);
    const liveElements = api.getSceneElements();
    const liveChannels = handwritingChannels(liveElements, frameId);
    const liveHasInk = liveChannels.code || liveChannels.stdin;
    const liveFingerprint = inkFingerprint(liveElements, frameId);
    if (liveHasInk && (confirmedOcr?.frameId !== frameId || confirmedOcr.fingerprint !== liveFingerprint)) {
      setTab('handwriting');
      if (confirmedOcr?.frameId === frameId && confirmedOcr.codeFingerprint === inkFingerprint(liveElements, frameId, ['code']) && liveChannels.stdin) ocrPanel.current?.readInput();
      else ocrPanel.current?.read();
      return;
    }
    const liveProgram = { ...(liveHasInk ? confirmedOcr.program : extractProgram(liveElements, frameId)), language };
    const level = pseudoLevel;
    const prepared = composeBoardSource(liveProgram.source, template, level === 2 && language === 'c', language, level === 3);
    const submittedSource = edited ?? prepared.source;
    if (!submittedSource.trim()) { setError('Write code or an algorithm, select its region, or type it in the code editor.'); return; }
    setRunning(true);
    setResult(null);
    setPseudoDraft(null);
    setGeminiDiagnostic(null);
    setTab('output');
    const submittedSignature = programSignature(liveProgram, frameId);
    const submittedKey = `${submittedSignature}\u0000${submittedSource}`;
    const submitted = { ...liveProgram, source: submittedSource };
    const submittedEdited = edited !== null;
    let compiled = false;
    const boardUnchanged = () => {
      const scene = api.getSceneElements();
      const channels = handwritingChannels(scene, frameId);
      const ink = channels.code || channels.stdin;
      if (ink && confirmedOcr?.fingerprint !== inkFingerprint(scene, frameId)) return false;
      const live = { ...(ink ? confirmedOcr.program : extractProgram(scene, frameId)), language };
      return currentLanguage.current === language && currentKey.current === submittedKey && programSignature(live, frameId) === submittedSignature;
    };
    async function compile(source, transformed) {
      if (!boardUnchanged()) throw new Error('The board changed. Run again for the current selection; pending generated code was not executed.');
      const compilationScene = boardScene();
      setPhase('compiler');
      const data = await requestJson('/api/run', { source, stdin: submitted.stdin, ...languagePayload(language) }, 30_000);
      compiled = true;
      setResult({ ...data, signature: submittedSignature, key: submittedKey, source, stdin: submitted.stdin, transformed, level, edited: submittedEdited });
      await saveCompilationSnapshot(compilationScene, { source, stdin: submitted.stdin, language, level, kind: 'run', result: data });
      return data;
    }
    try {
      // C++ Snippet mode: Gemini only organizes the snippet into helpers and an entry point, on every run, before compiling.
      if (level === 2 && language === 'c' && (!prepared.drawing || edited !== null)) {
        setPhase('structure');
        const { preamble: context, body: snippet } = edited !== null ? splitPreamble(edited) : { preamble: templateBlock(template), body: liveProgram.source };
        let structured;
        try {
          structured = await requestJson('/api/pseudocode', { source: snippet, stdin: submitted.stdin, level: 2, structure: true, templateContext: context, ...languagePayload(language) }, 65_000);
        } catch (caught) {
          const reason = caught.name === 'AbortError' ? 'The request timed out.' : caught.message;
          throw new Error(`Gemini could not organize the snippet, so nothing was compiled. ${reason}`);
        }
        if (!boardUnchanged()) throw new Error('The board changed. Run again for the current selection; the organized snippet was not compiled.');
        if (typeof structured?.source !== 'string' || !structured.source.trim()) throw new Error('Gemini returned an empty structure, so nothing was compiled. Your code is unchanged.');
        const check = checkStructure(snippet, structured.source);
        if (!check.ok) throw new Error(`${check.reason} Nothing was compiled; your code is unchanged.`);
        const organized = context ? `${context}\n\n${structured.source.replace(/\s+$/, '')}\n` : structured.source;
        setPseudoDraft({ ...structured, source: organized, originalKey: submittedKey, level, structure: true, entryAdded: check.entryAdded });
        await compile(organized, true);
        return;
      }
      // Full program (and Python snippets) compile exactly what is in the editor; only Algorithm asks Gemini to write code.
      if (level !== 3) { await compile(submitted.source, Boolean(prepared.drawing && edited === null)); return; }
      setPhase('gemini');
      const draft = await requestJson('/api/pseudocode', { source: submitted.source, stdin: submitted.stdin, level: 3, ...languagePayload(language) }, 65_000);
      if (!boardUnchanged()) throw new Error('The board changed. Run again for the current selection; pending generated code was not executed.');
      setPseudoDraft({ ...draft, originalKey: submittedKey, level });
      await compile(draft.source, true);
    } catch (caught) {
      setError(caught.name === 'AbortError' ? 'The request timed out. Check the API and try again.' : caught.message);
    } finally { setRunning(false); setPhase(''); checkHealth(); }
  }

  // Only on request: Gemini corrects the code that failed, and the corrected version is run.
  async function fixWithGemini() {
    if (!api || running || reading || !result || stale || result.status === 'success') return;
    if (!ocrHealth?.available) { setError('Set GEMINI_API_KEY on the API host to use Gemini fixes.'); return; }
    const failed = result;
    setRunning(true); setError(''); setNotice(''); setGeminiDiagnostic(null); setPhase('gemini');
    try {
      let context = [failed.compilerOutput, failed.stderr].filter(Boolean).join('\n');
      while (new TextEncoder().encode(context).length > 16_384) context = context.slice(0, Math.floor(context.length * .8));
      const draft = await requestJson('/api/pseudocode', { source: failed.source, stdin: failed.stdin, level: 1, compilerOutput: context, ...(failed.level === 2 && failed.status === 'compile_error' && language === 'c' ? { templateMode: true } : {}), ...languagePayload(language) }, 65_000);
      if (currentKey.current !== failed.key) throw new Error('The code changed while Gemini was working. Run again, then ask for a fix.');
      setPhase('compiler');
      const scene = boardScene();
      const data = await requestJson('/api/run', { source: draft.source, stdin: failed.stdin, ...languagePayload(language) }, 30_000);
      setPseudoDraft({ ...draft, originalKey: failed.key, level: failed.level, fix: true });
      setResult({ ...data, signature: failed.signature, key: failed.key, source: draft.source, stdin: failed.stdin, transformed: true, level: failed.level, edited: failed.edited, fixed: true });
      await saveCompilationSnapshot(scene, { source: draft.source, stdin: failed.stdin, language, level: failed.level, kind: 'fix', result: data });
    } catch (caught) {
      setError(caught.name === 'AbortError' ? 'The request timed out. Check the API and try again.' : `Gemini fix: ${caught.message}`);
    } finally { setRunning(false); setPhase(''); }
  }

  function usePseudoDraft() {
    if (!currentDraft || hasInk) return;
    replaceChannel(api, frameId, program.codeIds, currentDraft.source, CODE_COLOR);
    setPseudoDraft(null);
    setResult(null);
    setEdited(null);
    setNotice(`Gemini ${languageLabel} is on the board. Full program mode runs this code as written.`);
    setPseudoLevel(1);
  }

  function boardScene() {
    const current = structuredClone(api.getSceneElements().filter((el) => !isOverlay(el)));
    const reviewed = confirmedOcr?.frameId === frameId && (confirmedOcr.language ?? 'c') === language && confirmedOcr.fingerprint === inkFingerprint(current, frameId) ? confirmedOcr : null;
    const channels = handwritingChannels(current, frameId);
    const currentProgram = channels.code || channels.stdin ? reviewed?.program : extractProgram(current, frameId);
    return {
      type: 'excalidraw', version: 2, source: 'boardroom',
      elements: current,
      appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: structuredClone(api.getFiles()),
      verifier: { frameId, language, result: currentProgram && !result?.edited && result?.signature === programSignature({ ...currentProgram, language }, frameId) ? result : null,
        ocr: reviewed ? structuredClone(reviewed) : null },
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
      const data = await pushSnapshot(scene, selectedFrame?.name || lesson?.title || 'Lesson');
      setPanelVisible(true);
      setNotice(`Snapshot saved: ${data.id}${data.commit ? ` · Git ${data.commit.slice(0, 8)}` : ''}`);
      if (data.warning) setError(data.warning);
      else { setSnapshotRevision((revision) => revision + 1); setTab('history'); }
    } catch (caught) { setPanelVisible(true); setError(caught.message); }
    finally { setSavingSnapshot(false); }
  }

  async function pushSnapshot(scene, title) {
    const response = await apiFetch('/api/snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, scene }), signal: AbortSignal.timeout(55_000) });
    const data = await readApiJson(response);
    if (!response.ok) throw new Error(data.error ?? 'Could not save the lesson snapshot.');
    return data;
  }

  async function saveCompilationSnapshot(scene, execution) {
    setAutomaticSnapshot('Saving full-board snapshot…');
    try {
      const savedScene = { ...scene, verifier: { ...scene.verifier, execution } };
      const title = scene.elements.find(el => el.id === scene.verifier.frameId)?.name || 'Lesson';
      const data = await pushSnapshot(savedScene, `${title} · ${execution.result.status}`);
      setSnapshotRevision(revision => revision + 1);
      setAutomaticSnapshot(data.warning || `Full-board snapshot saved · Git ${data.commit.slice(0, 8)}`);
    } catch (caught) {
      setAutomaticSnapshot(`Automatic snapshot failed: ${caught.name === 'TimeoutError' ? 'Archive request timed out. Refresh History before retrying.' : caught.message} Your run result is still available.`);
    }
  }

  function restoreBoard(data) {
    if (data.type !== 'excalidraw' || !Array.isArray(data.elements) || data.elements.length > 2000) throw new Error('Choose an Excalidraw scene with at most 2,000 elements.');
    if (!validLanguage(data.verifier?.language)) throw new Error('Choose a board using C++ or Python.');
    setLanguage(data.verifier?.language ?? 'c');
    const restored = restoreElements(data.elements.filter((el) => !isOverlay(el)), null);
    const nextFrames = framesIn(restored);
    const nextFrameId = nextFrames.some((frame) => frame.id === data.verifier?.frameId) ? data.verifier.frameId : nextFrames[0]?.id ?? '';
    selectingRegion.current = null;
    setRegionPending(false);
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
    setPanelVisible(true);
    setTab('library');
    setLibraryFile(file);
    if (librarySources[file]) return;
    const standard = standardLibraries.find(item => item.file === file);
    if (standard) {
      setLibrarySources(previous => ({ ...previous, [file]: lessons.find(item => item.id === standard.lessonId).source }));
      return;
    }
    if (bundledHeaders[file]) {
      setLibrarySources((previous) => ({ ...previous, [file]: bundledHeaders[file] }));
      return;
    }
    try {
      const response = await apiFetch(`/api/library/${file}`);
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
    setPanelVisible(true);
    editorRef.current?.focusLine(diagnostic.line);
  }

  function newBlankBoard() {
    if (!api || reading || running) return;
    cancelRegion();
    api.updateScene({ elements: [], appState: { selectedElementIds: {}, currentItemStrokeColor: CODE_COLOR } });
    api.setActiveTool({ type: 'freedraw' });
    setPen('code');
    setFrameId('');
    setLessonId('');
    resetWork();
    setNotice('Write anywhere. Then choose Select code & input and drag around the content to run.');
  }

  function selectCodeRegion() {
    if (!api || running || reading) return;
    selectingRegion.current = new Set(framesIn(api.getSceneElements()).map((frame) => frame.id));
    setRegionPending(true);
    setToolsOpen(false);
    setPen('');
    api.setActiveTool({ type: 'frame' });
    setNotice('Drag around the code and any blue input to select a program region. Press Escape to cancel.');
  }

  const activeApi = focusedBoard === 'secondary' && apiSecondary ? apiSecondary : api;

  function cancelRegion() {
    selectingRegion.current = null;
    setRegionPending(false);
    activeApi?.setActiveTool({ type: 'selection' });
  }

  function transcribeWholePage() {
    if (!api || reading || running) return;
    const rect = inkBounds(api);
    if (!rect) { setError('Write or type something on the board first.'); return; }
    cancelRegion();
    setToolsOpen(false);
    const created = createRegionFrame(api, rect);
    setFrameId(created.id);
    setLessonId('');
    resetWork();
    setNotice('Whole page selected. Press Verify & run to compile it, or read the handwriting first if it is inked.');
    if (created.strokes > 0) { setPanelVisible(true); setTab('handwriting'); }
  }

  function selectPen(kind, customColor = null) {
    if (!activeApi) return;
    cancelRegion();
    const color = customColor || (kind === 'code' ? CODE_COLOR : kind === 'input' ? INPUT_COLOR : penColor);
    if (customColor) setPenColor(customColor);
    activeApi.updateScene({ appState: { currentItemStrokeColor: color } });
    activeApi.setActiveTool({ type: 'freedraw' });
    setPen(kind);
    setToolsOpen(true);
  }

  function zoomBoard(delta) {
    if (!activeApi) return;
    const currentZoom = activeApi.getAppState().zoom.value;
    const nextZoom = Math.min(3, Math.max(0.2, currentZoom + delta));
    activeApi.updateScene({ appState: { zoom: { value: nextZoom } } });
  }

  function resetZoom() {
    if (!activeApi) return;
    const sceneElements = activeApi.getSceneElements().filter((el) => !isOverlay(el));
    if (sceneElements.length) {
      activeApi.scrollToContent(sceneElements, { fitToContent: true, maxZoom: 1 });
    } else {
      activeApi.updateScene({ appState: { zoom: { value: 1 }, scrollX: 0, scrollY: 0 } });
    }
  }

  const onSecondaryChange = useCallback((next, appState) => {
    setSecondaryElements([...next]);
    if (secondaryTabId) {
      setTabs((prev) => prev.map((t) => t.id === secondaryTabId ? { ...t, elements: [...next] } : t));
    }
  }, [secondaryTabId]);

  function toggleDualMode() {
    if (!api) return;
    if (dualMode) {
      // Exiting dual mode: persist secondary board if open
      if (apiSecondary && secondaryTabId) {
        const secEls = apiSecondary.getSceneElements().filter((el) => !isOverlay(el));
        setTabs((prev) => prev.map((t) => t.id === secondaryTabId ? { ...t, elements: secEls } : t));
      }
      setDualMode(false);
      setFocusedBoard('primary');
      setNotice('Returned to single board view.');
      return;
    }

    // Entering dual mode: need at least 2 boards
    const currentEls = api.getSceneElements().filter((el) => !isOverlay(el));
    let updatedTabs = tabs.map((t) => t.id === activeTabId ? { ...t, elements: currentEls } : t);
    let chosenSecId = secondaryTabId;

    if (updatedTabs.length < 2) {
      const newId = `tab-${Date.now()}`;
      const newTitle = `Board ${updatedTabs.length + 1}`;
      updatedTabs = [...updatedTabs, { id: newId, title: newTitle, elements: [] }];
      chosenSecId = newId;
    } else if (!chosenSecId || chosenSecId === activeTabId || !updatedTabs.some((t) => t.id === chosenSecId)) {
      const other = updatedTabs.find((t) => t.id !== activeTabId);
      chosenSecId = other ? other.id : updatedTabs[0].id;
    }

    setTabs(updatedTabs);
    setSecondaryTabId(chosenSecId);
    setDualMode(true);
    setNotice('Dual board view enabled: Two boards side-by-side.');
  }

  function changeDualBoards(firstId, secondId) {
    if (firstId === secondId) return;
    if (firstId && firstId !== activeTabId) {
      switchTab(firstId);
    }
    if (secondId && secondId !== secondaryTabId) {
      if (apiSecondary && secondaryTabId) {
        const secEls = apiSecondary.getSceneElements().filter((el) => !isOverlay(el));
        setTabs((prev) => prev.map((t) => t.id === secondaryTabId ? { ...t, elements: secEls } : t));
      }
      const targetSec = tabs.find((t) => t.id === secondId);
      setSecondaryTabId(secondId);
      if (apiSecondary && targetSec) {
        apiSecondary.updateScene({ elements: targetSec.elements });
      }
    }
  }

  function switchTab(targetId) {
    if (targetId === activeTabId || !api) return;
    const currentEls = api.getSceneElements().filter((el) => !isOverlay(el));
    setTabs((prev) => prev.map((t) => t.id === activeTabId ? { ...t, elements: currentEls } : t));
    const target = tabs.find((t) => t.id === targetId);
    if (target) {
      setActiveTabId(targetId);
      api.updateScene({ elements: target.elements });
      resetWork();
      setFrameId('');
      setNotice(`Switched to ${target.title}`);
      if (dualMode && targetId === secondaryTabId) {
        // Swap or choose other
        const other = tabs.find((t) => t.id !== targetId);
        if (other) {
          setSecondaryTabId(other.id);
          if (apiSecondary) apiSecondary.updateScene({ elements: other.elements });
        }
      }
    }
  }

  function addNewTab() {
    if (!api) return;
    const currentEls = api.getSceneElements().filter((el) => !isOverlay(el));
    const newId = `tab-${Date.now()}`;
    const newTitle = `Board ${tabs.length + 1}`;
    const updated = [...tabs.map((t) => t.id === activeTabId ? { ...t, elements: currentEls } : t), { id: newId, title: newTitle, elements: [] }];
    setTabs(updated);
    if (dualMode) {
      // In dual mode, new tab can be set as the secondary board
      setSecondaryTabId(newId);
      if (apiSecondary) apiSecondary.updateScene({ elements: [] });
      setNotice(`Opened ${newTitle} on right board`);
    } else {
      setActiveTabId(newId);
      api.updateScene({ elements: [] });
      resetWork();
      setFrameId('');
      setNotice(`Opened ${newTitle}`);
    }
  }

  function closeTab(e, closeId) {
    e.stopPropagation();
    if (tabs.length <= 1) return;
    const remaining = tabs.filter((t) => t.id !== closeId);
    setTabs(remaining);
    if (activeTabId === closeId) {
      const nextTab = remaining[0];
      setActiveTabId(nextTab.id);
      api.updateScene({ elements: nextTab.elements });
      resetWork();
      setFrameId('');
    }
    if (secondaryTabId === closeId) {
      const other = remaining.find((t) => t.id !== (activeTabId === closeId ? remaining[0].id : activeTabId));
      if (other) {
        setSecondaryTabId(other.id);
        if (apiSecondary) apiSecondary.updateScene({ elements: other.elements });
      } else {
        setDualMode(false);
      }
    }
  }

  function closeTools() {
    setToolsOpen(false);
  }

  function chooseTool(type) {
    if (!activeApi) return;
    cancelRegion();
    activeApi.setActiveTool({ type, locked: toolLocked });
    setActiveToolState(type);
    if (type !== 'freedraw') setPen('');
  }

  function toggleLock() {
    const next = !toolLocked;
    setToolLocked(next);
    activeApi?.setActiveTool({ type: activeTool, locked: next });
  }

  function chooseWidth(width) {
    setStrokeWidth(width);
    activeApi?.updateScene({ appState: { currentItemStrokeWidth: width } });
  }

  function chooseColor(color) {
    selectPen(color === CODE_COLOR ? 'code' : color === INPUT_COLOR ? 'input' : 'custom', color);
  }

  function toggleTheme() {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('boardroom.theme', next); } catch { /* the toggle still works for this visit */ }
      return next;
    });
  }

  function applyTemplate(next) {
    setTemplate(next);
    saveTemplate(next);
    setPseudoLevel(2);
    setBuilderOpen(false);
    setNotice('Snippet mode: your board text runs inside this template.');
  }

  function turnSnippetOff() {
    setPseudoLevel(1);
    setBuilderOpen(false);
    setNotice('Full program mode: the board text runs exactly as written.');
  }

  const runLabel = reading ? 'Reading handwriting…' : running ? phase === 'structure' ? 'Gemini is organizing…' : phase === 'gemini' ? `Gemini is preparing ${languageLabel}…` : language === 'python' ? 'Checking & running…' : 'Compiling & running…' : hasInk && !recognizedProgram ? codeReviewCurrent ? 'Scan & review input' : 'Read & review handwriting' : pseudoLevel === 3 ? 'Generate & run' : 'Verify & run';
  const runDisabled = running || reading || !api || !frameId || !(hasInk && !recognizedProgram ? ocrHealth?.available : health?.available) || ((pseudoLevel === 3 || (pseudoLevel === 2 && language === 'c')) && !ocrHealth?.available);

  function changeLanguage(next) {
    if (next === language || running || reading) return;
    setLanguage(next); setHealth(null); setConfirmedOcr(null); setPseudoDraft(null); setError(''); setGeminiDiagnostic(null);
    setNotice(`${languageInfo(next).label} selected. Your writing is preserved; review any handwriting before running.`);
    if (api) clearOverlays(api);
  }

  return (
    <div className="app-shell" data-theme={theme}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Boardroom home"><span className="brand-mark"><Icon name="board" size={23} /></span><span>boardroom<span className="brand-dot">.</span></span></a>
        <div className="board-tabs" role="tablist" aria-label="Whiteboard tabs">
          {tabs.map((t) => (
            <div key={t.id} className={`board-tab ${activeTabId === t.id ? 'active' : ''}`} onClick={() => switchTab(t.id)} role="tab" aria-selected={activeTabId === t.id}>
              <span>{t.title}</span>
              {tabs.length > 1 && (
                <button className="tab-close" aria-label={`Close ${t.title}`} onClick={(e) => closeTab(e, t.id)}>×</button>
              )}
            </div>
          ))}
          <button className="tab-new" aria-label="New whiteboard tab" onClick={addNewTab} title="Create new whiteboard tab"><Icon name="plus" size={14} /></button>
        </div>
        <button className={`quiet-button dual-board-toggle ${dualMode ? 'active' : ''}`}
          aria-label={dualMode ? 'Exit side-by-side view' : 'Display two boards side by side'}
          title={dualMode ? 'Exit side-by-side view' : 'Display two boards side by side'}
          onClick={toggleDualMode}
          disabled={!api || busy}>
          <Icon name="dual" size={16} />
          <span className="long">{dualMode ? 'Single board' : 'Side-by-side'}</span>
        </button>
        {dualMode && (
          <div className="dual-selectors" role="group" aria-label="Select dual boards">
            <select aria-label="Left board" value={activeTabId} onChange={(e) => changeDualBoards(e.target.value, secondaryTabId)}>
              {tabs.map((t) => <option key={`l-${t.id}`} value={t.id} disabled={t.id === secondaryTabId}>{t.title} (Left)</option>)}
            </select>
            <span className="dual-divider-icon" aria-hidden="true">|</span>
            <select aria-label="Right board" value={secondaryTabId} onChange={(e) => changeDualBoards(activeTabId, e.target.value)}>
              {tabs.map((t) => <option key={`r-${t.id}`} value={t.id} disabled={t.id === activeTabId}>{t.title} (Right)</option>)}
            </select>
          </div>
        )}
        <label className="lesson-select"><span>Lesson</span><select aria-label="Demo lesson" value={lessonId} disabled={busy || !api} onChange={(event) => chooseLesson(event.target.value)}>{!lessonId && <option value="">Blank canvas</option>}{lessons.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <button className="quiet-button blank-button" aria-label="+ Blank canvas" onClick={newBlankBoard} disabled={!api || busy}><span aria-hidden="true">+</span><span className="long" aria-hidden="true"> Blank canvas</span></button>
        <div className="header-actions">
          <span className={`connection ${health?.available ? 'online' : ''}`} title={health?.message ?? 'Checking runner'}><i />{health ? (health.available ? 'Runner ready' : 'Runner offline') : 'Connecting'}</span>
          <button className="icon-button" aria-label="Open board" title="Open board" onClick={() => upload.current.click()} disabled={!api || busy}><Icon name="upload" /></button>
          <button className="icon-button" aria-label="Download" title="Download board" onClick={download} disabled={!api}><Icon name="download" /></button>
          <button className="icon-button" aria-label="Save lesson snapshot" onClick={saveSnapshot}
            disabled={!api || !snapshotAvailable || !frameId || busy || savingSnapshot || !program.source.trim() || (hasInk && !recognizedProgram)}
            title={hasInk && !recognizedProgram ? 'Confirm the handwriting before saving.' : 'Save board, source, and input with local Git history.'}><Icon name="save" /></button>
          <button className="icon-button" aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
          <button className="icon-button" aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} title="Fullscreen" onClick={toggleFullscreen}><Icon name="expand" /></button>
          <input ref={upload} type="file" accept=".excalidraw,.json" hidden onChange={importBoard} />
        </div>
      </header>

      <main className={`stage${toolsOpen ? ' tools-open' : ''}`}>
        <WorkspaceLayout focused={!panelVisible} onResize={refreshCanvas}>
          <section className="board-pane" aria-label="Interactive lesson whiteboard">
            <div className={`canvas-container ${dualMode ? 'canvas-container--dual' : ''}`}>
              <div className={`board-frame-wrapper ${dualMode ? 'board-frame--half' : 'board-frame--full'} ${focusedBoard === 'primary' ? 'board-frame--focused' : ''}`}
                onClick={() => { if (dualMode && focusedBoard !== 'primary') setFocusedBoard('primary'); }}>
                {dualMode && (
                  <div className="dual-board-header">
                    <span className="dual-board-title">{tabs.find((t) => t.id === activeTabId)?.title || 'Board 1'} (Active Verification)</span>
                    <span className="dual-board-badge">Left</span>
                  </div>
                )}
                <div className="program-canvas">
                  <Excalidraw
                    initialData={{ elements: initial, appState: { viewBackgroundColor: '#ffffff', currentItemFontFamily: 3, currentItemStrokeColor: CODE_COLOR }, scrollToContent: true }}
                    excalidrawAPI={setApi} onChange={onChange} theme={theme} name="Boardroom lesson"
                    UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false } }}
                  />
                  <ProgramRegions api={api} frames={frames} selectedId={frameId} />
                </div>
              </div>

              {dualMode && (
                <div className={`board-frame-wrapper board-frame--half ${focusedBoard === 'secondary' ? 'board-frame--focused' : ''}`}
                  onClick={() => { if (focusedBoard !== 'secondary') setFocusedBoard('secondary'); }}>
                  <div className="dual-board-header">
                    <span className="dual-board-title">{tabs.find((t) => t.id === secondaryTabId)?.title || 'Board 2'}</span>
                    <span className="dual-board-badge">Right</span>
                  </div>
                  <Excalidraw
                    initialData={{ elements: tabs.find((t) => t.id === secondaryTabId)?.elements || [], appState: { viewBackgroundColor: '#ffffff', currentItemFontFamily: 3, currentItemStrokeColor: CODE_COLOR }, scrollToContent: true }}
                    excalidrawAPI={setApiSecondary} onChange={onSecondaryChange} theme={theme} name="Boardroom secondary"
                    UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false } }}
                  />
                </div>
              )}

              {toolsOpen && <DrawToolbar activeTool={activeTool} locked={toolLocked} strokeWidth={strokeWidth} color={penColor}
                onTool={chooseTool} onLock={toggleLock} onStrokeWidth={chooseWidth} onColor={chooseColor} onClose={closeTools} />}
            </div>
            {(error || notice || (health && !health.available)) && <div className={`statusline${error ? ' error' : ''}`}>
              {error ? <span role="alert">{error}</span> : notice ? <span role="status">{notice}</span> : <span>{health.message}</span>}
              {(error || notice) ? <button className="icon-button" aria-label="Dismiss message" onClick={() => { setError(''); setNotice(''); }}>×</button> : <button className="link-button" onClick={checkHealth}>Check again</button>}
            </div>}
            <div className="toolstrip" role="toolbar" aria-label="Board tools">
              <div className="toolstrip-controls">
              <div className="tool-group" role="group" aria-label="Draw">
                <button className="tool" aria-label="Pen: code" aria-pressed={pen === 'code'} onClick={() => selectPen('code', CODE_COLOR)} disabled={!api || busy} title="Black ink is code"><i className="ink code-ink" /><span className="tool-label">Code</span></button>
                <button className="tool" aria-label="Pen: input" aria-pressed={pen === 'input'} onClick={() => selectPen('input', INPUT_COLOR)} disabled={!api || busy} title="Blue ink is program input"><i className="ink input-ink" /><span className="tool-label">Input</span></button>
              </div>
              <div className="tool-group" role="group" aria-label="Navigate & Zoom">
                <button className="tool icon-only" aria-label="Zoom in" onClick={() => zoomBoard(0.2)} disabled={!api} title="Zoom in"><Icon name="zoomIn" /></button>
                <button className="tool icon-only" aria-label="Zoom out" onClick={() => zoomBoard(-0.2)} disabled={!api} title="Zoom out"><Icon name="zoomOut" /></button>
                <button className="tool icon-only" aria-label="Fit content" onClick={resetZoom} disabled={!api} title="Fit to content"><Icon name="fit" /></button>
              </div>
              <div className="tool-group" role="group" aria-label="Select">
                <button className="tool" aria-label="Select code and input" aria-pressed={regionPending} onClick={regionPending ? cancelRegion : selectCodeRegion} disabled={!api || busy} title="Drag a box around the code and its input"><Icon name="region" /><span className="tool-label">{regionPending ? 'Drag a box…' : 'Region'}</span></button>
                <button className="tool" aria-label="Transcribe whole page" onClick={transcribeWholePage} disabled={!api || busy} title="Use everything written on the board"><Icon name="page" /><span className="tool-label">Whole page</span></button>
              </div>
              <fieldset className="language-toggle tool-group tool-language" disabled={busy}>
                <legend className="sr-only">LANGUAGE</legend>
                <div>{LANGUAGES.map((item) => <label key={item.id} className={language === item.id ? 'selected' : ''}>
                  <input type="radio" name="program-language" value={item.id} checked={language === item.id} onChange={() => changeLanguage(item.id)} />{item.label}
                </label>)}</div>
              </fieldset>
              <div className="tool-group tool-frame">
                <label className="sr-only" htmlFor="program-frame">PROGRAM FRAME</label>
                <select id="program-frame" className="frame-select" value={frameId} title={lesson?.description} disabled={busy} onChange={(event) => changeFrame(event.target.value)}>{!frames.length && <option value="">No region yet</option>}{frames.map((frame, index) => <option key={frame.id} value={frame.id} title={frame.name || undefined}>Selected program #{index + 1}</option>)}</select>
              </div>
              <div className="tool-group mode-control">
                <div className="mode-slider" style={{ '--mode': pseudoLevel - 1 }}>
                  <input id="pseudocode-level" type="range" min="1" max="3" step="1" value={pseudoLevel} aria-label="Code mode"
                    aria-valuetext={`${mode.label}: ${mode.description}`} disabled={busy}
                    onChange={(event) => { setPseudoLevel(Number(event.target.value)); setPseudoDraft(null); setGeminiDiagnostic(null); setError(''); }} />
                  <div className="mode-stops" aria-hidden="true">{codeModes.map((item) => <span key={item.value} className={item.value === pseudoLevel ? 'on' : ''}
                    onClick={() => { if (!busy) { setPseudoLevel(item.value); setPseudoDraft(null); setGeminiDiagnostic(null); setError(''); } }}>{item.label}</span>)}</div>
                </div>
                <p className="mode-text" aria-live="polite"><strong>{mode.label}</strong><span>{mode.description}</span></p>
                {snippetMode && language === 'c' && <button className="tool" aria-label="Edit template" onClick={() => setBuilderOpen(true)} disabled={!api} title="Choose the headers, globals and helpers your snippet runs inside"><Icon name="code" /><span className="tool-label">Template</span></button>}
              </div>
              </div>
              <div className="tool-group tool-run">
                <button className="run-button" onClick={run} disabled={runDisabled}><span className={busy ? 'spinner' : ''}>{!busy && <Icon name="play" size={18} />}</span>{runLabel}{!busy && <span className="run-button-hint" aria-hidden="true">{languageLabel} →</span>}</button>
                <button className="tool" aria-label={panelVisible ? 'Hide panel' : 'Show panel'} aria-pressed={panelVisible} onClick={() => setPanelVisible((visible) => !visible)}><Icon name="panel" /><span className="tool-label">Code</span></button>
              </div>
            </div>
          </section>

          <aside className="inspector" aria-label="Code, verification controls and results" hidden={!panelVisible}>
            <div className="panel-head">
              <h2>Code &amp; results</h2>
              <button className="icon-button" aria-label="Close panel" title="Close panel" onClick={() => setPanelVisible(false)}>×</button>
            </div>
            {hasInk && <p className="handwriting-state">{recognizedProgram ? 'Handwriting reviewed. Ready to compile.' : 'Handwriting needs recognition and teacher confirmation.'}</p>}
            {(pseudoLevel === 3 || (pseudoLevel === 2 && language === 'c')) && ocrHealth && !ocrHealth.available && <p className="runner-notice">Gemini is required in {pseudoLevel === 3 ? 'Algorithm' : 'Snippet'} mode. {ocrHealth.message}</p>}
            {health && !health.available && <div className="runner-notice"><span>{health.message}</span><button onClick={checkHealth}>Check again</button></div>}
            {error && geminiDiagnostic && <details className="raw-output"><summary>Gemini assistance diagnostics</summary><pre>{JSON.stringify(geminiDiagnostic, null, 2)}</pre><a href="https://aistudio.google.com/usage" target="_blank" rel="noreferrer">Check Gemini usage and limits</a></details>}

            <section className="panel-code" aria-label="Code that runs">
              {automaticSnapshot && <p className="panel-help" role="status" aria-label="Automatic snapshot status">{automaticSnapshot}</p>}
              <div className="code-heading">
                <label className="field-label" htmlFor="source-editor">CODE THAT RUNS · {lineCount} LINES</label>
                <span className="code-badges">
                  {snippetMode && language === 'c' && <button className="badge" onClick={() => setBuilderOpen(true)} title="Open the template builder">{composed.skipped ? 'Snippet · has main()' : 'Snippet · template'}</button>}
                  {edited !== null && <button className="badge edited" onClick={() => setEdited(null)} title="Discard your edits and use the board's version">Edited by hand · reset</button>}
                </span>
              </div>
              {boardMovedOn && <p className="code-note">The board changed after your edits. Reset to pick up the board's version.</p>}
              {composed.drawing && <p className="code-note" role="status">Linked-list drawing: {composed.drawing}. Verify &amp; run builds real nodes using list_from_arrows; the drawing stays unchanged.</p>}
              {composed.skipped && <p className="code-note">Your text already declares main(), so it runs as a full program, not inside the template.</p>}
              <CodeEditor id="source-editor" ref={editorRef} value={runSource} onChange={editCode} diagnostics={shownDiagnostics} disabled={busy}
                placeholder={hasInk && !recognizedProgram ? 'Confirmed handwriting appears here. You can also type code directly.' : `Type ${languageLabel} here, or write it on the board.`} />
              <div className="code-heading input-heading"><label className="field-label" htmlFor="stdin-editor">STANDARD INPUT · BLUE INK</label>
                <button className="quiet-button" onClick={scanInput} disabled={busy || !api || !frameId || !inkChannels.stdin || !ocrHealth?.available}>Scan input</button>
              </div>
              <textarea id="stdin-editor" className="input-editor" value={program.stdin} spellCheck={false} readOnly={hasInk} placeholder="No input: the program receives EOF." disabled={busy || !frameId}
                onChange={(event) => { if (!hasInk) { setPseudoDraft(null); replaceChannel(api, frameId, program.inputIds, event.target.value, INPUT_COLOR); } }} />
              <details className="frame-size"><summary>Frame size</summary>
                <FrameControls frame={selectedFrame} disabled={busy}
                  onResize={(width, height) => resizeProgramFrame(api, frameId, width, height)}
                  onFit={() => fitProgramFrame(api, frameId)} />
              </details>
            </section>

            <div className="result-tabs" role="tablist" aria-label="Run details">{[['output', 'Output'], ['handwriting', 'Handwriting'], ['cases', 'Cases'], ['library', 'Libraries'], ['history', 'History']].map(([id, label]) => <button key={id} id={`tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`panel-${id}`} onClick={() => id === 'library' ? viewLibrary() : setTab(id)}>{label}</button>)}</div>

            <div className="result-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
              <div hidden={tab !== 'handwriting'}><HandwritingPanel ref={ocrPanel}
                api={api} frameId={frameId} fingerprint={fingerprint} language={language}
                configuration={ocrHealth} hasInk={hasInk} confirmedOcr={confirmedOcr}
                onConfirmInput={(confirmed, stdin, saveCase) => {
                  if (saveCase) casesPanel.current.addInput(stdin);
                  if (confirmed) setConfirmedOcr(confirmed);
                  setPseudoDraft(null); setResult(null); setTab(saveCase ? 'cases' : 'output');
                  setNotice(saveCase ? 'Scanned input saved as a test case. Use Run cases to execute it.' : 'Input updated. Use Verify & run to execute the code with this input.');
                }}
                busy={reading || running} onBusy={setReading} onInvalidate={() => setConfirmedOcr(null)}
                onConfirm={(confirmed) => {
                  setConfirmedOcr(confirmed); setResult(null); setTab('output');
                  setNotice('Transcription confirmed. Use the run button at your selected level to check, complete, or demonstrate it.');
                }}
              /></div>
              <div hidden={tab !== 'cases'}>{casesNeedPreparedCode && <p className="panel-help">First prepare the code with the run button. Cases use that displayed program until the board, input or level changes.</p>}<TestCases ref={casesPanel} key={language} program={caseProgram} signature={`${signature}:${pseudoLevel}:${caseProgram.source}`}
                captureScene={boardScene} onCompiled={(scene, submitted, data) => saveCompilationSnapshot(scene,
                  { source: submitted.source, stdin: submitted.stdin, language: submitted.language, level: pseudoLevel, kind: 'case', result: data })}
                disabled={running || reading || !health?.available || !api || !frameId || !caseProgram.source.trim() || (hasInk && !recognizedProgram) || (casesNeedPreparedCode && !currentDraft)} onBusy={setRunning} /></div>
              {tab === 'history' && !snapshotAvailable && <p className="panel-help">{snapshotMessage}</p>}
              {tab === 'history' && snapshotAvailable && <SnapshotHistory key={snapshotRevision} onOpen={(scene) => {
                const ink = restoreBoard(scene);
                setTab(ink ? 'handwriting' : 'output');
                setNotice(ink ? 'Saved board opened. Review its handwriting again before running. The confirmed source is also stored in the snapshot source file.' : 'Saved board opened. Run it to verify the saved code.');
              }} />}
              {tab === 'output' && <>
                {stale && <div className="stale-notice">{edited !== null ? 'The code changed. Run again to update these results.' : 'The board changed. Run again to update these results.'}</div>}
                {!result && !running && <div className="empty-state"><div className="terminal-glyph">&gt;_</div><h3>Let the code do the talking.</h3><p>Output appears here. Errors are underlined in the code above.</p><span>{language === 'python' ? 'Python interpreter' : 'C++ compiler'} · real output</span></div>}
                {running && <div className="empty-state" role="status"><div className="terminal-glyph">…</div><h3>{phase === 'structure' ? 'Organizing the snippet with Gemini' : phase === 'gemini' ? 'Preparing the lesson with Gemini' : 'Testing the lesson'}</h3><p>{phase === 'structure' ? 'Gemini is arranging your helpers and entry point. It does not fix errors.' : phase === 'gemini' ? `Reading your selected code or algorithm and preparing ${languageLabel}.` : `Checking ${languageLabel} and running the program.`}</p></div>}
                {result && <div aria-live="polite"><div className={`result-status ${result.status === 'success' ? 'passed' : 'failed'}`}><span>{result.status === 'success' ? '✓' : '!'}</span><strong>{labels[result.status] ?? result.status}</strong><small>{result.durationMs} ms</small></div>
                  {result.status !== 'success' && !stale && <div className="fix-callout">
                    <p>{result.fixed ? 'The corrected version still has an issue.' : result.level === 2 && result.status === 'compile_error' && language === 'c' ? 'Template compile failed? Gemini can move templates, functions, classes, and structs to the correct scope and run the corrected program.' : 'Want Gemini to correct this and run the fixed version?'}</p>
                    <button className="fix-button" onClick={fixWithGemini} disabled={busy || !ocrHealth?.available}
                      title={ocrHealth?.available ? 'Gemini corrects the code and runs the corrected version. Your board is not changed.' : 'Set GEMINI_API_KEY to use Gemini fixes.'}><Icon name="sparkle" size={18} />Ask Gemini to fix</button>
                  </div>}
                  <div className="terminal"><div className="terminal-title"><span>STDOUT</span><span>exit {result.exitCode ?? '—'}</span></div><pre>{result.stdout || '(no output)'}</pre></div>
                  {language === 'c' && <MemoryDiagram stdout={result.stdout} />}
                  {result.transformed && <p className="panel-help">This output comes from the generated program. Diagnostic line numbers refer to that source.</p>}
                  {result.diagnostics.length > 0 && <div className="diagnostics"><h3>What the tools found</h3>{result.diagnostics.map((diagnostic, index) => <button key={index} className={`diagnostic ${diagnostic.severity}`} disabled={Boolean(stale) || result.transformed} onClick={() => focusDiagnostic(diagnostic)}><span className="line-number">L{diagnostic.line}</span><span><b>{diagnostic.kind} · {diagnostic.severity}</b>{diagnostic.message}</span><Icon name="arrow" size={14} /></button>)}</div>}
                  {result.notes.map((note) => <article className="teaching-note" key={note.title}><span className="eyebrow">TEACHING NOTE</span><h3>{note.title}</h3><p>{note.body}</p></article>)}
                  {(result.stderr || result.compilerOutput) && <details className="raw-output"><summary>Full compiler & runtime messages</summary><pre>{[result.compilerOutput, result.stderr].filter(Boolean).join('\n')}</pre></details>}
                </div>}
                {currentDraft && <section className="pseudocode-review" aria-label={`Gemini ${languageLabel} proposal`}>
                  <h3>{currentDraft.fix ? 'Gemini fix' : currentDraft.structure ? 'Gemini structure · organized snippet' : `Gemini ${languageLabel} · demonstration`}</h3>
                  <p className="panel-help">{currentDraft.explanation}</p>
                  {currentDraft.issues.length > 0 && <ul className="pseudocode-issues">{currentDraft.issues.map((issue, index) => <li key={index}>{issue.line ? `Original line ${issue.line}: ` : 'Assumption: '}{issue.message}</li>)}</ul>}
                  <p className="panel-help">{currentDraft.fix ? 'Gemini corrected the code that failed; this version was run. Your board and editor are unchanged.' : currentDraft.structure ? `Gemini only arranged your code${currentDraft.entryAdded ? ' and added an int main() entry point' : ''}; nothing was corrected. This exact program was compiled, and errors refer to its lines.` : 'The program below is sent to the runner. Your writing stays on the board.'}</p>
                  <pre className="library-source" aria-label={currentDraft.fix ? `Fixed ${languageLabel}` : currentDraft.structure ? `Organized ${languageLabel}` : `Generated ${languageLabel}`}>{currentDraft.source}</pre>
                  {currentDraft.fix && <button className="quiet-button" onClick={() => editCode(currentDraft.source)} disabled={running || reading}>Use this fix in the editor</button>}
                  {!hasInk && !currentDraft.structure && <button className="quiet-button" onClick={usePseudoDraft} disabled={running || reading}>Use this {languageLabel} on board</button>}
                  <p className="ocr-provenance">{currentDraft.provider} · {currentDraft.model} · {currentDraft.durationMs} ms</p>
                </section>}
              </>}
              {tab === 'library' && <div className="library-panel">
                <label className="field-label" htmlFor="library-select">C++ LIBRARIES</label>
                <select id="library-select" className="frame-select" value={libraryFile} onChange={(event) => viewLibrary(event.target.value)}>{libraryCatalog.map((item) => <option key={item.file} value={item.file}>{item.title} · {item.file}</option>)}</select>
                <h3>{library.title}</h3><p className="panel-help">{library.description}</p>
                <p className="library-methods">{library.methods}</p>
                <p className="panel-help">Include with <code>#include &lt;{libraryFile}&gt;</code>. {standardLibraries.includes(library) ? 'Built into the C++ toolchain. The code below is a runnable usage example.' : 'This is a project-provided teaching header compiled by the runner.'}</p>
                <button className="quiet-button" disabled={running || reading || !api} onClick={() => { chooseLesson(library.lessonId); setTab('output'); }}>Load example on board</button>
                <pre className="library-source">{librarySources[libraryFile] || `Loading ${libraryFile}…`}</pre>
              </div>}
            </div>
          </aside>
        </WorkspaceLayout>
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
