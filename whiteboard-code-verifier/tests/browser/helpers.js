// Builds a small Excalidraw file so a test can place exact text on the board.
export function boardFile({ code, stdin, notes = [] }) {
  const text = (id, value, x, y, strokeColor) => ({
    id, type: 'text', frameId: 'frame', x, y, width: 420, height: 20 * value.split('\n').length,
    fontSize: 16, fontFamily: 3, strokeColor, text: value, lineHeight: 1.25,
  });
  const elements = [
    text('code', code, 40, 40, '#1e1e1e'),
    ...(stdin ? [text('input', stdin, 40, 480, '#1971c2')] : []),
    ...notes.map((note, index) => text(`note-${index}`, note.text, note.x, note.y, note.color ?? '#7048e8')),
    { id: 'frame', type: 'frame', name: 'Imported program', x: 0, y: 0, width: 900, height: 600 },
  ];
  return {
    name: 'board.excalidraw', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ type: 'excalidraw', version: 2, source: 'test', elements, files: {}, verifier: { frameId: 'frame' } })),
  };
}

// The file input ignores a board until Excalidraw has finished loading.
export async function importBoard(page, file) {
  await page.getByRole('button', { name: 'Verify & run' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.run-button')?.disabled);
  await page.locator('input[type=file]').setInputFiles(file);
}
