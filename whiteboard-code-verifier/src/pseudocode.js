export const PSEUDOCODE_LEVELS = [
  { value: 1, label: 'Check code', description: 'Compile your code as written. Gemini explains errors and shows a corrected version.' },
  { value: 2, label: 'Fill the gaps', description: 'Write C without boilerplate or semicolons. Gemini corrects it, then the compiler runs the returned C.' },
  { value: 3, label: 'Demonstrate an algorithm', description: 'Write an algorithm in plain language or pseudocode. Gemini creates a small C demonstration and the compiler runs it.' },
];

export const PYTHON_PSEUDOCODE_LEVELS = [
  { value: 1, label: 'Check code', description: 'Run your Python as written. Gemini explains errors and shows a corrected version.' },
  { value: 2, label: 'Fill the gaps', description: 'Gemini completes missing colons, indentation, imports and syntax, then runs the returned Python.' },
  { value: 3, label: 'Demonstrate an algorithm', description: 'Write an algorithm in plain language or pseudocode. Gemini creates and runs a small Python demonstration.' },
];

// The run modes shown on the slider. Only Algorithm sends typed code to Gemini.
export const CODE_MODES = [
  { value: 1, label: 'Full program', description: 'Compiles exactly what you wrote. No corrections, no AI.' },
  { value: 2, label: 'Snippet', description: 'Gemini arranges your lines into helpers and main() under your template, without fixing anything, then it compiles.' },
  { value: 3, label: 'Algorithm', description: 'Gemini turns your steps into a program, then it runs.' },
];
export const PYTHON_CODE_MODES = [
  { value: 1, label: 'Full program', description: 'Runs exactly what you wrote. No corrections, no AI.' },
  { value: 2, label: 'Snippet', description: 'Templates are for C++, so Python runs as written. No AI.' },
  { value: 3, label: 'Algorithm', description: 'Gemini turns your steps into Python, then it runs.' },
];
