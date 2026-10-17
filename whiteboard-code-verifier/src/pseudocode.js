// Small, explicit teaching shorthand. This produces a review draft, never an automatic run.
export const PSEUDOCODE_LEVELS = [
  { value: 1, label: 'Level 1 · Finish statements' },
  { value: 2, label: 'Level 2 · Make a program' },
  { value: 3, label: 'Level 3 · Translate shorthand' },
];

const variable = /^[A-Za-z_]\w*$/;
const trimEndMark = (text) => text.replace(/;\s*$/, '').trim();

function finishStatement(line) {
  const code = line.trim();
  if (!code || /(?:=|\+=|-=|\*=|\/=)\s*$/.test(code) || /[;{}:]$/.test(code) || /^(?:#|\/\/|\/\*|\*|if\b|else\b|for\b|while\b|switch\b|do\b)/.test(code)) return line;
  if (/^(?:(?:(?:const|unsigned|signed|long|short)\s+)*(?:int|char|float|double|bool|size_t)\s+\**[A-Za-z_]\w*\b|return\b|(?:[A-Za-z_]\w*\s*(?:=(?!=)|\+=|-=|\*=|\/=|\+\+|--))|[A-Za-z_]\w*\s*\(.*\)$)/.test(code) &&
      (code.match(/\(/g)?.length ?? 0) === (code.match(/\)/g)?.length ?? 0)) return `${line};`;
  return line;
}

function looksUnfinished(line) {
  const code = line.trim();
  if (!code || /^(?:#|\/\/|\/\*|\*|\}|\{)/.test(code) || /[;{}:]$/.test(code)) return false;
  return !/^(?:if|else|for|while|switch|do)\b/.test(code);
}

export function preparePseudocode(source, level) {
  if (typeof source !== 'string' || ![1, 2, 3].includes(level)) throw new TypeError('Choose a pseudocode level from 1 to 3.');
  const issues = [];
  const input = source.replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  const declared = new Set();
  const blocks = [];
  let repeatCount = 0;
  let usesOutput = false;
  let usesInput = false;
  for (let index = 0; index < input.length; index++) {
    const original = input[index];
    const trimmed = original.trim();
    const indent = original.match(/^\s*/)[0];
    let line = original;
    if (level === 3 && trimmed) {
      let match;
      if ((match = trimmed.match(/^let\s+([A-Za-z_]\w*)\s+(?:be|=)\s+(.+)$/i)) && variable.test(match[1])) {
        line = `${indent}int ${match[1]} = ${trimEndMark(match[2])}`;
        declared.add(match[1]);
      } else if ((match = trimmed.match(/^set\s+([A-Za-z_]\w*)\s+to\s+(.+)$/i)) && variable.test(match[1])) {
        const value = trimEndMark(match[2]);
        const selfReference = !declared.has(match[1]) && new RegExp(`\\b${match[1]}\\b`).test(value);
        if (selfReference) issues.push({ line: index + 1, message: `Declare ${match[1]} before using it in its own value.` });
        else {
          line = `${indent}${declared.has(match[1]) ? '' : 'int '}${match[1]} = ${value}`;
          declared.add(match[1]);
        }
      } else if ((match = trimmed.match(/^print\s+("(?:\\.|[^"\\])*");?$/i))) {
        line = `${indent}puts(${match[1]})`;
        usesOutput = true;
      } else if ((match = trimmed.match(/^print\s+(.+)$/i))) {
        line = `${indent}printf("%d\\n", (int)(${trimEndMark(match[1])}))`;
        issues.push({ line: index + 1, message: 'Assumed integer output. Check the print expression.' });
        usesOutput = true;
      } else if ((match = trimmed.match(/^(?:read|input)\s+([A-Za-z_]\w*);?$/i))) {
        line = `${indent}${declared.has(match[1]) ? '' : `int ${match[1]}; `}if (scanf("%d", &${match[1]}) != 1) return 1;`;
        declared.add(match[1]);
        issues.push({ line: index + 1, message: 'Assumed integer input. Check the input variable.' });
        usesInput = true;
      } else if ((match = trimmed.match(/^if\s+(.+?)\s+then$/i))) {
        line = `${indent}if (${match[1]}) {`;
        blocks.push('if');
      } else if (/^(?:otherwise|else)$/i.test(trimmed) && blocks.at(-1) === 'if') {
        line = `${indent}} else {`;
      } else if (/^end\s*if$/i.test(trimmed) && blocks.at(-1) === 'if') {
        line = `${indent}}`;
        blocks.pop();
      } else if ((match = trimmed.match(/^while\s+(.+?)\s+do$/i))) {
        line = `${indent}while (${match[1]}) {`;
        blocks.push('while');
      } else if (/^end\s*while$/i.test(trimmed) && blocks.at(-1) === 'while') {
        line = `${indent}}`;
        blocks.pop();
      } else if ((match = trimmed.match(/^(increment|decrement)\s+([A-Za-z_]\w*);?$/i))) {
        if (declared.has(match[2])) line = `${indent}${match[2]}${match[1].toLowerCase() === 'increment' ? '++' : '--'}`;
        else issues.push({ line: index + 1, message: `Declare ${match[2]} before changing it.` });
      } else if ((match = trimmed.match(/^repeat\s+(.+?)\s+times$/i))) {
        repeatCount++;
        let counter = `boardroom_repeat_${repeatCount}`;
        while (source.includes(counter)) counter = `boardroom_repeat_${++repeatCount}`;
        line = `${indent}for (int ${counter} = 0; ${counter} < (${match[1]}); ${counter}++) {`;
        blocks.push('repeat');
      } else if (/^end\s*repeat$/i.test(trimmed) && blocks.at(-1) === 'repeat') {
        line = `${indent}}`;
        blocks.pop();
      }
      const declaration = line.trim().match(/^int\s+([A-Za-z_]\w*)\b/);
      if (declaration) declared.add(declaration[1]);
    }
    if (level >= 1) line = finishStatement(line);
    if (looksUnfinished(line)) issues.push({ line: index + 1, message: 'This line was kept as written. Finish or edit it before running.' });
    output.push(line);
  }
  if (blocks.length) issues.push({ line: input.length, message: `Close ${blocks.length} unfinished if/while/repeat block(s) before running.` });
  let prepared = output.join('\n');
  const hasMain = /^\s*(?:int|void)\s+main\s*\(/m.test(prepared);
  if (level >= 2 && !hasMain) {
    const parts = prepared.split('\n');
    const headers = parts.filter((line) => /^\s*#\s*include\s+</.test(line));
    const body = parts.filter((line) => !/^\s*#\s*include\s+</.test(line)).join('\n').trimEnd();
    prepared = [...headers, ...(headers.length ? [''] : []), 'int main(void) {',
      ...body.split('\n').map((line) => line ? `    ${line}` : ''),
      '    return 0;', '}'].join('\n');
  } else if (level === 1 && !hasMain) {
    issues.push({ line: 1, message: 'This still needs a main function. Level 2 can wrap the snippet.' });
  }
  if (level >= 2 && (usesOutput || usesInput || /\b(?:printf|puts|scanf)\s*\(/.test(prepared)) &&
      !/^\s*#\s*include\s*<stdio\.h>/m.test(prepared)) prepared = `#include <stdio.h>\n\n${prepared}`;
  return { source: prepared, issues };
}
