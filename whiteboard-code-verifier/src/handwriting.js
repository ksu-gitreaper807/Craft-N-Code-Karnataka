import { CODE_COLOR, INPUT_COLOR, isOverlay } from './board.js';

export function channelElements(elements, frameId, channel) {
  const colors = channel === 'code' ? [CODE_COLOR, '#000000'] : [INPUT_COLOR];
  return elements.filter((el) => !el.isDeleted && !isOverlay(el) && el.frameId === frameId &&
    ['freedraw', 'text', 'arrow'].includes(el.type) && colors.includes(el.strokeColor?.toLowerCase()));
}

export function handwritingChannels(elements, frameId) {
  return Object.fromEntries(['code', 'stdin'].map((channel) => [channel,
    channelElements(elements, frameId, channel).some((el) => el.type === 'freedraw' || el.type === 'arrow'),
  ]));
}

export function inkFingerprint(elements, frameId, channels = ['code', 'stdin']) {
  return JSON.stringify([frameId, ...channels.map((channel) =>
    channelElements(elements, frameId, channel).map((el) => [
      el.id, el.type, el.x, el.y, el.width, el.height, el.angle, el.strokeColor,
      el.strokeWidth, el.points, el.pressures, el.simulatePressure, el.opacity, el.backgroundColor,
      el.text, el.fontSize, el.fontFamily, el.lineHeight, el.scale,
      ...(el.type === 'arrow' ? [el.startArrowhead, el.endArrowhead, el.elbowed, el.startBinding, el.endBinding, el.fixedSegments] : []),
    ])),
  ]);
}

export function mappedLine(box, bounds, elementIds) {
  if (!box || !bounds) return null;
  return {
    elementId: elementIds[0], elementIds,
    x: bounds.x + box[1] * bounds.width / 1000,
    y: bounds.y + box[0] * bounds.height / 1000,
    width: (box[3] - box[1]) * bounds.width / 1000,
    height: (box[2] - box[0]) * bounds.height / 1000,
    rotated: false, approximate: true,
  };
}

export function makeReviewDraft(recognition, captures, typed, fingerprint, frameId) {
  const draft = { fingerprint, frameId, captures, raw: recognition };
  for (const channel of ['code', 'stdin']) {
    if (captures[channel]) {
      draft[channel] = recognition[channel].map((line) => ({ ...line,
        location: mappedLine(line.box, captures[channel].bounds, captures[channel].elementIds),
      }));
    } else {
      const text = channel === 'code' ? typed.source : typed.stdin;
      draft[channel] = text ? text.split('\n').map((line, index) => ({
        text: line, box: null, uncertain: false, alternatives: [],
        location: channel === 'code' ? typed.lineMap[index] : null,
      })) : [];
    }
  }
  return draft;
}

export function reviewedProgram(draft) {
  const source = draft.code.map((line) => line.text).join('\n');
  const stdin = draft.stdin.map((line) => line.text).join('\n');
  if (!source.trim()) throw new Error('The confirmed source is empty. Review the handwriting again.');
  if (new TextEncoder().encode(source).length > 32_768 || new TextEncoder().encode(stdin).length > 8192) {
    throw new Error('Confirmed source or input exceeds the runner’s size limit.');
  }
  return {
    source, stdin, lineMap: draft.code.map((line) => line.location),
    codeIds: [], inputIds: [],
  };
}
