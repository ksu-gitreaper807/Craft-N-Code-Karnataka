export const MAX_CASES = 20;
export const CASE_STATUSES = [
  ['success', 'Completes'], ['compile_error', 'Compiler error'], ['runtime_error', 'Runtime issue'],
  ['timeout', 'Time limit'], ['output_limit', 'Output limit'],
];
export const emptyCase = (id) => ({ id, name: `Case ${id}`, stdin: '', expectedStatus: 'success', checkOutput: false, expectedOutput: '', comparison: 'exact' });
export const suiteKey = (language = 'c') => `boardroom-test-cases:${language}`;
export function validateSuite(value, language = 'c') {
  if (!value || value.version !== 1 || value.language !== language || !Array.isArray(value.cases) ||
      !value.cases.length || value.cases.length > MAX_CASES) throw new Error(`Import a ${language === 'python' ? 'Python' : 'C++'} suite with 1–${MAX_CASES} cases.`);
  const encoder = new TextEncoder();
  return value.cases.map((item, index) => {
    if (!item || typeof item.name !== 'string' || item.name.length > 60 || typeof item.stdin !== 'string' ||
        item.stdin.includes('\0') || encoder.encode(item.stdin).length > 8192 ||
        !CASE_STATUSES.some(([status]) => status === item.expectedStatus) || typeof item.checkOutput !== 'boolean' ||
        typeof item.expectedOutput !== 'string' || encoder.encode(item.expectedOutput).length > 16_384 ||
        !['exact', 'trim', 'whitespace'].includes(item.comparison ?? 'exact')) throw new Error(`Case ${index + 1} has invalid fields or exceeds the input/output size limits.`);
    return { ...emptyCase(index + 1), name: item.name, stdin: item.stdin, expectedStatus: item.expectedStatus,
      checkOutput: item.checkOutput, expectedOutput: item.expectedOutput, comparison: item.comparison ?? 'exact' };
  });
}
export function normalizeOutput(value, comparison = 'exact') {
  if (comparison === 'trim') return value.trim();
  if (comparison === 'whitespace') return value.trim().replace(/\s+/g, ' ');
  return value;
}
export function compareOutput(expected, actual, comparison = 'exact') {
  const a = normalizeOutput(expected, comparison), b = normalizeOutput(actual, comparison);
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index++;
  const prefix = a.slice(0, index).split('\n');
  return { matched: a === b, line: prefix.length, column: prefix.at(-1).length + 1,
    expected: index < a.length ? JSON.stringify(a[index]) : 'EOF', actual: index < b.length ? JSON.stringify(b[index]) : 'EOF' };
}
