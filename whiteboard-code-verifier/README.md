# Boardroom — Whiteboard Code Verifier

An executable whiteboard for teachers explaining C. Handwrite or type code in an Excalidraw frame, supply input in blue, and run reviewed code through GCC. Compiler and sanitizer diagnostics link back to the board instead of interrupting the lesson with a separate IDE.

The application is self-contained in `whiteboard-code-verifier/`; hackathon submission materials are maintained separately.

Vercel can run Gemini OCR and hosted C compilation without your own Docker server using [Vercel Functions](docs/vercel-serverless.md). Configure server-side secrets and Wandbox access there. For local Docker execution and persistent Git lesson history, use the [Docker API deployment guide](docs/docker-api-deployment.md). Until either API is configured, the deployed page supports board editing and downloads.

See the [technical stack and project overview](docs/technical-overview.md) for the architecture, implementation details, API, execution limits, and current scope.

## First working slice

- Blank React + Excalidraw canvas; write freely, then use **Select code & input** in the top bar to drag a program region around existing writing. Black writing is source or an algorithm; enclosed blue writing is stdin.
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

Start on the blank canvas and use **Pen: code** (black) and **Pen: input** (blue). Click **Select code & input** in the top bar and drag around the code and its input. Click **Read & review handwriting**. Compare the image with every extracted line, correct ambiguous readings, check the confirmation box, then click **Use confirmed code**. A separate **Verify & run** executes exactly that reviewed text. New strokes invalidate confirmation.

The API sends only the selected frame's relevant ink crops to Gemini. Other annotation colors and frame borders are excluded. API keys stay on the backend. OCR line positions are approximate; ambiguity labels are model reports, not numeric confidence guarantees. See [OCR options and decision](docs/ocr-options.md) for the researched alternatives and accuracy-evaluation plan.

