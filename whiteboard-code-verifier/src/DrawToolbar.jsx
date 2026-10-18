import React, { useEffect, useRef, useState } from 'react';

export const STROKE_WIDTHS = [1, 2, 4, 6, 10];
export const INK_COLORS = [
  { color: '#1e1e1e', name: 'Black · code' },
  { color: '#1971c2', name: 'Blue · input' },
  { color: '#2f9e44', name: 'Green' },
  { color: '#e03131', name: 'Red' },
  { color: '#f08c00', name: 'Orange' },
  { color: '#9c36b5', name: 'Purple' },
];
const SHAPES = [
  { type: 'rectangle', label: 'Rectangle' },
  { type: 'diamond', label: 'Diamond' },
  { type: 'ellipse', label: 'Ellipse' },
  { type: 'arrow', label: 'Arrow' },
  { type: 'line', label: 'Line' },
];
const SHAPE_TYPES = SHAPES.map((shape) => shape.type);

const paths = {
  pen: <path d="M4 20l1.2-4.6L16.5 4.1a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z M14.5 6l3.5 3.5" />,
  eraser: <><path d="M16 4l5 5-10.5 10.5H5.5L3 17z" /><path d="M10 9l5 5M9 20h12" /></>,
  hand: <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-7a1.5 1.5 0 0 1 3 0v7m0-5.5a1.5 1.5 0 0 1 3 0V13m0-4a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L4 16.2a1.6 1.6 0 0 1 2.5-2L8 15.5" />,
  selection: <path d="M5 3l14 7.5-6 1.8-2.4 6.2z" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  unlock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.5-2" /></>,
  text: <path d="M5 5h14M12 5v15M9 20h6" />,
  shapes: <><rect x="3" y="13" width="8" height="8" rx="1" /><circle cx="17" cy="17" r="4" /><path d="M12 3l4.5 7h-9z" /></>,
  laser: <><path d="M4 20 15 9" /><circle cx="17.5" cy="6.5" r="3" /><path d="M17.5 1.5v1.5M22.5 6.5H21M21 3l-1 1" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></>,
  rectangle: <rect x="4" y="6" width="16" height="12" rx="1" />,
  diamond: <path d="M12 3l9 9-9 9-9-9z" />,
  ellipse: <ellipse cx="12" cy="12" rx="9" ry="6.5" />,
  arrow: <path d="M4 20 20 4m0 0h-7m7 0v7" />,
  line: <path d="M4 20 20 4" />,
  check: <path d="m5 12 4 4L19 6" />,
};

function ToolIcon({ name }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function ToolButton({ name, label, active, onClick, ...rest }) {
  return <button className={`draw-tool${active ? ' active' : ''}`} aria-label={label} aria-pressed={active} title={label} onClick={onClick} {...rest}>
    <ToolIcon name={name} /><span>{label}</span>
  </button>;
}

// A docked-at-top drawing bar that drives Excalidraw's own tools; it exists only while drawing tools are open.
export default function DrawToolbar({ activeTool, locked, strokeWidth, color, onTool, onLock, onStrokeWidth, onColor, onClose }) {
  const [shapesOpen, setShapesOpen] = useState(false);
  const shapesRef = useRef(null);
  useEffect(() => {
    if (!shapesOpen) return undefined;
    const close = (event) => { if (!shapesRef.current?.contains(event.target)) setShapesOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [shapesOpen]);
  const shape = SHAPES.find((item) => item.type === activeTool);

  return <div className="draw-toolbar" role="toolbar" aria-label="Drawing tools">
    <div className="draw-group">
      <ToolButton name="pen" label="Pen" active={activeTool === 'freedraw'} onClick={() => onTool('freedraw')} />
      <ToolButton name="eraser" label="Eraser" active={activeTool === 'eraser'} onClick={() => onTool('eraser')} />
    </div>
    <div className="draw-group">
      <ToolButton name="hand" label="Hand" active={activeTool === 'hand'} onClick={() => onTool('hand')} />
      <ToolButton name="selection" label="Select" active={activeTool === 'selection'} onClick={() => onTool('selection')} />
      <ToolButton name={locked ? 'lock' : 'unlock'} label={locked ? 'Tool locked' : 'Lock tool'} active={locked} onClick={onLock} />
    </div>
    <div className="draw-group">
      <ToolButton name="text" label="Text" active={activeTool === 'text'} onClick={() => onTool('text')} />
      <div className="shapes-menu" ref={shapesRef}>
        <ToolButton name={shape ? shape.type : 'shapes'} label="Shapes" active={SHAPE_TYPES.includes(activeTool)} aria-haspopup="true" aria-expanded={shapesOpen}
          onClick={() => setShapesOpen((open) => !open)} />
        {shapesOpen && <div className="shapes-popover" role="group" aria-label="Shapes">
          {SHAPES.map((item) => <ToolButton key={item.type} name={item.type} label={item.label} active={activeTool === item.type}
            onClick={() => { onTool(item.type); setShapesOpen(false); }} />)}
        </div>}
      </div>
      <ToolButton name="laser" label="Laser" active={activeTool === 'laser'} onClick={() => onTool('laser')} />
      <ToolButton name="image" label="Image" active={activeTool === 'image'} onClick={() => onTool('image')} />
    </div>
    <div className="draw-group draw-widths" role="group" aria-label="Stroke thickness">
      {STROKE_WIDTHS.map((width) => <button key={width} className={`width-dot${strokeWidth === width ? ' active' : ''}`}
        aria-label={`Stroke ${width}`} aria-pressed={strokeWidth === width} title={`Stroke thickness ${width}`} onClick={() => onStrokeWidth(width)}>
        <i style={{ width: Math.min(22, 4 + width * 1.8), height: Math.min(22, 4 + width * 1.8) }} />
      </button>)}
    </div>
    <div className="draw-group draw-colors" role="group" aria-label="Ink colour">
      {INK_COLORS.map((item) => <button key={item.color} className={`swatch${color === item.color ? ' selected' : ''}`} style={{ backgroundColor: item.color }}
        aria-label={`Ink ${item.name}`} aria-pressed={color === item.color} title={item.name} onClick={() => onColor(item.color)} />)}
    </div>
    <button className="draw-tool draw-done" aria-label="Close drawing tools" title="Hide drawing tools" onClick={onClose}><ToolIcon name="check" /><span>Done</span></button>
  </div>;
}
