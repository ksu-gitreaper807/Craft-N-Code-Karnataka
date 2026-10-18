# OCR image compression experiment

## Recommendation

**900-pixel PNG is the most promising smaller-image candidate, not a validated optimum.** Keep the current 1,800-pixel production cap until real handwriting comparisons are available. Do not automatically shrink dense or long programs to 600 pixels based on these short examples.

PNG already compresses the board losslessly. Reducing dimensions changes the pixels; lossy WebP also changes stroke detail. Smaller uploads do not necessarily mean fewer Gemini vision tokens or faster generation.

## Measured results — 2026-10-18

Same Gemini `gemini-3.8-flash` model, low thinking, literal-transcription prompt, and compact response schema for all calls. Browser canvas produced variants from the two checked-in synthetic fixtures. Dimensions refer to the longest side; the aspect ratio was preserved. Each cell represents **one request**, not an average or percentile.

| Format / longest side | C bytes | Python bytes | C time | Python time | C character edits | Python character edits |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| PNG / 1800 | 170,980 | 117,000 | 6.86 s | 5.43 s | 8 | 0 |
| PNG / 900 | 53,289 | 36,999 | 4.22 s | 4.80 s | 6 | 0 |
| PNG / 600 | 27,188 | 19,182 | 6.45 s | 5.33 s | 0 | 0 |
| WebP / 1200, quality 85% | 14,238 | 15,028 | 12.49 s | HTTP 503 | 1 | — |
| PNG / 1200 | 88,295 | — | HTTP 429 | not attempted | — | — |

900-pixel PNG reduced file bytes by 68–69% and pixel count by 75% against 1800. The 600-pixel images were smaller again, but not faster than 900. WebP saved more bytes but did not demonstrate a latency advantage. The PNG-1200 comparison was interrupted by quota exhaustion.

Gemini reported **1,080 image tokens for C and 1,064 for Python at every successful resolution/format**. Compression therefore did not reduce observed vision tokens. The errors were measured literally, including whitespace; zero critical-symbol errors were reported for successful synthetic calls. This is not proof of literal correctness: character edits and indentation still matter.

Raw, secret-free measurements: [JSON results](benchmarks/ocr-image-compression-2026-10-18.json).

## Real handwriting and limits

Two distinct saved handwritten lessons were captured locally from archive folders `2026-10-18/04-12-04-lesson-success-3131b4a0` and `2026-10-18/05-11-34-lesson-success-41e7be20`. Their current captures measured 1800×649 and 1800×1256. Visual inspection found the reduced images readable, but this does **not** establish Gemini accuracy. The first saved transcription contains `maloc` where the drawing appears to say `malloc`, so saved OCR must not be treated as unquestioned ground truth.

Live handwriting measurements were blocked by HTTP 429 with a 61,387-second retry interval. No further calls were made after that response. An earlier HTTP 503 paused the first batch; its retry interval was allowed to elapse before the next batch.

A reliable setting needs repeated, interleaved calls on manually checked handwriting, including thin pens, small punctuation, touching lines, dense programs, and Python indentation. Compare exact text, critical symbols, uncertainty, teacher correction time, median latency, and failures. The current two short synthetic examples cannot establish typical classroom performance or an accuracy threshold for downscaling.

## Reproduce

This opt-in script makes paid Gemini calls, uses the first configured key, and stops on authentication, quota, or temporary-service failures. It logs measurements without keys, images, or transcripts. It sends experimental WebP directly to Gemini; the application API still accepts only PNG.

```sh
node scripts/benchmark-ocr-images.mjs /path/to/ignored/.env \
  tests/fixtures/ocr/manifest.json /tmp/ocr-images.json
```

To run only selected profiles, append `png1800,png900` (also supported: `png1200,png600,webp1200`). Prepare a private manifest with `id`, `language`, `codeImage`, and manually checked `codeText`; `stdinImage`/`stdinText` are optional. Images must be PNG sources. Source fixtures may be enlarged to simulate the current 1800-pixel capture cap; this does not add handwriting detail. Provider timing excludes local image preparation and browser-to-application upload.

Google documents resolution/detail tradeoffs in its [image understanding guide](https://ai.google.dev/gemini-api/docs/image-understanding). Measured token counts above are specific to these requests; do not extrapolate older model tiling formulas to this model.
