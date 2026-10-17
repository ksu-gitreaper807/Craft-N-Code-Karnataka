# Live OCR smoke sample

`synthetic-code.png` was rendered with Excalidraw's Excalifont, not written by a person. Its exact text is in `synthetic-code.expected.c`. The missing `&` in `scanf` and missing semicolon after `printf` are intentional: OCR must preserve both mistakes.

With `GEMINI_API_KEY` configured locally, run from the app root:

```bash
npm run test:ocr -- tests/fixtures/ocr/synthetic-code.png
```

This makes a real provider request and prints the unconfirmed transcription. It never compiles or executes it. Compare punctuation, indentation, and all seven lines with the expected file. The command is opt-in and is not part of `npm test`.

Gemini 3.8 Flash returned all seven lines faithfully in a local smoke check on 2026-10-17. This proves API integration on one synthetic sample; it does not establish accuracy on human handwriting.
