# Boardroom — Whiteboard Code Verifier

An executable whiteboard for teachers explaining C. Handwrite or type code in an Excalidraw frame, supply input in blue, and run reviewed code through GCC. Compiler and sanitizer diagnostics link back to the board instead of interrupting the lesson with a separate IDE.

The application is self-contained in `whiteboard-code-verifier/`; hackathon submission materials are maintained separately.

See the [technical stack and project overview](docs/technical-overview.md) for the architecture, implementation details, API, execution limits, and current scope.

## First working slice

- React + Excalidraw canvas; one frame represents one C program.
- A viewport-filling workspace, browser fullscreen, a hideable/resizable side panel, and expandable writing frames.
- Gemini handwriting recognition with separate code/input images, editable transcription, alternate readings, and mandatory teacher confirmation.
- Raw text extraction with preserved blank lines and a source-line-to-element map.
- Blue (`#1971c2`) text supplies stdin; other annotation colors are ignored.
- Source/input editors, real stdout/stderr, compiler diagnostics, ASan/UBSan reports, and canvas highlights.
- Six editable demo lessons: input/output, use-after-free, a stack contract failure, linked lists, queues, and binary search.
- A memory diagram using actual stack-pointer and buffer addresses printed by the memory lesson.
- Trusted header-only `stack.h`, `linked_list.h`, `queue.h`, and `search.h`, visible in the UI, with teacher callsite attribution.
- Rule-based teaching notes and downloadable/importable Excalidraw scenes. Downloads include the current result when it still matches the board.
- Dated lesson snapshots containing the scene, selected program's C source, and stdin, with local Git commits and a History tab.

## Layout and tools (anand-changes branch)

- A left tool rail (pens, **Region**, **Whole page**, **Snippet mode**), the board in the middle, and a resizable dock underneath. The dock holds an editable **Code that runs** view, standard input, and Output / Handwriting / Libraries / History tabs.
- **Region** lets the teacher drag a box on the board. The box becomes a new frame ("Region n") holding the ink inside it, so arrows, flowcharts and side notes outside it never reach OCR or the compiler. **Whole page** frames all ink at once.
- **Snippet mode** wraps the board text in a saved template (headers, globals, helper functions, `main()`), built by clicking or dragging blocks. The full program is always shown in the editor before it runs. Text that already contains `main(` runs as written. The template is stored in the browser (`localStorage`).
- Compiler errors are underlined in the **Code that runs** editor, which is the exact text that was compiled and can be edited. The board itself is never marked. Edits in the editor do not change the board text.

## Run locally

Prerequisites: Node.js 22.12+, Git for lesson history, and Linux Docker Engine with a working daemon. GCC runs **inside Docker**; the application never falls back to executing submitted programs on the host.

```bash
cd whiteboard-code-verifier
npm ci
npm run runner:build
npm run dev
```

Open **http://127.0.0.1:5173**. Vite proxies `/api` to the loopback API on port 8787. The launcher copies Excalidraw fonts locally, so the canvas does not need its font CDN during a lesson. The optional interface web fonts fall back to system fonts when offline.

### Writing space and libraries

The workspace fills the browser window. Use **Fullscreen** to hide browser chrome and **Hide panel** to dedicate the workspace to the board. Drag the divider beside the code/results panel to change its width; keyboard users can focus the divider and use arrow keys, Home, or End. On phones the panel sits below the board and scrolls independently.

Set the writing frame's **Width** and **Height**, then click **Apply size**, or use **+ More room** to extend it downward. Existing writing is retained when shrinking. **Fit frame** brings the whole frame into view; use canvas zoom and pan to navigate larger programs. Editing typed code in **Source & input** automatically grows its frame and moves typed stdin below the program. The source textarea also has a vertical resize handle.

Open **Libraries** to browse the compiled headers, see their public methods, and load an example. See the [C library reference](docs/c-libraries.md) for ownership rules, complexity, contracts, and complete examples. These are project-provided teaching headers storing integers, not ISO C standard-library additions. After changing runner headers, rebuild with `npm run runner:build`.

