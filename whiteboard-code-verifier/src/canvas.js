import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
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
  return elements.map((el) => el.type === 'text' ? { ...el, frameId: 'lesson-frame' } : {
    ...el, x: 48, y: 64, width: 710, height: 530,
  });
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
  api.updateScene({ elements: retained });
}

export function addHandwritingFrame(api) {
  const current = api.getSceneElements();
  const frames = current.filter((el) => el.type === 'frame');
  const x = frames.length ? Math.max(...frames.map((el) => el.x + el.width)) + 120 : 48;
  const id = `handwriting-${crypto.randomUUID()}`;
  const [frame] = convertToExcalidrawElements([{
    type: 'frame', id, name: 'Handwritten program', children: [], x, y: 64, width: 710, height: 530,
  }], { regenerateIds: false });
  const positioned = { ...frame, x, y: 64, width: 710, height: 530 };
  api.updateScene({ elements: [...current, positioned], appState: { currentItemStrokeColor: CODE_COLOR } });
  api.scrollToContent(positioned, { fitToContent: true, maxZoom: 1 });
  api.setActiveTool({ type: 'freedraw' });
  return id;
}
