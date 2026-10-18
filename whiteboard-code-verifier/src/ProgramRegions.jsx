import React, { useEffect, useState } from 'react';

// Selection is a view decoration, so it never becomes ink or part of an exported lesson.
export default function ProgramRegions({ api, frames, selectedId }) {
  const [camera, setCamera] = useState({ scrollX: 0, scrollY: 0, zoom: 1 });
  useEffect(() => {
    if (!api) return undefined;
    const update = (_elements, state = api.getAppState()) => {
      const next = { scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value };
      setCamera(previous => previous.scrollX === next.scrollX && previous.scrollY === next.scrollY && previous.zoom === next.zoom ? previous : next);
    };
    update();
    return api.onChange(update);
  }, [api]);

  return <div className="program-regions" aria-hidden="true">
    {frames.map((frame, index) => <div key={frame.id} data-program-region={frame.id}
      data-selected={frame.id === selectedId} className="program-region" style={{
        left: (frame.x + camera.scrollX) * camera.zoom,
        top: (frame.y + camera.scrollY) * camera.zoom,
        width: frame.width * camera.zoom, height: frame.height * camera.zoom,
        transform: `rotate(${frame.angle ?? 0}rad)`,
      }}>
      <span className="program-region-label">Selected program #{index + 1}</span>
    </div>)}
  </div>;
}
