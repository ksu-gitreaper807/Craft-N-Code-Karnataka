import React, { useEffect, useRef, useState } from 'react';

export default function WorkspaceLayout({ children, focused, onResize }) {
  const container = useRef(null);
  const drag = useRef(null);
  const [width, setWidth] = useState(380);
  const [maximum, setMaximum] = useState(900);
  const [board, inspector] = React.Children.toArray(children);

  useEffect(() => {
    let refresh;
    const observer = new ResizeObserver(() => {
      setMaximum(Math.max(320, container.current.clientWidth - 320));
      cancelAnimationFrame(refresh);
      refresh = requestAnimationFrame(onResize);
    });
    observer.observe(container.current.firstElementChild);
    return () => { observer.disconnect(); cancelAnimationFrame(refresh); };
  }, [onResize]);

  const resize = (next) => setWidth(Math.max(320, Math.min(maximum, next)));
  return <div ref={container} className={`workspace${focused ? ' workspace--focused' : ''}`} style={{ '--inspector-width': `${Math.min(width, maximum)}px` }}>
    {board}
    <div className="panel-divider" role="separator" aria-label="Resize code and results panel"
      aria-orientation="vertical" aria-valuemin={320} aria-valuemax={maximum}
      aria-valuenow={Math.min(width, maximum)} tabIndex={focused ? -1 : 0} hidden={focused}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        drag.current = { x: event.clientX, width: Math.min(width, maximum) };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => { if (drag.current) resize(drag.current.width + drag.current.x - event.clientX); }}
      onPointerUp={(event) => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={(event) => {
        const next = { ArrowLeft: width + 32, ArrowRight: width - 32, Home: 320, End: maximum }[event.key];
        if (next === undefined) return;
        event.preventDefault(); resize(next);
      }}><span /></div>
    {inspector}
  </div>;
}
