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
