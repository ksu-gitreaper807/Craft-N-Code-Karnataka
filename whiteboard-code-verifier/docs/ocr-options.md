# Handwritten code OCR: options and implementation

## Decision

Implement Gemini as the first provider, with a required teacher review step. This is a practical integration choice, not a claim that Gemini is the most accurate OCR system for handwritten C. No provider has yet been benchmarked on this project's real classroom handwriting.

Gemini accepts images and schema-constrained output. The current request asks for source/input line text and ambiguity flags only, with `thinking_level: "low"`. Earlier requests also asked for alternate readings and approximate line boxes; these are omitted to reduce work and output size. The backend uses its [documented Interactions REST API](https://ai.google.dev/gemini-api/docs/interactions) and [structured output format](https://ai.google.dev/gemini-api/docs/structured-output). `OCR_MODEL` is configurable; the default is `gemini-3.6-flash`, the supported replacement for the deprecated `gemini-3.5-flash` alias. Model availability and quotas depend on the user's project.

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
4. The response is checked against bounded text and line-count constraints. It includes one entry per recognized line and an ambiguity flag. The backend retains the existing review shape by filling omitted geometry with `box: null` and omitted alternatives with `[]`; it never fabricates locations. Older detailed responses remain readable. Model-reported ambiguity is not a calibrated confidence score.
5. The teacher compares the captured image with editable lines, fixes readings, and explicitly checks the review confirmation box. Confirmation preserves the original strokes.
6. Only a separate **Verify & run** action submits the confirmed source to Docker. Compiler diagnostics still refer to source lines in the editor. Compact text-only recognition does not provide canvas line boxes; older detailed records can retain their approximate mappings. New ink or geometry changes invalidate the review.

Requests time out, have an independent body limit, and are limited to one in flight and six attempts per minute. Provider failures never trigger execution. `store: false` is requested; provider-side data handling still follows the applicable Gemini account terms.

## Verification and remaining evidence

Unit tests cover PNG validation, request/response shape, error redaction, line preservation, coordinate mapping, and independence from compilation. Browser tests use an explicitly labeled provider fixture to test actual pen capture, separate blue input, teacher correction/confirmation, stale ink, and real Docker execution. These fixtures do **not** demonstrate OCR accuracy.

A live request on 2026-10-17 returned HTTP 200 from Gemini 3.8 Flash in 8.7 seconds and transcribed the seven-line [synthetic handwriting-style sample](../tests/fixtures/ocr/README.md) faithfully, preserving its intentionally missing `&` and semicolon. The live check exposed an HTTP 400 caused by large array maxima in the provider schema; those limits are now enforced locally when validating the response. This single synthetic sample verifies integration, not classroom handwriting accuracy.

For a useful classroom benchmark, collect 30–50 genuine handwritten samples with exact transcriptions. Include `0/O`, `1/l/I`, `=/==`, `&/&&`, quotes, backslashes, braces, semicolons, indentation, blank lines, intentional bugs, and different pen sizes. Measure character error rate, critical-symbol errors, omitted/added lines, correction time, and latency. Keep intentionally incorrect code incorrect in the ground truth. Successful compilation alone is not evidence of faithful OCR.

## Low-thinking, text-only update (2026-10-18)

Production logs before this update showed successful OCR round trips of 40.3 and 44.9 seconds, generating 5,351 and 6,318 reasoning tokens for 290 and 274 output tokens. These measurements establish substantial provider-side latency; they do not isolate reasoning time from network/provider queuing.

The update explicitly requests low thinking, shortens the transcription prompt, and removes line-box and alternate-reading generation. Raster cropping, 1,800-pixel sizing, the selected model, source/input bounds, the 50-second provider deadline, literal-error preservation, and mandatory teacher confirmation remain unchanged. Google documents low thinking as a latency reduction option: https://ai.google.dev/gemini-api/docs/thinking#controlling-thinking. No fixed speedup is guaranteed.

The initial paired live comparison was blocked: the C baseline timed out at 50 seconds; the local low-thinking requests then received HTTP 429, including a long Retry-After interval. A production availability probe also returned provider HTTP 503 with a 30-second retry. Paired production calls on the same C fixture then both reached the provider deadline: the baseline took 51.9 seconds end-to-end and the low-thinking/text-only candidate took 50.7 seconds, with both returning structured timeouts after 50 seconds of provider waiting. Neither returned a transcription. These are censored failures, not evidence of a speedup or an accuracy result. A working, quota-available project is needed to complete the comparison.

A replacement-key comparison on 2026-10-18 completed the old detailed/default-thinking C baseline in 14,478 ms with zero character or critical-symbol errors on the synthetic fixture (613 reasoning tokens, 411 output tokens). The immediately following low-thinking/text-only request received HTTP 429 with Retry-After 68,367 seconds. Further calls were stopped. This establishes that the replacement key could initially serve a request, but still provides no paired candidate latency or accuracy result. A different key alone does not establish separate project quota.

A subsequent updated-key run on 2026-10-18 completed the optimized request in 6,287 ms for the synthetic C fixture and 4,638 ms for Python, both with zero character or critical-symbol errors, preserving deliberate syntax errors. The same-key C baseline returned HTTP 503. The Python baseline completed in 45,701 ms with one character edit reported by the scorer, versus zero for the optimized request; it generated 5,705 reasoning tokens versus 187 for the optimized request. The optimized Python call was approximately 9.9 times faster in this single comparison. These synthetic, single-run results do not establish human handwriting accuracy or typical production latency.

Run `npm run benchmark:ocr -- tests/fixtures/ocr/manifest.json` with an available local key to measure the current implementation on both checked-in synthetic samples. The benchmark now forwards the sample language and reports safe numeric token usage as well as latency and transcription error metrics. Both samples deliberately contain syntax errors that OCR must preserve. Human handwriting, touching lines, and teacher correction time still need classroom evaluation.
