import React, { useEffect, useRef, useState } from 'react';

const MINIMUM = 160;

// Board on top, a resizable dock underneath.
export default function WorkspaceLayout({ children, focused, onResize }) {
  const container = useRef(null);
  const drag = useRef(null);
  const [height, setHeight] = useState(320);
  const [maximum, setMaximum] = useState(600);
  const [board, dock] = React.Children.toArray(children);

  useEffect(() => {
    let refresh;
    const observer = new ResizeObserver(() => {
      setMaximum(Math.max(MINIMUM, container.current.clientHeight - 200));
      cancelAnimationFrame(refresh);
      refresh = requestAnimationFrame(onResize);
    });
    observer.observe(container.current.firstElementChild);
    return () => { observer.disconnect(); cancelAnimationFrame(refresh); };
  }, [onResize]);

  const resize = (next) => setHeight(Math.max(MINIMUM, Math.min(maximum, next)));
  const current = Math.min(height, maximum);
  return <div ref={container} className={`workspace${focused ? ' workspace--focused' : ''}`} style={{ '--dock-height': `${current}px` }}>
    {board}
    <div className="panel-divider" role="separator" aria-label="Resize code and results panel"
      aria-orientation="horizontal" aria-valuemin={MINIMUM} aria-valuemax={maximum}
      aria-valuenow={current} tabIndex={focused ? -1 : 0} hidden={focused}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        drag.current = { y: event.clientY, height: current };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => { if (drag.current) resize(drag.current.height + drag.current.y - event.clientY); }}
      onPointerUp={(event) => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={(event) => {
        const next = { ArrowUp: height + 32, ArrowDown: height - 32, Home: MINIMUM, End: maximum }[event.key];
        if (next === undefined) return;
        event.preventDefault(); resize(next);
      }}><span /></div>
    {dock}
  </div>;
}
