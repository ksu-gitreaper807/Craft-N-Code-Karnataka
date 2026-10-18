# Boardroom — Whiteboard Code Verifier

An executable whiteboard for teachers explaining C++ and Python. Handwrite or type code in an Excalidraw frame, supply input in blue, and run reviewed code through g++ or Python 3. Compiler and sanitizer diagnostics link back to the board instead of interrupting the lesson with a separate IDE.

The application is self-contained in `whiteboard-code-verifier/`; hackathon submission materials are maintained separately.

Vercel can run Gemini OCR, hosted C/Python execution, and GitHub-backed lesson snapshots without your own Docker server using [Vercel Functions](docs/vercel-serverless.md). Configure server-side secrets, Wandbox access, and an archive repository there. For local Docker execution and a disk-backed Git archive, use the [Docker API deployment guide](docs/docker-api-deployment.md). Until either API is configured, the deployed page supports board editing and downloads.

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
- Dated lesson snapshots containing the scene, selected program's C or Python source, and stdin, with local or GitHub-backed Git commits and a History tab.

## Layout and tools

- **Board first.** The whiteboard fills the window. Excalidraw's own menus, tool bar and style panel are always hidden. Clicking the **Code** or **Input** pen opens the Boardroom drawing bar along the top of the board: **Pen**, **Eraser**, **Hand**, **Select**, **Lock tool**, **Text**, **Shapes** (rectangle, diamond, ellipse, arrow, line), **Laser** and **Image**, five stroke thicknesses and six ink colours. **Done** or Escape hides it again.
- **Tool strip under the board** (docked, nothing floats over the writing): pens, zoom, **Region** (drag a box around the code and its blue input), **Whole page** (frame everything written), the C/Python toggle, the program-frame picker, the **Code mode** slider, a **Code** button for the side panel, and **Verify & run**. A moon/sun button in the top bar switches dark mode, remembered in the browser.
- **Side panel** (closed until you press Run or Code): the editable **Code that runs** view, standard input, a collapsible **Frame size** control, and the Output, Handwriting, Cases, Libraries and History tabs. Opening it re-fits the selected frame so the board is not cut off.
- **Code mode slider:** **Full program** compiles exactly what was written. **Snippet** (C++) uses a template of headers, globals and helpers only (no `main()`), chosen with **Template** from standard headers and the project's stack, queue, linked-list and search headers. On every run Gemini organizes the snippet into helpers and, if appropriate, `int main()`; it never fixes errors, and the app refuses to compile if Gemini changed anything else. **Algorithm** asks Gemini to write a program from plain-language steps, then runs it.
- **Ask Gemini to fix:** after any failed run, in any mode, this button sends the failed code and its errors to Gemini and runs the corrected version. Nothing is sent unless the teacher clicks it, so intentional error demonstrations make no API calls. The board and the editor are unchanged; **Use this fix in the editor** copies the fix across.
- Compiler errors are underlined in **Code that runs**, which is the exact text that was compiled and can be edited. The board itself is never marked. Edits in the editor do not change the board text; an "Edited by hand · reset" badge returns to the board's version.

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

Copy `.env.example` to `.env` and set `GEMINI_API_KEY` using a key from your Google AI Studio project. Restart the API after changing it. Keep `.env` private; it is ignored by Git. `OCR_MODEL` selects the Gemini model available to your project (default: `gemini-3.6-flash` for both OCR and code assistance). Google routes the deprecated `gemini-3.5-flash` alias to 3.6 Flash. Typed code continues to work without a key.

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

## Language toggle

Choose **C** or **Python** with the **LANGUAGE** toggle in the right results panel. Changing the language keeps your writing and marks old output stale; handwriting must be reviewed again. The selected language controls OCR context, all three Gemini assistance levels, execution, input cases, downloads, and snapshots. Existing boards without language metadata open as C. Loading a bundled C lesson switches the toggle to C.

Python supports literal stdin, indentation and blank lines, standard-library imports, syntax checks and traceback line highlights. Locally it runs under isolated Python 3 inside the same Docker limits as C; rebuild the runner with `npm run runner:build` after updating. Python has no C sanitizer or curated-header checks. Use its standard library, such as `collections.deque`, `heapq`, `bisect`, and `math`; third-party packages are not installed. The **Libraries** tab describes the C teaching headers.

