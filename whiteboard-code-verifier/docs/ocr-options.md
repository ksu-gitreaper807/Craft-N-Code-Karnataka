# Handwritten code OCR: options and implementation

## Decision

Implement Gemini as the first provider, with a required teacher review step. This is a practical integration choice, not a claim that Gemini is the most accurate OCR system for handwritten C. No provider has yet been benchmarked on this project's real classroom handwriting.

Gemini accepts images and schema-constrained output, so one request can return source/input lines, alternate readings, ambiguity flags, and approximate line boxes. The backend uses its [documented Interactions REST API](https://ai.google.dev/gemini-api/docs/interactions) and [structured output format](https://ai.google.dev/gemini-api/docs/structured-output). `OCR_MODEL` is configurable; the default follows the current documentation's `gemini-3.8-flash` examples. Model availability and quotas depend on the user's project.

## Options researched

| Option | Useful capability | Tradeoff for this board |
| --- | --- | --- |
| [Gemini vision](https://ai.google.dev/gemini-api/docs/image-understanding) | Image understanding and structured output. | Can infer or repair code instead of faithfully transcribing it. The prompt forbids repairs; teacher review remains mandatory. Geometry is model-estimated. |
| [Google Cloud Vision](https://cloud.google.com/vision/docs/handwriting) | Dedicated handwriting recognition through document text detection, with text geometry. | Needs reconstruction of code indentation, reading order, and punctuation. A strong candidate for comparing text localization against Gemini. |
| [Mistral OCR](https://docs.mistral.ai/studio/document-processing/basic_ocr) | Document/image OCR and document structure. | Needs evaluation on sparse board writing and C symbols; document OCR quality does not establish source-code transcription accuracy. |
| [MyScript iink](https://developer.myscript.com/docs/interactive-ink/4.3/web/rest/architecture/) | Digital-ink recognition API suited to stroke input. | Requires mapping Excalidraw strokes to its protocol, account/license setup, and a code-specific evaluation. |
| [PaddleOCR PP-OCRv5](https://paddlepaddle.github.io/PaddleOCR/v3.0.0/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5.html) | Self-hosted text detection and recognition with handwriting support. | Requires model deployment and code/indentation reconstruction. Worth evaluating for offline or private classroom operation. |
| [TrOCR handwritten](https://huggingface.co/microsoft/trocr-base-handwritten) | A self-hosted handwritten text-line recognition checkpoint. | The model card targets individual text-line images; full boards need segmentation. C punctuation and operator accuracy require separate measurement. |
| [OpenAI vision](https://developers.openai.com/api/docs/guides/images-vision) | Image inputs with text output. | An alternative vision-model provider with the same need to guard against inferred code and require human review. |

Prices, quotas, and accuracy rankings are deliberately omitted: no paid-provider comparison or classroom benchmark has been run. Select a provider on measured correction time and symbol accuracy, not a generic OCR leaderboard.

## Implemented flow

1. A teacher creates a handwritten frame and writes with the black or blue pen controls.
2. The browser exports separate PNG crops for code and stdin. Frame borders, verifier highlights, and other annotation colors are excluded. Typed-only channels bypass OCR and preserve their exact original text.
3. `POST /api/ocr` validates PNG payloads. The backend sends the images to Gemini using the server-side `GEMINI_API_KEY`. No key or whole scene is sent to the frontend/provider respectively.
4. The response is checked against bounded text/coordinate constraints. It includes one entry per recognized line, an ambiguity flag, and optional alternate readings. Model-reported ambiguity is not a calibrated confidence score.
5. The teacher compares the captured image with editable lines, fixes readings, and explicitly checks the review confirmation box. Confirmation preserves the original strokes.
6. Only a separate **Verify & run** action submits the confirmed source to Docker. Diagnostic boxes project through the image crop back onto approximate board regions. New ink or geometry changes invalidate the review.

Requests time out, have an independent body limit, and are limited to one in flight and six attempts per minute. Provider failures never trigger execution. `store: false` is requested; provider-side data handling still follows the applicable Gemini account terms.

## Verification and remaining evidence

Unit tests cover PNG validation, request/response shape, error redaction, line preservation, coordinate mapping, and independence from compilation. Browser tests use an explicitly labeled provider fixture to test actual pen capture, separate blue input, teacher correction/confirmation, stale ink, and real Docker execution. These fixtures do **not** demonstrate OCR accuracy.

A live request on 2026-10-17 returned HTTP 200 from Gemini 3.8 Flash in 8.7 seconds and transcribed the seven-line [synthetic handwriting-style sample](../tests/fixtures/ocr/README.md) faithfully, preserving its intentionally missing `&` and semicolon. The live check exposed an HTTP 400 caused by large array maxima in the provider schema; those limits are now enforced locally when validating the response. This single synthetic sample verifies integration, not classroom handwriting accuracy.

For a useful classroom benchmark, collect 30–50 genuine handwritten samples with exact transcriptions. Include `0/O`, `1/l/I`, `=/==`, `&/&&`, quotes, backslashes, braces, semicolons, indentation, blank lines, intentional bugs, and different pen sizes. Measure character error rate, critical-symbol errors, omitted/added lines, correction time, and latency. Keep intentionally incorrect code incorrect in the ground truth. Successful compilation alone is not evidence of faithful OCR.
