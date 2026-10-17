import React, { forwardRef, useImperativeHandle, useRef } from 'react';

const LINE_HEIGHT = 20;

// A textarea over a mirrored layer: the mirror draws wavy underlines under error lines.
const CodeEditor = forwardRef(function CodeEditor({
  id, value, onChange, diagnostics = [], readOnly = false, disabled = false, placeholder = '',
}, ref) {
  const area = useRef(null);
  const backdrop = useRef(null);
  const gutter = useRef(null);
  const lines = value.split('\n');
  const marks = new Map();
  for (const diagnostic of diagnostics) {
    const entry = marks.get(diagnostic.line) ?? { severity: 'warning', messages: [] };
    if (diagnostic.severity !== 'warning') entry.severity = 'error';
    entry.messages.push(diagnostic.message);
    marks.set(diagnostic.line, entry);
  }

  useImperativeHandle(ref, () => ({
    focusLine(line) {
      const input = area.current;
      if (!input) return;
      const start = lines.slice(0, line - 1).reduce((total, text) => total + text.length + 1, 0);
      input.focus();
      input.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
      input.scrollTop = Math.max(0, (line - 3) * LINE_HEIGHT);
    },
  }));

  function syncScroll() {
    const input = area.current;
    backdrop.current.scrollTop = input.scrollTop;
    backdrop.current.scrollLeft = input.scrollLeft;
    gutter.current.scrollTop = input.scrollTop;
  }

  return <div className="code-view">
    <div className="code-gutter" ref={gutter} aria-hidden="true">
      {lines.map((_, index) => {
        const mark = marks.get(index + 1);
        return <div key={index} className={mark ? `mark-${mark.severity}` : ''} title={mark?.messages.join('\n')}>{index + 1}</div>;
      })}
    </div>
    <div className="code-stack">
      <div className="code-backdrop" ref={backdrop} aria-hidden="true">
        {lines.map((line, index) => {
          const mark = marks.get(index + 1);
          return <div className="code-line" key={index}>{mark ? <span className={`squiggle ${mark.severity}`}>{line || ' '}</span> : (line || ' ')}</div>;
        })}
      </div>
      <textarea id={id} ref={area} className="code-input" value={value} spellCheck={false} wrap="off"
        readOnly={readOnly} disabled={disabled} placeholder={placeholder}
        onScroll={syncScroll} onChange={(event) => onChange(event.target.value)} />
    </div>
  </div>;
});

export default CodeEditor;
