import { convertToExcalidrawElements, getCommonBounds } from '@excalidraw/excalidraw';
import { CODE_COLOR, INPUT_COLOR, diagnosticBoxes, isOverlay } from './board.js';

export function lessonScene(lesson) {
  const texts = convertToExcalidrawElements([
    { type: 'text', id: 'lesson-code', x: 80, y: 100, text: lesson.source,
      fontFamily: 3, fontSize: 18, strokeColor: CODE_COLOR },
    ...(lesson.stdin ? [{ type: 'text', id: 'lesson-input', x: 80, y: 510, text: lesson.stdin,
      fontFamily: 3, fontSize: 18, strokeColor: INPUT_COLOR }] : []),
  ], { regenerateIds: false });
  // An empty placeholder must not become a space in the program's input stream.
  const elements = convertToExcalidrawElements([
    ...texts.map((el) => ({ ...el, type: 'text' })),
    { type: 'frame', id: 'lesson-frame', name: lesson.title,
      children: texts.map((el) => el.id), x: 48, y: 64, width: 710, height: 530 },
  ], { regenerateIds: false });
  const positioned = elements.map((el) => el.type === 'text' ? { ...el, frameId: 'lesson-frame' } : {
    ...el, x: 48, y: 64, width: 710, height: 530,
  });
  return growFrame(positioned, 'lesson-frame', 710, 530);
}

export function clearOverlays(api) {
  api.updateScene({ elements: api.getSceneElements().filter((el) => !isOverlay(el)) });
}

export function showDiagnostics(api, diagnostics, lineMap) {
  const overlays = convertToExcalidrawElements(diagnosticBoxes(diagnostics, lineMap));
  api.updateScene({ elements: [...api.getSceneElements().filter((el) => !isOverlay(el)), ...overlays] });
}

export function focusSourceLine(api, line) {
  if (!api || !line) return;
  const [region] = convertToExcalidrawElements([{
    type: 'rectangle', x: line.x, y: line.y,
    width: Math.max(1, line.width), height: Math.max(1, line.height),
  }]);
  api.scrollToContent(region, { animate: true, maxZoom: 1 });
}

export function replaceChannel(api, frameId, ids, text, color) {
  const current = api.getSceneElements();
  const first = current.find((el) => el.id === ids[0]);
  const frame = current.find((el) => el.id === frameId);
  if (!frame) return;
  const [replacement] = convertToExcalidrawElements([{
    type: 'text', id: first?.id,
    x: first?.x ?? frame.x + 32,
    y: first?.y ?? frame.y + (color === INPUT_COLOR ? frame.height - 60 : 36),
    text: text || ' ', strokeColor: color,
    fontSize: first?.fontSize ?? 18, fontFamily: 3,
  }], { regenerateIds: false });
  // A blank channel is represented by no text element, rather than a synthetic line.
  const retained = current.filter((el) => !ids.includes(el.id) && !isOverlay(el));
  if (text) retained.splice(retained.findIndex((el) => el.id === frameId), 0, {
    ...replacement, frameId, version: (first?.version ?? 0) + 1,
  });
  // Keep blue input below a growing typed program instead of overlapping it.
  const code = retained.filter((el) => el.frameId === frameId && el.type === 'text' && [CODE_COLOR, '#000000'].includes(el.strokeColor));
  const bottom = code.length ? Math.max(...code.map((el) => el.y + el.height)) + 32 : frame.y + 36;
  const positioned = retained.map((el) => el.frameId === frameId && el.type === 'text' &&
    el.strokeColor === INPUT_COLOR && el.y < bottom ? { ...el, y: bottom, version: el.version + 1 } : el);
  api.updateScene({ elements: growFrame(positioned, frameId, frame.width, frame.height) });
}

function growFrame(elements, frameId, width, height) {
  const frame = elements.find((el) => el.id === frameId && el.type === 'frame');
  if (!frame || !Number.isFinite(width) || !Number.isFinite(height)) return elements;
  const children = elements.filter((el) => !el.isDeleted && el.frameId === frameId && !isOverlay(el));
  const bounds = children.length ? getCommonBounds(children) : [frame.x, frame.y, frame.x, frame.y];
  const next = { ...frame, width: Math.max(320, width, bounds[2] - frame.x + 32),
    height: Math.max(240, height, bounds[3] - frame.y + 32), version: frame.version + 1 };
  return elements.map((el) => el.id === frameId ? next : el);
}

export function resizeProgramFrame(api, frameId, width, height) {
  const elements = growFrame(api.getSceneElements(), frameId, width, height);
  api.updateScene({ elements });
  return elements.find((el) => el.id === frameId);
}

export function fitProgramFrame(api, frameId) {
  const frame = api.getSceneElements().find((el) => el.id === frameId);
  if (frame) api.scrollToContent(frame, { fitToContent: true, maxZoom: 1 });
}

const isInk = (el) => !el.isDeleted && !isOverlay(el) && ['freedraw', 'text', 'arrow'].includes(el.type);
// An element belongs to a region when its centre is inside it, so a stray edge stroke is not pulled in.
const centreIn = (el, rect) => {
  const x = el.x + el.width / 2;
  const y = el.y + el.height / 2;
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
};

export function inkBounds(api, padding = 32) {
  const ink = api.getSceneElements().filter(isInk);
  if (!ink.length) return null;
  const [left, top, right, bottom] = getCommonBounds(ink);
  return { x: left - padding, y: top - padding, width: right - left + 2 * padding, height: bottom - top + 2 * padding };
}

// A selected region becomes its own frame, so every later step keeps working on "one frame = one program".
export function createRegionFrame(api, rect) {
  const current = api.getSceneElements();
  const members = current.filter((el) => isInk(el) && centreIn(el, rect));
  const number = current.filter((el) => el.type === 'frame' && String(el.name ?? '').startsWith('Region')).length + 1;
  const id = `region-${crypto.randomUUID()}`;
  const [frame] = convertToExcalidrawElements([{
    type: 'frame', id, name: `Region ${number}`, children: [], x: rect.x, y: rect.y, width: rect.width, height: rect.height,
  }], { regenerateIds: false });
  const sized = { ...frame, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  const moved = members.map((el) => ({
    ...el, frameId: id, version: el.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now(),
  }));
  // Children precede their frame in the element list.
  api.updateScene({ elements: [...current.filter((el) => !members.includes(el)), ...moved, sized] });
  api.setActiveTool({ type: 'selection' });
  return { id, strokes: members.filter((el) => el.type === 'freedraw' || el.type === 'arrow').length, texts: members.filter((el) => el.type === 'text').length };
}
