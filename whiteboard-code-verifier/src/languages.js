export const LANGUAGES = [
  { id: 'c', label: 'C++', tag: 'C++17', file: 'board.cpp' },
  { id: 'python', label: 'Python', tag: 'Python 3', file: 'board.py' },
];

export const validLanguage = (value) => value === undefined || LANGUAGES.some((item) => item.id === value);
export const languageInfo = (value = 'c') => LANGUAGES.find((item) => item.id === value);
export const languagePayload = (value) => value === 'python' ? { language: 'python' } : {};
