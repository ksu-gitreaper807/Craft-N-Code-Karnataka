// Every header here is on the runner's allow list (runner/runner.py), so a chosen template always compiles.
export const HEADER_CHOICES = [
  '#include <iostream>', '#include <vector>', '#include <algorithm>', '#include <queue>', '#include <stack>', '#include <list>',
  '#include <deque>', '#include <map>', '#include <set>', '#include <unordered_map>', '#include <unordered_set>',
  '#include <string>', '#include <array>', '#include <numeric>', '#include <utility>',
  '#include <stdio.h>', '#include <stdlib.h>', '#include <string.h>', '#include <math.h>', '#include <stdbool.h>',
  '#include <stack.h>', '#include <linked_list.h>', '#include <queue.h>', '#include <search.h>',
];
export const GLOBAL_CHOICES = ['#define N 10', 'int counter = 0;', 'using namespace std;'];
export const FUNCTION_CHOICES = [
  'static void swap(int *a, int *b) {\n    int t = *a;\n    *a = *b;\n    *b = t;\n}',
  'static void print_array(const int *values, int count) {\n    for (int i = 0; i < count; i++) printf("%d ", values[i]);\n    printf("\\n");\n}',
];

// Presets reuse the project's teaching headers (runner/lib) and the C++ standard library; they never add main().
export const PRESETS = [
  { name: 'Basic I/O', template: { headers: ['#include <stdio.h>'], globals: [], functions: [] } },
  { name: 'C++ STL', template: { headers: ['#include <iostream>', '#include <vector>', '#include <algorithm>'], globals: ['using namespace std;'], functions: [] } },
  { name: 'Arrays & strings', template: { headers: ['#include <stdio.h>', '#include <stdlib.h>', '#include <string.h>', '#include <search.h>'], globals: [], functions: [FUNCTION_CHOICES[1]] } },
  { name: 'Stack', template: { headers: ['#include <stdio.h>', '#include <stack.h>'], globals: [], functions: [] } },
  { name: 'Queue', template: { headers: ['#include <stdio.h>', '#include <queue.h>'], globals: [], functions: [] } },
  { name: 'Linked list', template: { headers: ['#include <stdio.h>', '#include <linked_list.h>'], globals: [], functions: [] } },
  { name: 'Data structures', template: { headers: ['#include <stdio.h>', '#include <stack.h>', '#include <linked_list.h>', '#include <queue.h>', '#include <search.h>'], globals: [], functions: [] } },
  { name: 'Math', template: { headers: ['#include <stdio.h>', '#include <math.h>'], globals: [], functions: [] } },
];

export const DEFAULT_TEMPLATE = PRESETS.find((item) => item.name === 'Basic I/O').template;
export const ZONES = [
  { key: 'headers', title: 'Headers', choices: HEADER_CHOICES },
  { key: 'globals', title: 'Globals', choices: GLOBAL_CHOICES },
  { key: 'functions', title: 'Functions', choices: FUNCTION_CHOICES },
];
const MAX_ITEMS = 20;
const MAX_ITEM_LENGTH = 600;
const TEMPLATE_KEY = 'boardroom.template';
const MODE_KEY = 'boardroom.snippetMode';

export function hasMain(snippet) {
  return /\bmain\s*\(/.test(snippet);
}

// The template block: headers, globals and helpers only. It never contains main(), return 0; or a closing brace.
export function templateBlock(template) {
  const block = (items) => items.length ? [...items.flatMap((item) => item.split('\n')), ''] : [];
  return [...block(template.headers), ...block(template.globals), ...block(template.functions)].join('\n').replace(/\n+$/, '');
}

// When the teacher edits the snippet-mode editor, its leading #include/#define/using lines stay the template part.
export function splitPreamble(text) {
  const lines = text.split('\n');
  let index = 0;
  while (index < lines.length && (!lines[index].trim() || /^\s*(#|using\s+namespace\b)/.test(lines[index]))) index++;
  return { preamble: lines.slice(0, index).join('\n').replace(/\s+$/, ''), body: lines.slice(index).join('\n') };
}

// Split the program so the builder can highlight the teacher's own lines. The snippet is not wrapped in main().
export function wrapParts(snippet, template) {
  return { before: templateBlock(template), body: snippet.replace(/\s+$/, ''), after: '' };
}

// Snippet mode shows the template followed by the teacher's lines; Gemini decides the structure when the code runs.
export function composeSource(snippet, template, enabled) {
  if (!enabled || !snippet.trim()) return { source: snippet, wrapped: false, skipped: false };
  const before = templateBlock(template);
  return { source: before ? `${before}\n\n${snippet.replace(/\s+$/, '')}` : snippet, wrapped: Boolean(before), skipped: false };
}

const characters = (text) => {
  const counts = new Map();
  for (const char of text.replace(/\s+/g, '')) counts.set(char, (counts.get(char) ?? 0) + 1);
  return counts;
};
// Scaffolding Gemini may add when it decides an entry point is appropriate; anything else means it changed the code.
const ENTRY_HEADERS = ['intmain(){', 'intmain(void){'];
const ENTRY_RETURNS = ['', 'return0;'];

// The structure step may reorder and re-indent code and wrap loose statements in main(), but must not fix, add or remove code.
export function checkStructure(original, structured) {
  const before = characters(original);
  const after = characters(structured);
  const added = new Map();
  for (const [char, count] of before) {
    const extra = (after.get(char) ?? 0) - count;
    if (extra < 0) return { ok: false, reason: `Gemini removed "${char}" from your code.` };
  }
  for (const [char, count] of after) {
    const extra = count - (before.get(char) ?? 0);
    if (extra > 0) added.set(char, extra);
  }
  if (!added.size) return { ok: true, entryAdded: false };
  for (const header of ENTRY_HEADERS) {
    for (const ret of ENTRY_RETURNS) {
      const allowed = characters(`${header}${ret}}`);
      if (allowed.size === added.size && [...allowed].every(([char, count]) => added.get(char) === count)) return { ok: true, entryAdded: true };
    }
  }
  const extras = [...added].map(([char, count]) => count > 1 ? `${char} ×${count}` : char).join(' ');
  return { ok: false, reason: `Gemini added code beyond an entry point (${extras}).` };
}

export function sanitizeTemplate(value) {
  const list = (items) => Array.isArray(items)
    ? items.filter((item) => typeof item === 'string' && item.trim() && item.length <= MAX_ITEM_LENGTH).slice(0, MAX_ITEMS) : [];
  return { headers: list(value?.headers), globals: list(value?.globals), functions: list(value?.functions) };
}

export function validCustomLine(zone, text) {
  const value = text.trim();
  if (!value || value.length > MAX_ITEM_LENGTH) return false;
  return zone !== 'headers' || /^#include <[a-z0-9_.]+>$/.test(value);
}

export function loadTemplate() {
  try {
    const stored = JSON.parse(localStorage.getItem(TEMPLATE_KEY));
    if (stored) return sanitizeTemplate(stored);
  } catch { /* storage can be unavailable or hold invalid JSON */ }
  return DEFAULT_TEMPLATE;
}

export function saveTemplate(template) {
  try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(sanitizeTemplate(template))); } catch { /* optional */ }
}

export function loadSnippetMode() {
  try { return localStorage.getItem(MODE_KEY) === 'on'; } catch { return false; }
}

export function saveSnippetMode(enabled) {
  try { localStorage.setItem(MODE_KEY, enabled ? 'on' : 'off'); } catch { /* optional */ }
}
