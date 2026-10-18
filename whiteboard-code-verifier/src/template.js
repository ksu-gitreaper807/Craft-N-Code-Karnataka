export const HEADER_CHOICES = [
  '#include <stdio.h>', '#include <stdlib.h>', '#include <string.h>', '#include <math.h>', '#include <stdbool.h>',
  '#include <stack.h>', '#include <linked_list.h>', '#include <queue.h>', '#include <search.h>',
];
export const GLOBAL_CHOICES = ['#define N 10', 'int counter = 0;'];
export const FUNCTION_CHOICES = [
  'static void swap(int *a, int *b) {\n    int t = *a;\n    *a = *b;\n    *b = t;\n}',
  'static void print_array(const int *values, int count) {\n    for (int i = 0; i < count; i++) printf("%d ", values[i]);\n    printf("\\n");\n}',
];

export const PRESETS = [
  { name: 'Basic I/O', template: { headers: ['#include <stdio.h>'], globals: [], functions: [] } },
  { name: 'Arrays & strings', template: { headers: ['#include <stdio.h>', '#include <stdlib.h>', '#include <string.h>'], globals: [], functions: [] } },
  { name: 'Math', template: { headers: ['#include <stdio.h>', '#include <math.h>'], globals: [], functions: [] } },
  { name: 'Data structures', template: { headers: ['#include <stdio.h>', '#include <stack.h>', '#include <linked_list.h>', '#include <queue.h>'], globals: [], functions: [] } },
];

export const DEFAULT_TEMPLATE = PRESETS[0].template;
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

// Split the program so the builder can highlight the teacher's own lines.
export function wrapParts(snippet, template) {
  const block = (items) => items.length ? [...items.flatMap((item) => item.split('\n')), ''] : [];
  const before = [...block(template.headers), ...block(template.globals), ...block(template.functions), 'int main(void) {'];
  const body = snippet.replace(/\s+$/, '').split('\n').map((line) => line ? `    ${line}` : line);
  return { before: before.join('\n'), body: body.join('\n'), after: '    return 0;\n}' };
}

// Snippet mode never rewrites a program that already declares main().
export function composeSource(snippet, template, enabled) {
  if (!enabled || !snippet.trim()) return { source: snippet, wrapped: false, skipped: false };
  if (hasMain(snippet)) return { source: snippet, wrapped: false, skipped: true };
  const { before, body, after } = wrapParts(snippet, template);
  return { source: `${before}\n${body}\n${after}`, wrapped: true, skipped: false };
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
