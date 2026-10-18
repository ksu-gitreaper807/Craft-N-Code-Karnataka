import { exportToCanvas, getCommonBounds } from '@excalidraw/excalidraw';
import { channelElements, handwritingChannels } from './handwriting.js';

export async function captureHandwriting(api, elements, frameId, selectedChannels = ['code', 'stdin']) {
  const channels = handwritingChannels(elements, frameId);
  const captures = {};
  for (const channel of selectedChannels) {
    if (!channels[channel]) continue;
    const ink = channelElements(elements, frameId, channel);
    const [left, top, right, bottom] = getCommonBounds(ink);
    const padding = 16;
    const bounds = { x: left - padding, y: top - padding,
      width: right - left + 2 * padding, height: bottom - top + 2 * padding };
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
        bounds.width <= 0 || bounds.height <= 0) throw new Error('This handwriting has invalid dimensions.');
    const canvas = await exportToCanvas({
      // The frame border and other annotation colors never enter the provider image.
      elements: ink.map((el) => ({ ...el, frameId: null })),
      files: api.getFiles(), exportPadding: padding,
      appState: { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false },
      getDimensions: (width, height) => {
        // Preserve native pixels unless the padded crop exceeds the OCR limit.
        const scale = Math.min(1, 1800 / Math.max(width, height));
        return { width: Math.max(1, Math.ceil(width * scale)), height: Math.max(1, Math.ceil(height * scale)), scale };
      },
    });
    captures[channel] = { dataUrl: canvas.toDataURL('image/png'), bounds, elementIds: ink.map((el) => el.id) };
  }
  if (!Object.keys(captures).length) throw new Error('Write in black or blue inside the selected frame first.');
  return captures;
}