On Vercel, Python uses the configured Wandbox service, defaulting to `cpython-3.13.8`; `WANDBOX_PYTHON_COMPILER` can override that name. The local Bookworm image currently supplies Python 3.11.2. Use syntax available in your selected execution environment.

## Code modes and Gemini

Choose a mode with the **Code mode** slider in the tool strip. Changing mode makes no API call. Handwriting first follows the existing OCR review and confirmation step in every mode.

| Mode | What happens when you run | Gemini |
| --- | --- | --- |
| Full program | **Verify & run** compiles or runs the code exactly as written. | Never |
| Snippet | **Verify & run** first asks Gemini to organize the C++ snippet (helpers at namespace scope, loose statements in `int main()` only when appropriate), checks that nothing but an entry point was added, places it under the chosen template (headers and declarations only, never `main()`), then compiles. Python runs as written. | Every C++ run |
| Algorithm | **Generate & run** asks Gemini to turn written steps into a small C or Python program, then runs it. | Every run |

After a failed run in any mode, **Ask Gemini to fix** sends the code that ran and its compiler or runtime messages to Gemini (`/api/pseudocode` with `level: 1`), shows the corrected program and explanation, and runs it. Without `GEMINI_API_KEY` the button is disabled.

The board keeps the teacher's writing. For typed source, **Use this C on board** explicitly replaces it and switches to Full program mode. Generated-code diagnostics refer to the displayed C rather than highlighting unrelated handwriting lines. Editing the board or changing level invalidates earlier results; editing during a Gemini request prevents pending generated C from compiling. Quota failures and timeouts are shown with safe Gemini diagnostics. Generated code can still contain errors; the compiler and execution service determine the actual result. Manual snapshot source files retain the selected board source. Automatic execution snapshots save the exact code that ran, including Gemini-generated code, while retaining the original drawing separately.

## Multiple input cases

Open **Cases** to add up to 20 named cases. Expect success, compiler/runtime errors, timeouts, or output limits. Stdout comparison defaults to exact characters (including newlines); choose trimming or whitespace normalization explicitly. Results show expected/actual output, the first difference, duration, stderr, and compiler diagnostics, with progress as each case finishes. **Stop cases** prevents remaining submissions and cancels the browser wait; a submitted server job may still finish. Suites persist in browser storage separately for C++ and Python. **Import suite** validates a versioned JSON file before replacing definitions; **Export suite** downloads a portable copy. Each completed response still creates its full-board snapshot; suite definitions themselves are not bundled.

## Try a lesson

1. Run **Input & output**: blue text `3 5` produces `3 + 5 = 8`.
2. Open **Source & input**, remove a semicolon, and run again. Inspect the compiler message and its highlighted line. Restore the semicolon.
3. Load **A memory mistake**. Run to see the actual use-after-free diagnostic. Move `free(values)` below the last `printf`, then rerun.
4. Load **Under the abstraction**. The empty-stack contract points to `stack_pop`. Add `stack_push(&s, 42);` before the pop, then rerun.

Download or save a snapshot before switching lessons or refreshing to retain edits. Boards without a frame can be imported; select a program region before recognition or execution. Downloads preserve the ink, reviewed OCR provenance, and current run result. Importing does not trust saved confirmation or verification results: recognize/review handwriting again and rerun. Editing after a run marks the old result stale and removes its highlights.

## Lesson snapshots and Git history

Every completed compile/run now automatically saves the **entire drawing board**, including other frames, off-screen annotations, handwriting, and embedded board assets. This also happens for compile errors, runtime errors, and each input case. The canvas is captured immediately before that execution, so later edits do not change the archived drawing. The code and input replay files contain the exact submitted source/input, including editor edits, snippet templates, and Gemini-generated Level 2/3 code. The original drawing remains intact in `board.excalidraw`; browser-reported execution metadata and `result.json` record the attempt. Opening History restores the drawing, while the portable bundle replays the executed program.

On Vercel, each automatic snapshot commits directly to the configured `boardroom-lessons` GitHub branch. The panel shows saving/saved status or a separate archive failure; saving does not replace the compiler output or switch away from it. Local servers commit to their existing archive and use its remote-sync configuration. A transport failure without a completed runner response does not claim a completed execution.

