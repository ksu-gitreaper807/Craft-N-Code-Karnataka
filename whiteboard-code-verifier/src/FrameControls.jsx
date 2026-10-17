import React, { useEffect, useState } from 'react';

export default function FrameControls({ frame, disabled, onResize, onFit }) {
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  useEffect(() => {
    setWidth(String(Math.ceil(frame?.width ?? 710)));
    setHeight(String(Math.ceil(frame?.height ?? 530)));
  }, [frame?.id, frame?.width, frame?.height]);
  return <form className="frame-controls" aria-label="Program frame size" onSubmit={(event) => {
    event.preventDefault();
    if (!frame || disabled) return;
    const applied = onResize(Number(width), Number(height));
    // A smaller request may be clamped to preserve the existing writing.
    if (applied) {
      setWidth(String(Math.ceil(applied.width)));
      setHeight(String(Math.ceil(applied.height)));
    }
  }}>
    <span>Writing frame</span>
    <label>Width<input aria-label="Frame width" type="number" min="320" step="1" required value={width} disabled={disabled || !frame} onChange={(event) => setWidth(event.target.value)} /></label>
    <label>Height<input aria-label="Frame height" type="number" min="240" step="1" required value={height} disabled={disabled || !frame} onChange={(event) => setHeight(event.target.value)} /></label>
    <button disabled={disabled || !frame}>Apply size</button>
    <button type="button" disabled={disabled || !frame} onClick={() => onResize(frame.width, Math.ceil(frame.height * 1.5))}>+ More room</button>
    <button type="button" disabled={!frame} onClick={onFit}>Fit frame</button>
  </form>;
}
