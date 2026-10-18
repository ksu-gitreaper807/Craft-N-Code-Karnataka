import React, { useEffect, useRef, useState } from 'react';
import { PRESETS, ZONES, sanitizeTemplate, validCustomLine, wrapParts } from './template.js';

const firstLine = (item) => item.includes('\n') ? `${item.split('\n')[0]} …` : item;

export default function SnippetBuilder({ open, template, snippet, enabled, onApply, onTurnOff, onClose }) {
  const [draft, setDraft] = useState(template);
  const [custom, setCustom] = useState({ headers: '', globals: '', functions: '' });
  const [message, setMessage] = useState('');
  const [over, setOver] = useState('');
  const dialog = useRef(null);

  useEffect(() => {
    if (!open) return;
    setDraft(template); setCustom({ headers: '', globals: '', functions: '' }); setMessage('');
    dialog.current?.focus();
  }, [open, template]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open, onClose]);
  if (!open) return null;

  const add = (zone, item) => {
    setMessage('');
    setDraft((previous) => {
      if (previous[zone].includes(item)) { setMessage('Already in the template.'); return previous; }
      if (previous[zone].length >= 20) { setMessage('That section is full.'); return previous; }
      return { ...previous, [zone]: [...previous[zone], item] };
    });
  };
  const remove = (zone, index) => setDraft((previous) => ({ ...previous, [zone]: previous[zone].filter((_, at) => at !== index) }));
  const addCustom = (zone) => {
    if (!validCustomLine(zone, custom[zone])) {
      setMessage(zone === 'headers' ? 'Use the form #include <vector> or #include <name.h>.' : 'Enter a line of C++, at most 600 characters.');
      return;
    }
    add(zone, custom[zone].trim());
    setCustom((previous) => ({ ...previous, [zone]: '' }));
  };
  const drop = (event, zone) => {
    event.preventDefault(); setOver('');
    try {
      const payload = JSON.parse(event.dataTransfer.getData('text/plain'));
      if (payload.zone !== zone) { setMessage(`That block belongs under ${ZONES.find((item) => item.key === payload.zone).title}.`); return; }
      add(zone, payload.item);
    } catch { /* ignore drops that did not come from the palette */ }
  };

  const parts = wrapParts(snippet.trim() ? snippet : '// your snippet goes here', draft);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="builder" role="dialog" aria-modal="true" aria-labelledby="builder-title" tabIndex={-1} ref={dialog}>
      <header className="builder-head">
        <h2 id="builder-title">Snippet mode: build your template</h2>
        <button className="quiet-button" aria-label="Close template builder" onClick={onClose}>×</button>
      </header>
      <div className="builder-presets" role="group" aria-label="Template presets">
        <span>Start from</span>
        {PRESETS.map((preset) => <button key={preset.name} className="quiet-button" onClick={() => setDraft(sanitizeTemplate(preset.template))}>{preset.name}</button>)}
      </div>
      <div className="builder-body">
        <section className="builder-palette" aria-label="Blocks">
          <h3>Blocks</h3>
          {ZONES.map((zone) => <div key={zone.key}>
            <h4>{zone.title}</h4>
            {zone.choices.map((item) => <button key={item} className="chip" draggable
              onDragStart={(event) => { event.dataTransfer.setData('text/plain', JSON.stringify({ zone: zone.key, item })); event.dataTransfer.effectAllowed = 'copy'; }}
              onClick={() => add(zone.key, item)} title="Click to add, or drag into the template">{firstLine(item)}</button>)}
          </div>)}
          <p className="panel-help">Click a block to add it, or drag it into its section.</p>
        </section>
        <section className="builder-template" aria-label="Template">
          <h3>Template</h3>
          {ZONES.map((zone) => <div key={zone.key} className={`zone${over === zone.key ? ' over' : ''}`}
            onDragOver={(event) => { event.preventDefault(); setOver(zone.key); }} onDragLeave={() => setOver('')} onDrop={(event) => drop(event, zone.key)}>
            <h4>{zone.title}</h4>
            {draft[zone.key].length === 0 && <p className="panel-help">Drop blocks here</p>}
            <ul>{draft[zone.key].map((item, index) => <li key={item}><code>{firstLine(item)}</code>
              <button aria-label={`Remove ${firstLine(item)}`} onClick={() => remove(zone.key, index)}>×</button></li>)}</ul>
            <div className="zone-custom">
              <input aria-label={`Add your own ${zone.title.toLowerCase()} line`} placeholder={zone.key === 'headers' ? '#include <name.h>' : 'Your own line'}
                value={custom[zone.key]} onChange={(event) => setCustom((previous) => ({ ...previous, [zone.key]: event.target.value }))}
                onKeyDown={(event) => { if (event.key === 'Enter') addCustom(zone.key); }} />
              <button className="quiet-button" onClick={() => addCustom(zone.key)}>Add</button>
            </div>
          </div>)}
          <div className="zone zone-main"><h4>Your snippet</h4><p>Your lines from the board go below the template. When you run, Gemini arranges them into helper functions and, if needed, main(). It never fixes errors.</p></div>
        </section>
        <section className="builder-preview" aria-label="Full program preview">
          <h3>Full program that will run</h3>
          <pre><code>{parts.before}{'\n'}<mark>{parts.body}</mark>{'\n'}{parts.after}</code></pre>
          <p className="panel-help">The template holds only headers, globals and helpers: no main(). The organized program Gemini produces is shown with the results.</p>
        </section>
      </div>
      <footer className="builder-foot">
        <span role="status">{message}</span>
        {enabled && <button className="quiet-button" onClick={onTurnOff}>Turn snippet mode off</button>}
        <button className="quiet-button" onClick={onClose}>Cancel</button>
        <button className="run-button builder-apply" onClick={() => onApply(sanitizeTemplate(draft))}>Use this template</button>
      </footer>
    </div>
  </div>;
}