On Vercel, configure `SNAPSHOT_GITHUB_REPOSITORY`, `SNAPSHOT_GITHUB_TOKEN` (Contents: read/write), and optionally `SNAPSHOT_GITHUB_BRANCH` (default `boardroom-lessons`); see [hosted snapshot setup](docs/vercel-serverless.md#github-lesson-snapshots). Hosted saves commit the complete dated folder directly to that GitHub branch and remain available after redeploys. Public repositories expose saved lesson contents. Lesson commits on `boardroom-lessons` do not trigger Vercel deployments. The filesystem and Git-remote commands below apply to the local/persistent Node server.

Click **Snapshot** in the top bar to save the current board and the selected frame's source/input on the API server. Handwriting must be reviewed and confirmed first. Typed lessons can be saved before running, including incomplete or intentionally incorrect C. Saving never compiles the program or calls Gemini.

```text
snapshots/                         # separate local Git repository, created on first save
  2026-10-17/                      # UTC date
    12-30-05-input-output-a1b2c3d4/ # UTC time, lesson title, unique suffix
      board.excalidraw
      board.cpp
      input.txt
```

Every click creates a new folder; existing snapshots are not overwritten. `board.excalidraw` retains the full canvas and selected-frame metadata. `board.cpp` contains the selected frame's exact typed or confirmed source, and `input.txt` preserves literal input, including blank lines. All snapshot files are recorded together with a `board: <lesson title>` Git commit. This archive is separate from the application repository and has no remote configured automatically.

The **History** tab lists the latest 30 snapshot commits. **Open saved board** restores the committed scene; save current work first because opening replaces the canvas. Saved execution results are not trusted on opening, and handwritten code requires fresh review before running or snapshotting again. The previously confirmed source remains available in the snapshot's `board.cpp` or `board.py`.

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

`GET /api/health` reports C runner readiness; `GET /api/health?language=python` checks the Python runtime; `GET /api/library/<name>` serves an allowlisted public teaching header (`stack.h`, `linked_list.h`, `queue.h`, or `search.h`). `POST /api/run` accepts `{ "source": "...", "stdin": "...", "language": "python" }` (omit `language` for C) and returns status, stdout, stderr, compiler output, exit code, duration, diagnostics, and notes. Source is limited to 32 KiB and input to 8 KiB. The local API caps concurrency at two and accepts at most 20 run attempts per minute.

`POST /api/pseudocode` accepts `{ "source": "...", "stdin": "...", "level": 1 }` with optional `compilerOutput` and `language: "python"`, and returns structured source, explanations, issues, and provider metadata. It only prepares source; the browser separately submits the original C at Level 1 or returned C at Levels 2–3 to `/api/run`. The local API shares a one-request concurrency cap and six-per-minute limit between OCR and assistance. The Gemini assistance deadline is 55 seconds.

`POST /api/ocr` accepts `{ "code": "data:image/png;base64,...", "stdin": "data:image/png;base64,..." }`; omit a channel when it contains no handwriting. It requests only literal line text and ambiguity flags, using Gemini low thinking to reduce reasoning and output overhead. The review API returns `box: null` and `alternatives: []` for these text-only lines, plus provider/model metadata and `requiresConfirmation: true`. Handwritten diagnostics remain available in the code editor; text-only OCR does not map them onto precise canvas locations. Set `language: "python"` for Python indentation and syntax context. It never compiles or runs anything. Requests are limited to 4 MiB, PNG dimensions to 2048 × 2048, one recognition at a time, and six attempts per minute. The provider deadline is 50 seconds, leaving time for a JSON error response before Vercel’s 60-second function limit.

`POST /api/snapshots` accepts `{ "title": "Lesson name", "scene": { ... } }` and returns the dated folder ID and Git commit. Source and stdin are derived from the scene, with current OCR confirmation required for handwritten channels. Snapshot bodies are limited to 4 MiB and scene data to 2 MB. `GET /api/snapshots` lists recent history; `GET /api/snapshots/<id>` reads a committed scene. Hosted access is public, with browser origin checks; see the deployment guide.

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

Tests require Python 3.10+ and host GCC with ASan/UBSan. Only fixed repository-owned C/Python fixtures execute directly on the test host. Host tests disable leak tracing for those fixtures; a separate LSan test runs when tracing is supported and reports a skip otherwise. Production always enables leak detection. API tests exercise the actual request handler with Node streams and injected runner responses; Docker smoke tests verify the deployment boundary separately.

Browser tests serve the production build on loopback port 8878 and shut down their own server afterward. They exercise source/input editing, case runs, board download/import, a phone viewport, fullscreen, panel resizing, long-program frame growth, curated and historical header browsing, compiler diagnostics, stale results, and all six demo lessons. Handwriting tests explicitly stub the OCR provider to verify pen capture, review gating, and real compilation after confirmation. They do not measure recognition accuracy. The Docker-dependent checks fail if the runner is unavailable. Browser traces and screenshots are written to the ignored `test-results/` directory.

The Docker runner was verified locally with leak detection enabled, including EOF handling, an infinite-loop timeout, bounded output, actual leak reports, new library operations, and caller-line contracts. Verification passed 84 Node/Python tests and 43 browser tests; the Docker runner also passes its dedicated execution checks. Snapshot tests use real temporary Git repositories and cover literal file contents, unique folders, confirmation gating, large stroke scenes, failed commits, and preservation of unrelated staged work. A live Gemini 3.8 Flash smoke check returned HTTP 200 and faithfully transcribed all seven lines of the [synthetic sample](tests/fixtures/ocr/README.md), including its intentional missing `&` and semicolon. A separate live browser check captured typed code plus a pen stroke, used Gemini without a provider stub, required teacher correction/confirmation, and ran the corrected program in Docker with stdout `3`. A live Python algorithm check generated a deque example that printed `4` and `7` in both Docker and Wandbox, and a saved Python snapshot replayed in Docker with stdout `8`. Live Gemini assistance also generated working C for a syntax correction, a snippet missing boilerplate, and a queue algorithm; all three compiled and ran in Docker. These synthetic checks and the fixture-based browser tests must not be interpreted as a human handwriting accuracy benchmark.

## Data, AI tools, and reused code

Gemini is the external vision model used to transcribe handwritten code and stdin. No training dataset is bundled or used for fine-tuning. A teacher reviews its output before execution. Teaching notes remain deterministic pattern matches, not AI-generated explanations. Gemini checks the selected C or Python source, completes partial code, or generates a small algorithm demonstration. Level 1 runs the original source; Levels 2–3 run the displayed Gemini source. Genuine handwriting accuracy still needs evaluation on classroom samples.

The opt-in benchmark accepts a private JSON array such as `[{"id":"sample-01","codeImage":"sample-01.png","codeText":"int main(void) {\n...\n}","correctionSeconds":45}]`. Image paths are relative to the manifest; `stdinImage` and `stdinText` can be supplied together. Prepare gold transcriptions before running the model, and record teacher correction time separately. The command reports character error rate, exact-line rate, critical-symbol error rate, ambiguity count, and provider duration without printing classroom text. It makes one Gemini request per sample, so keep the manifest outside the repository and budget for those requests. No genuine classroom samples are bundled here.

This implementation was generated with OpenAI Codex from `../whiteboard-code-verifier.md`. It reuses Excalidraw and React (MIT), Vite (MIT), the GCC container/toolchain, and Python. The curated stack header adapts the implementation in the project notes. Excalidraw integration follows its [official API documentation](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton).

## Limits and next steps

- Handwriting recognition requires a configured Gemini key and network access. Typed-only programs bypass OCR.
- The runner executes full C or Python programs. Gemini can complete snippets or generate C from algorithms at Levels 2–3. Includes are restricted to the supported standard headers listed in `runner/runner.py` and the four curated teaching headers. Writing frames can grow, while the 32 KiB source and 8 KiB input execution limits still apply.
- Highlights cover source lines, not individual tokens. OCR boxes are approximate model estimates. Rotated typed text is extracted but cannot receive a line highlight. Use unrotated, unwrapped typed text for predictable mapping.
- Sanitizers alter allocation layout. Printed addresses are real, but the application does not claim to identify glibc heap/mmap regions.
- Lesson snapshots include the scene, C or Python source, input, the runtime image, and a Docker replay script. C lessons also vendor referenced teaching headers. Git synchronization requires a configured private archive remote.
- This is a local prototype, not a public arbitrary-code service. Public deployment needs a separate execution VM, authentication, deployment-level resource controls, and a security review.
- The Gemini OCR call is not routed through Caveman; gateway credentials/configuration have not been provided.

Keep changes focused; use two-space JavaScript/JSX indentation and four-space C/Python indentation. Run the focused test suite before contributing. Dependencies are pinned in `package.json` and `package-lock.json`; use `npm ci` for reproducible installation and update the lockfile when changing dependencies.


## C++ compiler and compatibility

The C-family toggle now selects **C++17**, compiled by `g++` from `board.cpp`; Python is unchanged. The existing internal language ID `c` is retained so saved boards and clients still open. New snapshots record `board.cpp`, compiler `g++`, and standard `c++17`; historical `.c` snapshots keep their frozen runner and replay assets. Existing C examples may need C++ changes, such as explicit `malloc`/`realloc` casts. The bundled teaching headers and memory lesson have been adjusted; the runner never silently repairs submitted source.

Rebuild the local image with `npm run runner:build`. Hosted execution uses Wandbox's C++ compiler `gcc-head`, with `-std=c++17`; override it with `WANDBOX_CPP_COMPILER` (the previous `WANDBOX_C_COMPILER` setting is no longer used). The Libraries tab retains project teaching headers and adds runnable STL vector/sort, linked-list, queue, stack, and binary-search examples. Standard library headers are provided by the toolchain, not copied into snapshots.

To roll back the application, deploy its previous commit and rebuild the local runner image from that version. Existing archived bundles retain their own source, compiler runner, headers, and replay script; do not rewrite them during a rollback. New C++ programs require the C++ runner when rerun in the application.


In **Snippet (template) mode**, a failed compile offers **Ask Gemini to fix**. The optional request includes the assembled program and real compiler messages. Gemini can move function/class templates, free functions, and declarations to the correct scope while keeping executable statements in `main()`, preserving existing template helpers and stdin. The corrected full program is compiled separately and shown with an explanation; **Use this fix in the editor** adopts it explicitly. No AI request is made just for running template mode.


## Public access

Boardroom is public: no login, access token, or session cookie is required for compilation, Gemini OCR/assistance, or lesson snapshots. `BOARDROOM_API_TOKEN` is no longer used; an old value in hosting settings does not restrict access. Gemini and GitHub credentials remain server-side. Browser API requests omit cookies and authorization headers, and old browser-stored tokens are removed on upgrade.

Host/origin checks, request bounds, compiler isolation, and existing local concurrency/rate limits remain in place. `/api/session` is retained only for older clients: it reports public access and expires obsolete session cookies. Users share the configured lesson archive. Rollback to an older authenticated deployment requires its original server access-token configuration and user sign-in again.


## Linked lists from drawings

In C++ Full program or Snippet mode, draw a single integer chain such as `1->3->4->5` (pen strokes or black arrow shapes), select it, then **Read & review handwriting** and confirm the recognized chain. **Verify & run** invokes `list_from_arrows()` from `linked_list.h`, creates four linked nodes in order, and prints `1->3->4->5`. The Code panel shows the complete C++ program; the board remains unchanged. Typed arrow chains work too. Algorithm mode and Python retain their existing behavior.

The helper accepts ASCII `->`, signed decimal integers, duplicates and whitespace. Browser-recognized `→` is normalized to `->` before calling it. Initialize the destination with `list_init` first, and release it with `list_free`. `list_from_arrows(&list, "1->3->4->5")` returns 1 on success and replaces any existing nodes; malformed or out-of-range input returns 0 without changing the destination. No links are guessed for missing, uncertain or branched drawings. The Libraries linked-list example includes a runnable invocation.

### Scan input independently

Write test input using the blue **Pen: input** inside the selected frame. In the Code panel, press **Scan input** to send only blue input to Gemini. Review and correct the lines, then check the input confirmation box. **Use input for next run** updates standard input while retaining previously confirmed code; press **Verify & run** to execute. Repeat with new input for another run. **Save input as test case** adds each scan to the persistent Cases suite (up to 20 cases), where you can set expected output and run the suite. Changed black code must be reviewed again; input scans never confirm it. In C++ Snippet or Algorithm mode, first prepare the program with the run button; Cases then uses that displayed program.
