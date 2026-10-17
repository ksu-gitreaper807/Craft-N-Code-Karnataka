export const CODE_COLOR = '#1e1e1e';
export const INPUT_COLOR = '#1971c2';

export function framesIn(elements) {
  return elements.filter((el) => el.type === 'frame' && !el.isDeleted);
}

export function isOverlay(element) {
  return element.customData?.verifierOverlay === true;
}

// Raw text and blank lines are preserved: compiler line N must remain board line N.
export function extractProgram(elements, frameId) {
  const ordered = elements
    .filter((el) => !el.isDeleted && !isOverlay(el) && el.type === 'text' && el.frameId === frameId)
    .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const code = ordered.filter((el) => [CODE_COLOR, '#000000'].includes(el.strokeColor?.toLowerCase()));
  const inputs = ordered.filter((el) => el.strokeColor?.toLowerCase() === INPUT_COLOR);
  const lineMap = [];
  for (const el of code) {
    const lines = el.text.split('\n');
    const lineHeight = el.fontSize * (el.lineHeight ?? 1.25);
    lines.forEach((_, offset) => lineMap.push({
      elementId: el.id,
      offset,
      x: el.x,
      y: el.y + offset * lineHeight,
      width: el.width,
      height: lineHeight,
      rotated: Boolean(el.angle),
    }));
  }
  return {
    source: code.map((el) => el.text).join('\n'),
    stdin: inputs.map((el) => el.text).join('\n'),
    codeIds: code.map((el) => el.id),
    inputIds: inputs.map((el) => el.id),
    lineMap,
  };
}

export function programSignature(program, frameId) {
  // Include geometry so results from a moved/edited board cannot draw stale highlights.
  return JSON.stringify([frameId, program.source, program.stdin, program.lineMap,
    ...(program.language === 'python' ? ['python'] : [])]);
}

export function diagnosticBoxes(diagnostics, lineMap) {
  const seen = new Set();
  return diagnostics.flatMap((diagnostic) => {
    const line = lineMap[diagnostic.line - 1];
    if (!line || line.rotated || seen.has(diagnostic.line)) return [];
    seen.add(diagnostic.line);
    return [{
      type: 'rectangle',
      x: line.x - 8,
      y: line.y - 2,
      width: Math.max(40, line.width + 16),
      height: line.height + 4,
      strokeColor: diagnostic.severity === 'warning' ? '#e67700' : '#e03131',
      backgroundColor: 'transparent',
      strokeWidth: 2,
      roughness: 0,
      locked: true,
      customData: { verifierOverlay: true },
    }];
  });
}