### Configure handwriting recognition

Copy `.env.example` to `.env` and set `GEMINI_API_KEY` using a key from your Google AI Studio project. Restart the API after changing it. Keep `.env` private; it is ignored by Git. `OCR_MODEL` selects the Gemini model available to your project. Typed code continues to work without a key.

Click **New handwritten board**, then use **Pen: code** (black) and **Pen: input** (blue). Click **Read & review handwriting**. Compare the image with every extracted line, correct ambiguous readings, check the confirmation box, then click **Use confirmed code**. A separate **Verify & run** executes exactly that reviewed text. New strokes invalidate confirmation.

The API sends only the selected frame's relevant ink crops to Gemini. Other annotation colors and frame borders are excluded. API keys stay on the backend. OCR line positions are approximate; ambiguity labels are model reports, not numeric confidence guarantees. See [OCR options and decision](docs/ocr-options.md) for the researched alternatives and accuracy-evaluation plan.

When recognition fails, expand **Gemini OCR diagnostics** in the Handwriting tab. The API terminal also prints `[ocr:gemini]` entries with the model, elapsed time, HTTP status, and quota classification. `token_limit_reached` means Gemini identified a token quota limit; `quota_or_rate_limit_reached` means HTTP 429 without enough evidence to identify a token limit; `credits_exhausted` means HTTP 402. A timeout reports `unknown`, not exhausted tokens. A token limit can be temporary, such as a per-minute limit. Check the linked [AI Studio usage page](https://aistudio.google.com/usage) for the project's actual limits and billing.

Successful requests log numeric input, output, thought, and total token counters when supplied by Gemini. These describe that request, not remaining account tokens. Logs exclude API keys, captured images, transcriptions, and raw provider error bodies. `npm run test:ocr -- tests/fixtures/ocr/synthetic-code.png` makes one opt-in live request with the same logging.

For a production build served locally:

```bash
npm run build
npm start
```

Open **http://127.0.0.1:8787**. `PORT` can change the production API port. Development uses port 8787 for its proxy. The server binds to loopback and rejects foreign hosts/origins; public hosting is not configured.

### Docker on CachyOS / Arch Linux

```bash
sudo pacman -S --needed docker docker-buildx
sudo systemctl start docker.service
sudo setfacl -m "u:$(id -un):rw" /run/docker.sock
docker info
```

The socket ACL grants only your current user daemon access and lasts until the socket is recreated, such as on a Docker restart. Docker daemon access is root-equivalent. For persistent user access, follow the [ArchWiki Docker setup](https://wiki.archlinux.org/title/Docker). The application itself runs as your normal user. Starting the service does not enable it at boot.

## Try a lesson

1. Run **Input & output**: blue text `3 5` produces `3 + 5 = 8`.
2. Open **Source & input**, remove a semicolon, and run again. Inspect the compiler message and its highlighted line. Restore the semicolon.
3. Load **A memory mistake**. Run to see the actual use-after-free diagnostic. Move `free(values)` below the last `printf`, then rerun.
4. Load **Under the abstraction**. The empty-stack contract points to `stack_pop`. Add `stack_push(&s, 42);` before the pop, then rerun.

Download or save a snapshot before switching lessons or refreshing to retain edits. Imported boards need at least one frame. Downloads preserve the ink, reviewed OCR provenance, and current run result. Importing does not trust saved confirmation or verification results: recognize/review handwriting again and rerun. Editing after a run marks the old result stale and removes its highlights.

## Lesson snapshots and Git history

Click **Snapshot** in the top bar to save the current board and the selected frame's source/input on the API server. Handwriting must be reviewed and confirmed first. Typed lessons can be saved before running, including incomplete or intentionally incorrect C. Saving never compiles the program or calls Gemini.

```text
snapshots/                         # separate local Git repository, created on first save
  2026-10-17/                      # UTC date
    12-30-05-input-output-a1b2c3d4/ # UTC time, lesson title, unique suffix
      board.excalidraw
      board.c
      input.txt
```

Every click creates a new folder; existing snapshots are not overwritten. `board.excalidraw` retains the full canvas and selected-frame metadata. `board.c` contains the selected frame's exact typed or confirmed source, and `input.txt` preserves literal input, including blank lines. The three files are recorded together with a `board: <lesson title>` Git commit. This archive is separate from the application repository and has no remote configured automatically.

The **History** tab lists the latest 30 snapshot commits. **Open saved board** restores the committed scene; save current work first because opening replaces the canvas. Saved execution results are not trusted on opening, and handwritten code requires fresh review before running or snapshotting again. The previously confirmed source remains available in the snapshot's `board.c`.

From the app root, inspect the archive with:

```bash
git -C snapshots log --oneline
git -C snapshots show --stat HEAD
```

Set `SNAPSHOT_DIR` to change the archive location, then restart the API; relative paths resolve from the application directory. The default `snapshots/` directory is ignored by the application repository. Lesson history stays local; pushing it requires configuring a remote separately. If a Git commit fails, the files remain saved and the UI reports the failure. Once Git is available, commit that folder manually from the archive directory with `git add -- <dated-folder>` and `git commit --only -m "board: Recovered lesson" -- <dated-folder>`.

This basic format uses the current runner and library headers when rerun. It does not vendor libraries, pin toolchains, or include a build script.

## Architecture

```text
src/main.jsx → src/board.js → POST /api/run
                              server/index.mjs
                                → server/sandbox.mjs
                                  → disposable Docker container
                                    → runner/runner.py → GCC → program
                                ← diagnostics, output, teaching notes
src/canvas.js ← source line map ← result

handwritten strokes → src/capture.js → POST /api/ocr → server/ocr.mjs → Gemini
  → editable review → teacher confirmation → the same POST /api/run path
```

The Node API uses only built-in modules. Python's standard library owns compilation, deadlines, output capture, and diagnostic parsing inside the runner. Docker applies no network, read-only root, an unprivileged user, no capabilities, a 64-process limit, 512 MiB memory, one CPU, and a 64 MiB temporary filesystem. Compilation has a 10-second deadline; execution has a 5-second wall deadline and 3-second CPU soft limit. Output is bounded. No host directories or credentials are mounted into runs.

`GET /api/health` reports runner readiness; `GET /api/library/<name>` serves an allowlisted public teaching header (`stack.h`, `linked_list.h`, `queue.h`, or `search.h`). `POST /api/run` accepts `{ "source": "...", "stdin": "..." }` and returns status, stdout, stderr, compiler output, exit code, duration, diagnostics, and notes. Source is limited to 32 KiB and input to 8 KiB. The local API caps concurrency at two and accepts at most 20 run attempts per minute.

`POST /api/ocr` accepts `{ "code": "data:image/png;base64,...", "stdin": "data:image/png;base64,..." }`; omit a channel when it contains no handwriting. It returns line text, normalized line boxes, ambiguity flags, alternatives, provider/model metadata, and `requiresConfirmation: true`. It never compiles or runs anything. Requests are limited to 4 MiB, PNG dimensions to 2048 × 2048, one recognition at a time, and six attempts per minute. The provider deadline is 60 seconds.

`POST /api/snapshots` accepts `{ "title": "Lesson name", "scene": { ... } }` and returns the dated folder ID and local Git commit. Source and stdin are derived from the scene, with current OCR confirmation required for handwritten channels. Snapshot bodies are limited to 4 MiB and scene data to 2 MB. `GET /api/snapshots` lists recent history; `GET /api/snapshots/<id>` reads a committed scene. These endpoints use the same loopback host/origin restrictions as execution.

## Verification

```bash
npm test                       # Node handler/mapping tests + trusted GCC fixtures
npm run test:docker            # lessons, EOF, timeout, output limit, and leak detection
npx playwright install chromium # once, for browser checks
npm run build                 # frontend production build
npm run test:browser           # desktop/mobile UI, import/export, real Docker runs
npm run test:ocr -- tests/fixtures/ocr/synthetic-code.png # opt-in live Gemini request
```

Tests require Python 3.10+ and host GCC with ASan/UBSan. Only fixed repository-owned C fixtures execute directly on the test host. Host tests disable leak tracing for those fixtures; a separate LSan test runs when tracing is supported and reports a skip otherwise. Production always enables leak detection. API tests exercise the actual request handler with Node streams and injected runner responses; Docker smoke tests verify the deployment boundary separately.

Browser tests serve the production build on loopback port 8878 and shut down their own server afterward. They exercise source/input editing, board download/import, a phone viewport, fullscreen, panel resizing, long-program frame growth, curated-header browsing, compiler diagnostics, stale results, and all six demo lessons. Handwriting tests explicitly stub the OCR provider to verify pen capture, review gating, and real compilation after confirmation. They do not measure recognition accuracy. The Docker-dependent checks fail if the runner is unavailable. Browser traces and screenshots are written to the ignored `test-results/` directory.

The Docker runner was verified locally with leak detection enabled, including EOF handling, an infinite-loop timeout, bounded output, actual leak reports, new library operations, and caller-line contracts. Verification passed 51 Node/Python tests and 23 browser tests; the unchanged Docker runner previously passed 14 dedicated checks. Snapshot tests use real temporary Git repositories and cover literal file contents, unique folders, confirmation gating, large stroke scenes, failed commits, and preservation of unrelated staged work. A live Gemini 3.8 Flash smoke check returned HTTP 200 and faithfully transcribed all seven lines of the [synthetic sample](tests/fixtures/ocr/README.md), including its intentional missing `&` and semicolon. A separate live browser check captured typed code plus a pen stroke, used Gemini without a provider stub, required teacher correction/confirmation, and ran the corrected program in Docker with stdout `3`. These synthetic checks and the fixture-based browser tests must not be interpreted as a human handwriting accuracy benchmark.

## Data, AI tools, and reused code

Gemini is the external vision model used to transcribe handwritten code and stdin. No training dataset is bundled or used for fine-tuning. A teacher reviews its output before execution. Teaching notes remain deterministic pattern matches, not AI-generated explanations. There is no automatic code repair. Genuine handwriting accuracy still needs evaluation on classroom samples.

This implementation was generated with OpenAI Codex from `../whiteboard-code-verifier.md`. It reuses Excalidraw and React (MIT), Vite (MIT), the GCC container/toolchain, and Python. The curated stack header adapts the implementation in the project notes. Excalidraw integration follows its [official API documentation](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton).

## Limits and next steps

- Handwriting recognition requires a configured Gemini key and network access. Typed-only programs bypass OCR.
- Full C programs only; no snippet wrapping. Includes are restricted to the supported standard headers listed in `runner/runner.py` and the four curated teaching headers. Writing frames can grow, while the 32 KiB source and 8 KiB input execution limits still apply.
- Highlights cover source lines, not individual tokens. OCR boxes are approximate model estimates. Rotated typed text is extracted but cannot receive a line highlight. Use unrotated, unwrapped typed text for predictable mapping.
- Sanitizers alter allocation layout. Printed addresses are real, but the application does not claim to identify glibc heap/mmap regions.
- Lesson snapshots record the scene, C source, and input in local Git history. Libraries and compiler settings are not pinned or vendored per lesson yet.
- This is a local prototype, not a public arbitrary-code service. Public deployment needs a separate execution VM, authentication, deployment-level resource controls, and a security review.
- The Gemini OCR call is not routed through Caveman; gateway credentials/configuration have not been provided.

Keep changes focused; use two-space JavaScript/JSX indentation and four-space C/Python indentation. Run the focused test suite before contributing. Dependencies are pinned in `package.json` and `package-lock.json`; use `npm ci` for reproducible installation and update the lockfile when changing dependencies.
