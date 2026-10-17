import { readFile } from 'node:fs/promises';
import { loadOcrEnvironment, recognizeHandwriting } from '../server/ocr.mjs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: npm run test:ocr -- /absolute/path/to/handwritten-code.png');
  process.exitCode = 1;
} else {
  loadOcrEnvironment();
  let httpStatus;
  try {
    const image = await readFile(path);
    const result = await recognizeHandwriting({ code: `data:image/png;base64,${image.toString('base64')}` }, {
      fetchImpl: async (...args) => {
        const response = await fetch(...args);
        httpStatus = response.status;
        return response;
      },
    });
    console.log(`OCR response: HTTP ${httpStatus} · ${result.provider}/${result.model} · ${result.durationMs} ms`);
    console.log(`Recognized ${result.code.length} lines; ${result.code.filter((line) => line.uncertain).length} marked ambiguous.`);
    console.log('Transcription (unconfirmed; nothing will be compiled or executed):');
    console.log(result.code.map((line) => line.text).join('\n'));
  } catch (error) {
    console.error(`${httpStatus ? `HTTP ${httpStatus}: ` : ''}${error.message}`);
    process.exitCode = 1;
  }
}