When recognition fails, expand **Gemini OCR diagnostics** in the Handwriting tab. The API terminal also prints `[ocr:gemini]` entries with the model, elapsed time, HTTP status, and quota classification. `token_limit_reached` means Gemini identified a token quota limit; `quota_or_rate_limit_reached` means HTTP 429 without enough evidence to identify a token limit; `credits_exhausted` means HTTP 402. A timeout reports `unknown`, not exhausted tokens. A token limit can be temporary, such as a per-minute limit. Check the linked [AI Studio usage page](https://aistudio.google.com/usage) for the project's actual limits and billing.

Successful requests log numeric input, output, thought, and total token counters when supplied by Gemini. These describe that request, not remaining account tokens. Logs exclude API keys, captured images, transcriptions, and raw provider error bodies. `npm run test:ocr -- tests/fixtures/ocr/synthetic-code.png` makes one opt-in live request with the same logging.

For a production build served locally:

```bash
npm run build
npm start
```

Open **http://127.0.0.1:8787**. `PORT` can change the production API port. Development uses port 8787 for its proxy. The server binds to loopback; an HTTPS reverse proxy and the exact origin/token configuration in the [deployment guide](docs/docker-api-deployment.md) connect a trusted hosted frontend.

### Docker on CachyOS / Arch Linux

```bash
sudo pacman -S --needed docker docker-buildx
sudo systemctl start docker.service
sudo setfacl -m "u:$(id -un):rw" /run/docker.sock
docker info
```

The socket ACL grants only your current user daemon access and lasts until the socket is recreated, such as on a Docker restart. Docker daemon access is root-equivalent. For persistent user access, follow the [ArchWiki Docker setup](https://wiki.archlinux.org/title/Docker). The application itself runs as your normal user. Starting the service does not enable it at boot.

## Gemini pseudocode slider

Choose a level with the **Pseudocode level** slider above the run button. Selecting a level makes no API call. Clicking the run button sends the selected source and literal stdin to the server; Gemini uses the existing `GEMINI_API_KEY` and `OCR_MODEL`. Handwriting first follows the existing OCR review and confirmation step at every level.

| Level | What happens when you run |
| --- | --- |
| 1 · Check code | **Verify & run** compiles the original C as written. Gemini then uses the source and compiler messages to explain errors and show suggested corrected C. Suggestions are displayed as advice. Without Gemini configuration, the original C can still run. |
| 2 · Fill the gaps | **Correct & run** asks Gemini to complete near-C, including omitted `main`, headers, declarations, and semicolons. The returned C is compiled with the selected input. |
| 3 · Demonstrate an algorithm | **Generate & run** asks Gemini to turn a written algorithm or plain-language steps into a small C demonstration, then compiles it. Assumptions and the exact generated C appear with the real compiler output. |

The board keeps the teacher's writing. For typed source, **Use this C on board** explicitly replaces it and switches to Level 1. Generated-code diagnostics refer to the displayed C rather than highlighting unrelated handwriting lines. Editing the board or changing level invalidates earlier results; editing during a Gemini request prevents pending generated C from compiling. Quota failures and timeouts are shown with safe Gemini diagnostics. Generated code can still contain errors; the compiler and execution service determine the actual result. Snapshot `board.c` remains the selected board source; generated C is visible in the run result and is not substituted into the lesson source automatically.

## Multiple input cases

Open **Cases** to add up to five named inputs for the selected board program. Each case can expect success, a compiler error, a runtime issue, a timeout, or an output limit; optionally compare stdout exactly. **Run cases** compiles/runs each input using the configured execution service and marks mismatches. At Levels 2–3, first generate/correct C with the main run button; Cases uses that displayed C. Changing the board or level marks earlier case results stale. Case definitions live in the current browser session and do not alter the blue input or become part of a lesson snapshot.

## Try a lesson

1. Run **Input & output**: blue text `3 5` produces `3 + 5 = 8`.
2. Open **Source & input**, remove a semicolon, and run again. Inspect the compiler message and its highlighted line. Restore the semicolon.
3. Load **A memory mistake**. Run to see the actual use-after-free diagnostic. Move `free(values)` below the last `printf`, then rerun.
4. Load **Under the abstraction**. The empty-stack contract points to `stack_pop`. Add `stack_push(&s, 42);` before the pop, then rerun.

Download or save a snapshot before switching lessons or refreshing to retain edits. Boards without a frame can be imported; select a program region before recognition or execution. Downloads preserve the ink, reviewed OCR provenance, and current run result. Importing does not trust saved confirmation or verification results: recognize/review handwriting again and rerun. Editing after a run marks the old result stale and removes its highlights.

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

Every click creates a new folder; existing snapshots are not overwritten. `board.excalidraw` retains the full canvas and selected-frame metadata. `board.c` contains the selected frame's exact typed or confirmed source, and `input.txt` preserves literal input, including blank lines. All snapshot files are recorded together with a `board: <lesson title>` Git commit. This archive is separate from the application repository and has no remote configured automatically.

The **History** tab lists the latest 30 snapshot commits. **Open saved board** restores the committed scene; save current work first because opening replaces the canvas. Saved execution results are not trusted on opening, and handwritten code requires fresh review before running or snapshotting again. The previously confirmed source remains available in the snapshot's `board.c`.

From the app root, inspect the archive with:

```bash
git -C snapshots log --oneline
git -C snapshots show --stat HEAD
```

Set `SNAPSHOT_DIR` to change the archive location, then restart the API; relative paths resolve from the application directory. The default `snapshots/` directory is ignored by the application repository. If a Git commit fails, the files remain saved and the UI reports the failure. Once Git is available, commit that folder manually from the archive directory with `git add -- <dated-folder>` and `git commit --only -m "board: Recovered lesson" -- <dated-folder>`.

### Synchronize lesson history

The local commit completes before any network push. To enable backup, create a **private, empty** Git repository for lessons, save one snapshot locally, then add it as the archive's `origin`:

```bash
git -C snapshots remote add origin https://github.com/<owner>/<private-lessons-repo>.git
```

The app pushes `HEAD` to the remote's `boardroom-lessons` branch. It never uses the application repository's remote and never force pushes. History shows whether commits are local only, queued, syncing, synced, or blocked by an error. A failed push leaves all local commits available; the API retries on startup, after new saves, and every minute while running. **Retry sync** starts another attempt immediately. No token is stored in snapshots or in the app; Git uses the host's existing authentication. If the remote has competing commits, the push is rejected until you resolve the histories in Git. Keep the remote private if lessons contain student or classroom information.

New snapshots also contain a portable replay bundle:

```text
lib/             # referenced curated headers plus their internal dependencies
lib.lock         # SHA-256 hashes of all bundle files and immutable compiler-image reference
runner.py        # frozen compiler flags, validation, diagnostics, and execution limits
Dockerfile       # pinned GCC image; unprivileged runner
.dockerignore    # restricts the image build context
build.sh         # integrity check followed by Docker-only replay
replay.py        # standard-library replay driver
ocr.json         # only when confirmed OCR is present
result.json      # only for a result matching the saved source/input and geometry
```

Replay a saved folder independently of the application checkout (requires Bash, Python 3.10+, and Linux Docker):

```bash
bash /path/to/snapshot/build.sh --verify
bash /path/to/snapshot/build.sh
```

Replay verifies the manifest before building or running, then prints a fresh JSON result. Submitted C executes only in a disposable container with the application's network, privilege, memory, process, and timeout limits. It never runs on the host or mounts the snapshot into the container. The first build needs access to the pinned compiler image; later builds can reuse its local cache. The image is pinned, but kernel/platform differences and sanitizer address randomization still affect results.

Headers are collected conservatively from literal includes, including inactive conditional branches, and trusted internal dependencies. Comments and line continuations are handled; saving incomplete C still works without GCC, Docker, or Gemini. Standard headers come from the pinned compiler image. Hashes detect accidental changes relative to `lib.lock`; they are not a signature authenticating files from another person. Inspect an unfamiliar bundle's scripts before executing them. Historical `result.json` is browser-reported evidence, never a fresh verification.

Opening a snapshot in **History** still restores the board for editing and runs against the application's current runner and headers. **Compare saved libraries** displays the committed headers beside the current versions and marks differences. Use the saved `build.sh` for frozen replay. Old three-file snapshots remain readable, but have no bundled headers to compare. Library semver management remains future work.

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

`POST /api/pseudocode` accepts `{ "source": "...", "stdin": "...", "level": 1 }` with optional `compilerOutput` and returns structured C, explanations, issues, and provider metadata. It only prepares source; the browser separately submits the original C at Level 1 or returned C at Levels 2–3 to `/api/run`. The local API shares a one-request concurrency cap and six-per-minute limit between OCR and assistance. The Gemini assistance deadline is 55 seconds.

`POST /api/ocr` accepts `{ "code": "data:image/png;base64,...", "stdin": "data:image/png;base64,..." }`; omit a channel when it contains no handwriting. It returns line text, normalized line boxes, ambiguity flags, alternatives, provider/model metadata, and `requiresConfirmation: true`. It never compiles or runs anything. Requests are limited to 4 MiB, PNG dimensions to 2048 × 2048, one recognition at a time, and six attempts per minute. The provider deadline is 60 seconds.

`POST /api/snapshots` accepts `{ "title": "Lesson name", "scene": { ... } }` and returns the dated folder ID and local Git commit. Source and stdin are derived from the scene, with current OCR confirmation required for handwritten channels. Snapshot bodies are limited to 4 MiB and scene data to 2 MB. `GET /api/snapshots` lists recent history; `GET /api/snapshots/<id>` reads a committed scene. Hosted access uses an exact frontend origin and a runtime API token; see the deployment guide.

`GET /api/snapshots/<id>/libraries` returns only allowlisted headers bundled in the committed lesson, alongside current application copies for comparison. It reads historical content from Git rather than mutable snapshot files.

## Verification

```bash
npm test                       # Node handler/mapping tests + trusted GCC fixtures
npm run test:docker            # lessons, EOF, timeout, output limit, and leak detection
npx playwright install chromium # once, for browser checks
npm run build                 # frontend production build
npm run test:browser           # desktop/mobile UI, import/export, real Docker runs
npm run test:ocr -- tests/fixtures/ocr/synthetic-code.png # opt-in live Gemini request
npm run benchmark:ocr -- /path/to/private/manifest.json # opt-in classroom handwriting benchmark
```

Tests require Python 3.10+ and host GCC with ASan/UBSan. Only fixed repository-owned C fixtures execute directly on the test host. Host tests disable leak tracing for those fixtures; a separate LSan test runs when tracing is supported and reports a skip otherwise. Production always enables leak detection. API tests exercise the actual request handler with Node streams and injected runner responses; Docker smoke tests verify the deployment boundary separately.

Browser tests serve the production build on loopback port 8878 and shut down their own server afterward. They exercise source/input editing, case runs, board download/import, a phone viewport, fullscreen, panel resizing, long-program frame growth, curated and historical header browsing, compiler diagnostics, stale results, and all six demo lessons. Handwriting tests explicitly stub the OCR provider to verify pen capture, review gating, and real compilation after confirmation. They do not measure recognition accuracy. The Docker-dependent checks fail if the runner is unavailable. Browser traces and screenshots are written to the ignored `test-results/` directory.

The Docker runner was verified locally with leak detection enabled, including EOF handling, an infinite-loop timeout, bounded output, actual leak reports, new library operations, and caller-line contracts. Verification passed 73 Node/Python tests and 38 browser tests; the unchanged Docker runner previously passed 14 dedicated checks. Snapshot tests use real temporary Git repositories and cover literal file contents, unique folders, confirmation gating, large stroke scenes, failed commits, and preservation of unrelated staged work. A live Gemini 3.8 Flash smoke check returned HTTP 200 and faithfully transcribed all seven lines of the [synthetic sample](tests/fixtures/ocr/README.md), including its intentional missing `&` and semicolon. A separate live browser check captured typed code plus a pen stroke, used Gemini without a provider stub, required teacher correction/confirmation, and ran the corrected program in Docker with stdout `3`. Live Gemini assistance also generated working C for a syntax correction, a snippet missing boilerplate, and a queue algorithm; all three compiled and ran in Docker. These synthetic checks and the fixture-based browser tests must not be interpreted as a human handwriting accuracy benchmark.

## Data, AI tools, and reused code

Gemini is the external vision model used to transcribe handwritten code and stdin. No training dataset is bundled or used for fine-tuning. A teacher reviews its output before execution. Teaching notes remain deterministic pattern matches, not AI-generated explanations. Gemini also checks C, completes near-C, or generates small algorithm demonstrations according to the selected slider level. Level 1 compiles the original source; Levels 2–3 compile the displayed Gemini C. Genuine handwriting accuracy still needs evaluation on classroom samples.

The opt-in benchmark accepts a private JSON array such as `[{"id":"sample-01","codeImage":"sample-01.png","codeText":"int main(void) {\n...\n}","correctionSeconds":45}]`. Image paths are relative to the manifest; `stdinImage` and `stdinText` can be supplied together. Prepare gold transcriptions before running the model, and record teacher correction time separately. The command reports character error rate, exact-line rate, critical-symbol error rate, ambiguity count, and provider duration without printing classroom text. It makes one Gemini request per sample, so keep the manifest outside the repository and budget for those requests. No genuine classroom samples are bundled here.

This implementation was generated with OpenAI Codex from `../whiteboard-code-verifier.md`. It reuses Excalidraw and React (MIT), Vite (MIT), the GCC container/toolchain, and Python. The curated stack header adapts the implementation in the project notes. Excalidraw integration follows its [official API documentation](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton).

## Limits and next steps

- Handwriting recognition requires a configured Gemini key and network access. Typed-only programs bypass OCR.
- The runner executes full C programs. Gemini can complete snippets or generate C from algorithms at Levels 2–3. Includes are restricted to the supported standard headers listed in `runner/runner.py` and the four curated teaching headers. Writing frames can grow, while the 32 KiB source and 8 KiB input execution limits still apply.
- Highlights cover source lines, not individual tokens. OCR boxes are approximate model estimates. Rotated typed text is extracted but cannot receive a line highlight. Use unrotated, unwrapped typed text for predictable mapping.
- Sanitizers alter allocation layout. Printed addresses are real, but the application does not claim to identify glibc heap/mmap regions.
- Lesson snapshots include the scene, C source, input, pinned library headers, compiler image, and a Docker replay script. Git synchronization requires a configured private archive remote.
- This is a local prototype, not a public arbitrary-code service. Public deployment needs a separate execution VM, authentication, deployment-level resource controls, and a security review.
- The Gemini OCR call is not routed through Caveman; gateway credentials/configuration have not been provided.

Keep changes focused; use two-space JavaScript/JSX indentation and four-space C/Python indentation. Run the focused test suite before contributing. Dependencies are pinned in `package.json` and `package-lock.json`; use `npm ci` for reproducible installation and update the lockfile when changing dependencies.
