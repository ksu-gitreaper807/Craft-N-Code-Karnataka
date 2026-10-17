# Whiteboard Code Verifier — Project Notes

Everything discussed so far, in one place: concept, design decisions, risks, platform choice, and hackathon plan.

---

## 1. Concept

A system that takes code a teacher writes on a whiteboard, compiles and runs it, and shows the result.

**Goals**

- Convince students the code works by running it for real.
- Catch errors in the teacher's written code.
- Attach teaching notes automatically. Example: when `malloc()` is explained, show where and how that memory is actually allocated.
- Let the teacher use abstraction layers: `#include <stack.h>` imports a curated C stack implementation.
- Preserve every lesson as a versioned snapshot in git.

**Problem statement**

Code taught on a whiteboard is never executed. Students take it on trust, and the teacher's slips (missing `&` in `scanf`, off-by-one, dangling pointer) surface later or never. Concepts like `malloc()` stay abstract. Retyping code into an IDE breaks lecture flow.

---

## 2. Evolution of the plan

| Stage | Input method | Status |
|---|---|---|
| v0 | Camera capture of a physical whiteboard + OCR | Dropped: camera is not ideal |
| v1 | Excalidraw-based canvas | Current direction |
| Constraint | Must run on a website, for compatibility | Fixed |
| Constraint | Hackathon project, needs a presentable demo | Drives scope |

Why the camera pipeline died: warp, threshold, glare removal, line segmentation, lighting calibration, face privacy, and capture latency all disappear when the board is a canvas. Elements have ids, positions, and exact stroke colors.

---

## 3. Original camera pipeline (kept for reference)

```
cam frame -> cleanup -> handwriting OCR -> code repair -> HUMAN CONFIRM
          -> sandbox compile/run -> diagnostic map -> overlay on board image
```

1. **Cleanup (OpenCV):** perspective warp, adaptive threshold, glare/shadow removal, line segmentation. Keep line-index to bbox map.
2. **OCR:** Tesseract is bad at handwriting and code. Use TrOCR or a vision LLM per line crop, with n-best candidates and per-character confidence. Recover indentation from bbox x-offset.
3. **Code repair (tree-sitter C grammar):** fix only confusable characters (`l/1/I`, `0/O`, `;/:`, `{/(`, `-/_`, `==/=`). Bracket-balance check; unbalanced means low-confidence flag.
4. **Human confirm:** show OCR text beside the board crop; fix in about 10 seconds. Skipping this produces false "teacher bug" reports.
5. **Sandbox:** `bwrap` or `nsjail`, no network, rlimits, 2-5 second timeout. Compile with `gcc -g -O0 -Wall -Wextra -fsanitize=address,undefined`.
6. **OCR error vs teacher error:**
   - Compile error on line N: retry with next-best OCR hypotheses for line N.
   - A hypothesis compiles: likely OCR error ("low-confidence char, did you mean X?").
   - All hypotheses fail at high confidence: teacher bug; show crop with line highlighted plus gcc message.
   - Runtime bugs (ASan/UBSan) are never OCR errors. Report the stack trace mapped to the board line.

This logic carries over unchanged if handwriting (freedraw) mode is added later.

---

## 4. Teaching notes, triggered by AST node

| Trigger | Note |
|---|---|
| `malloc/calloc/realloc` | Region plus chunk layout (section 5) |
| `free` | Memory returns to the allocator, not the OS. Dangling pointer: set to NULL |
| Local array | Stack, auto-freed, about 8 MB limit (`ulimit -s`) |
| `sizeof(ptr)` on array parameter | Decays to pointer: 8, not N*size |
| `scanf("%d", x)` | Missing `&` |
| `int` arithmetic | Signed overflow is UB |
| `gets`, `strcpy` | Overflow, no bounds |

---

## 5. malloc: where memory really comes from

- Small request: glibc ptmalloc arena. Main arena grows via `brk/sbrk`, shown as `[heap]` in `/proc/self/maps`.
- Request at or above `M_MMAP_THRESHOLD` (128 KiB default, dynamic): anonymous `mmap`, its own region. `free` calls `munmap`, returning memory straight to the OS.
- Threads get extra arenas via `mmap`.
- Chunk: 16-byte header before the returned pointer (prev_size + size, low bits are flags). Minimum chunk is 32 bytes on x86-64, so `malloc(1)` still burns 32.
- Lazy allocation: virtual only. Physical pages fault in on first touch. `malloc(1GB)` succeeds and RSS stays tiny until written.
- Typical addresses: stack `0x7ffc...`, heap near binary `0x55...` (PIE), mmap/libs `0x7f...`.

### Live demo shim (`LD_PRELOAD`)

```c
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *region(void *p) {
    static char line[512];
    unsigned long a = (unsigned long)p, lo, hi;
    FILE *f = fopen("/proc/self/maps", "r");
    const char *r = "unknown";
    while (f && fgets(line, sizeof line, f)) {
        sscanf(line, "%lx-%lx", &lo, &hi);
        if (a >= lo && a < hi) {
            r = strstr(line, "[heap]") ? "brk heap" :
                strstr(line, "[stack]") ? "stack" : "mmap";
            break;
        }
    }
    if (f) fclose(f);
    return r;
}

void *malloc(size_t n) {
    static void *(*real)(size_t);
    if (!real) real = dlsym(RTLD_NEXT, "malloc");
    void *p = real(n);
    static __thread int busy;           // fopen mallocs: recursion guard
    if (!busy) {
        busy = 1;
        fprintf(stderr, "[malloc %zu -> %p : %s]\n", n, p, region(p));
        busy = 0;
    }
    return p;
}
```

Caveat: ASan replaces malloc, so the shim conflicts. Use two passes: ASan build for bugs, plain build plus shim for the memory demo.

Why WASM is wrong for this: WebAssembly has one linear memory block, so there is no `brk` heap, no `mmap` region, no ASLR, and no `/proc/self/maps`. The malloc demo would be fake.

---

## 6. Header library abstraction

Library is trusted and curated, shipped with the system. Teacher code is untrusted.

```
lib/
  stack.h        # header-only, STB style: no link step
  queue.h
  linkedlist.h
  manifest.json  # header -> exported symbols, teaching notes
```

Compile: `gcc -Ilib -g -O0 -Wall -Wextra -fsanitize=address,undefined board.c`

### Wins

- **Closed vocabulary.** The manifest lists every header and symbol.
  - `#include <stak.h>` fuzzy-matches to `stack.h`, flagged low-confidence.
  - `stack_psuh(` is edit distance 1 from `stack_push`: "did you mean?" before compile.
  - Check call arity against prototypes pre-compile.
  - Whitelist includes. Unknown header: reject, no sandbox run. Blocks `#include "/etc/passwd"` tricks.
- **Dependencies** (`queue.h` including `stack.h`) are allowed, resolved in the manifest, handled by include guards.

### Error attribution: three classes

| Where error lands | Meaning | Report |
|---|---|---|
| Teacher line, compile | OCR or teacher | n-best retry |
| Teacher line, runtime (ASan/UBSan) | Teacher bug | Stack trace mapped to board line |
| Inside `lib/` frame | **Contract violation** by teacher, not a lib bug | Point at teacher call site, quote the contract |

Rule: filter ASan traces. Drop `lib/` frames, show the first non-lib frame. Wrap the API in macros capturing `__LINE__` so contract failures report the board line directly.

### stack.h

```c
#ifndef STACK_H
#define STACK_H
#include <stdio.h>
#include <stdlib.h>

typedef struct {
    int *data;
    size_t len, cap;
} Stack;

static inline void stack_init(Stack *s) {
    s->data = NULL; s->len = s->cap = 0;
}

static inline void stack_push_(Stack *s, int v, int line) {
    if (s->len == s->cap) {
        size_t nc = s->cap ? s->cap * 2 : 4;
        int *p = realloc(s->data, nc * sizeof *p);   /* TEACH: realloc */
        if (!p) { fprintf(stderr, "[stack] OOM at board line %d\n", line); exit(1); }
        fprintf(stderr, "[stack] grow %zu -> %zu ints, buf %p\n", s->cap, nc, (void *)p);
        s->data = p; s->cap = nc;
    }
    s->data[s->len++] = v;
}

static inline int stack_pop_(Stack *s, int line) {
    if (s->len == 0) {
        fprintf(stderr, "[stack] CONTRACT: pop on empty stack, board line %d\n", line);
        exit(2);
    }
    return s->data[--s->len];
}

static inline int stack_empty(const Stack *s) { return s->len == 0; }
static inline void stack_free(Stack *s) { free(s->data); s->data = NULL; s->len = s->cap = 0; }

#define stack_push(s, v) stack_push_((s), (v), __LINE__)
#define stack_pop(s)     stack_pop_((s), __LINE__)
#endif
```

Caveat: `__LINE__` is the line in the reconstructed source. Keep a 1:1 line map to board elements. Never reflow or drop blank lines.

### Teaching notes inside the library

The library hides malloc from the teacher, but notes still fire:

- `stack_push`: "Hidden `realloc` inside. Cap doubles 4, 8, 16. Amortized O(1)."
- Runtime grow log pairs with the `LD_PRELOAD` shim: shows brk heap vs mmap. A big grow (128 KiB or more) jumps to the mmap region, so students see the threshold cross.
- Missing `stack_free`: LeakSanitizer reports the leak with a frame in `stack_push_`; remap to the teacher's push call site. Note: "Lib alloc, you own free."
- `Stack s;` local: the struct lives on the stack, `s.data` on the heap. Two regions, one object.

Manifest holds the note text per symbol:

```json
{
  "stack.h": {
    "symbols": ["Stack","stack_init","stack_push","stack_pop","stack_empty","stack_free"],
    "notes": {
      "stack_push": "Hidden realloc. Cap doubles. See grow log.",
      "stack_free": "Caller owns buffer. Forget -> leak."
    }
  }
}
```

### Decisions

- Show lib source to students: **yes, collapsible**. Abstraction is good; a black box is bad for learning.
- Versioning via a button and/or snapshot mechanism, pushing teacher notes as raw code with used headers and dependencies to a git repository (section 7).

---

## 7. Snapshots, versioning, git

A snapshot is a self-contained directory that compiles later with zero reference to the live `lib/`.

```
boards/2026-10-16_1432_linkedlist-intro/
  board.json      # Excalidraw scene (was board.jpg in the camera design)
  board.c         # confirmed code, 1:1 line map kept
  input.txt       # stdin taken from the stdin-colored elements
  ocr.json        # (freedraw mode only) n-best, per-char conf, edits
  lib/            # vendored copy of ONLY the used headers (transitive)
  lib.lock        # lib version + sha256 per header
  build.sh        # exact gcc command, flags frozen
  result.json     # diagnostics, ASan/UBSan output, fired teaching notes
```

### Finding used headers

Let the preprocessor resolve them; it catches transitive includes:

```bash
#!/usr/bin/env bash
set -euo pipefail
board=$1; out="boards/$(date +%F_%H%M)_$2"
mkdir -p "$out"
gcc -MM -Ilib "$board" | sed 's/\\$//' | tr -s ' ' '\n' | grep '^lib/' |
while read -r h; do cp --parents "$h" "$out/"; done
cp "$board" "$out/board.c"
( cd "$out" && sha256sum lib/* > lib.lock \
  && echo "version=$(git -C ../../lib describe --tags --always)" >> lib.lock )
```

### Versioning rules

- `lib/` is its own git repo with semver tags. The boards repo is separate.
- Same major version: signatures never change. A break means a new major and `lib/v2/`. A board pins `-Ilib/v1`.
- The snapshot vendors headers, so old boards compile forever. `lib.lock` hashes detect tampering; mismatch means refuse to run.
- `build.sh` replays with `-I./lib` for reproducibility.

### Buttons

| Button | Action |
|---|---|
| **View lib source** | Collapsible; renders from the snapshot's vendored copy, not the latest |
| **Snapshot** | Write dir, `git add`, commit, push |
| **Rebuild on latest lib** | Run an old board against the new lib, diff outputs, flag behavior change before the teacher upgrades the pin |

The grow log line `[stack] grow 4 -> 8` can be clickable, jumping to the `realloc` line in the lib viewer.

### Git flow

- Commit message: `board: <title> | lib v1.2.0 | status: compiled|teacher-bug`
- Commit only after human confirmation. Raw unconfirmed OCR never becomes `board.c`; it lives in `ocr.json`, so history shows what OCR got wrong vs what the teacher wrote.
- Local commit always (instant). Push asynchronously with a retry queue. Network down in class must not block the lecture.
- Tag teacher bugs: `git tag bug/<board>`.

### Caveats

- **Privacy:** applied to the camera design (faces on `board.jpg`). The canvas design removes it.
- **Credentials:** git push runs on the host snapshotter, outside the sandbox. The sandbox has no keys and no network; only `result.json` crosses out. Treat sandbox output as data.
- **Dedup:** vendored `lib/` repeats per board. Fine for small headers; dedupe via `lib.lock` later.
- **Dirty state:** snapshot even on timeout or crash, with `status: crashed`. Failure is data.

---

## 8. stdin via color

Ink color is a channel. Under Excalidraw the element has an exact `strokeColor`, so this is a string match.

| Color | Channel |
|---|---|
| Default (black) | Code |
| One chosen color (blue suggested) | stdin, becomes `input.txt` |
| Other colors | Ignored by the pipeline; free for annotation |

Rules and edge cases:

- Line breaks in stdin-colored text are literal newlines. Order lines by y position.
- Run as `./a.out < input.txt` with a read-only mount.
- No stdin elements: stdin is EOF. `scanf` returns fast, no hang. Report "program read stdin, board has none" in neutral wording.
- Too little input: `scanf` hits EOF, uninitialized variable. A teaching moment about checking `scanf` return values.
- Merged transcript for display: interleave the input into the output so students see `Enter: 3 5` as in a real terminal; the program still reads the clean file.
- Multiple runs per board (test cases): open question. Simple v1 is one input.
- Later: highlight the stdin token as each `scanf` consumes it (needs stdin tracking).
- Colorblind users: offer a boxed-input fallback.

Camera-era notes (HSV masks, swatch calibration, lighting shift) no longer apply.

---

## 9. Issues anticipated (ranked)

1. **Handwriting OCR on code** (camera or freedraw): about 90-95% per-char accuracy means roughly 2 errors per 40-char line. Human confirm is mandatory. Measure with 30-50 real samples before choosing a model. Fallback: stroke data from a tablet or canvas.
2. **Teacher shorthand is not valid C:** `...`, no `main`, pseudo-code. Add a snippet mode: auto-wrap or syntax check only; report "unfinished", not "wrong".
3. **False accusation of the teacher** (social risk): neutral wording ("line 7: gcc says X. Check board."), show evidence, teacher sees it first.
   - 3b. **Intentional bugs** to teach UB: add an "expected bug" toggle.
4. **Latency in a classroom:** trigger on explicit action, cache per-line OCR, keep the board with the result.
5. **Nondeterminism:** ASLR, `rand()`, uninitialized reads. Use `setarch -R`, fixed seeds, then teach that real runs vary.
6. **Sandbox gaps:** stdin blocking, infinite loops, fork bombs, huge allocations. `RLIMIT_AS` conflicts with ASan, so use a cgroup memory limit. `bwrap` needs unprivileged user namespaces; verify on the host.
7. **Line map drift:** keep the line-to-element map as a core structure; never reflow.
8. **Malloc shim vs ASan vs lib:** two builds double complexity. v1 can skip the shim and use the lib's own grow log.
9. **Hardware and environment** (camera design): angle, glare, marker color, fixed camera.

Web-specific additions:

- Public endpoint runs arbitrary code: session token, rate limit, queue cap, kill switch, separate VM with no credentials.
- Git credentials stay on the backend.
- Classroom network down: ship a `docker compose` bundle for a LAN box.
- CORS and HTTPS between frontend and API; an HTTPS frontend cannot call an HTTP backend.
- Test pen input on iPad Safari and Android Chrome.
- Cap concurrent runs to control cost.

Excalidraw-specific:

- Pin the Excalidraw version; the element schema changes between releases.
- Read the text element's `text` field (raw newlines), not wrapped visual lines.
- One **frame** equals one program; multiple frames mean multiple programs.
- Run on a button press, not on every `onChange`.
- Draw overlays as locked elements marked with `customData` (check version support) so one click clears them.

---

## 10. Canvas platform decision

`excalidraw-libraries` (github.com/excalidraw/excalidraw-libraries) holds shape collections only (`.excalidrawlib` JSON, published at libraries.excalidraw.com). It is **not** an extension API. Publish rules: 3 or more related items, English, grouped items, no trivial shapes. Useful for shipping a C teaching kit (stack frame, heap block, pointer box, chunk header diagrams).

Excalidraw has no real plugin system. Options:

| Option | Verdict |
|---|---|
| Browser extension injecting into excalidraw.com | Fragile, no global scene API |
| **Own web app embedding `@excalidraw/excalidraw`** | Chosen. MIT, no license key, no watermark |

Alternatives compared:

| Platform | Fit | Catch |
|---|---|---|
| Excalidraw | MIT, simple JSON elements, exact `strokeColor` | No custom element types |
| tldraw SDK | Polished React SDK, custom shapes (native `CodeFrame` shape possible), built-in sync | Source-available license; production needs a license key (free hobby license keeps the watermark; commercial pricing via sales) |
| Miro / Figma SDKs | Familiar | Closed, vendor lock, cloud only |
| Konva/Fabric.js custom | Full control | Rebuild pen, text, select, undo |
| MS Whiteboard / Jamboard | Reach | No embedding API; Jamboard is dead |

Decision: **Excalidraw for v1**. Put the canvas behind an adapter interface (`getCode()`, `getStdin()`, `elementBBox(id)`, `drawOverlay()`, `clearOverlay()`) so moving to tldraw later is about one file.

Side idea: a code editor (Monaco/CodeMirror) as the main surface with the whiteboard beside it, handwriting as an optional import mode. Removes most extraction risk; loses the "write on the board" feel.

### Input modes

- **A. Text tool (typed):** no OCR, exact indentation. Build first.
- **B. Freedraw (pen):** stroke data with color, cleaner than pixels. Render per-line strokes to an image for TrOCR or a vision LLM, or use a stroke-based recognizer (MyScript, Google ML Kit digital ink; not evaluated). Keep human confirm and n-best retry. Group strokes into lines by y-overlap. Add later behind the same interface.

---

## 11. Website architecture

```
Browser (static site)              Server (VPS/VM)
 React + Excalidraw   --HTTPS-->   API (FastAPI/Node)
 Run button, overlay               +- queue + auth + rate limit
 lib source viewer                 +- sandbox runner (compile, run, ASan)
                                   +- snapshot writer -> git push
                                   +- result.json back to browser
```

Frontend hosting: any static host (Vercel, Netlify, Cloudflare Pages, GitHub Pages).

Where C runs:

| Option | Verdict |
|---|---|
| In-browser WASM | Offline and serverless, but fake memory layout; kills the malloc teaching. Maybe a "quick check" mode later |
| Self-hosted Judge0 | Fast start: open source, sandboxed compile/run of untrusted code, self-hostable |
| Own thin runner (`bwrap`/`nsjail` in Docker) | Full control: ASan flags, `setarch -R`, `LD_PRELOAD` shim, vendored lib, trace remap |

Judge0 caveats: its README lists older GCC versions (7.4 to 9.2) for C, so check ASan/UBSan support in the release you deploy. Sources disagree on its license (one hosting page says MIT; the author recalls GPL), so read the repo `LICENSE`. Custom compile pipelines fight its language definitions.

Recommendation: build an own runner that **mimics Judge0's request/response shape** (source, stdin, flags in; stdout, stderr, status, time, memory out). Judge0 for a quick prototype, own runner when custom features land; the frontend never changes.

Hosting constraint: the sandbox needs Linux namespaces and cgroups. Serverless platforms usually cannot provide this; use a VPS or VM (Hetzner, DigitalOcean, Oracle free tier, Fly.io). Verify unprivileged user namespaces on the chosen host. Open question: college server or rented VPS?

---

## 12. Hackathon plan

Goal: a wow moment in a 3-minute demo, not the full system.

### Stack

| Piece | Pick |
|---|---|
| Frontend | Vite + React + `@excalidraw/excalidraw`, deployed on Vercel/Netlify |
| Execution | Hosted Judge0 for hour 1; own Flask/FastAPI + `gcc` in Docker on one VPS for the real demo |
| Hardening | Docker limits + timeout + no network (say "production uses nsjail") |
| OCR | None in v1 (typed text elements) |
| Snapshot | Download scene JSON; git push only if time allows |

### MVP build order

1. **Hours 0-3:** Excalidraw app; code typed in a text element inside a frame; Run button POSTs to the backend; stdout appears in a text element beside the frame.
2. **Hours 3-6:** Backend compiles with `gcc -g -Wall -fsanitize=address,undefined`, 5-second timeout. Parse `file.c:LINE:COL: error`, find line N in the element, draw a **red rectangle** on the canvas. This is the money shot.
3. **Hours 6-9:** stdin by exact `strokeColor` match (about 20 lines of code).
4. **Hours 9-12:** One teaching note: malloc. Detect `malloc(` by regex (skip tree-sitter). After the run, draw a stack box and heap box with real addresses from the program's `%p` prints, labeled brk heap vs stack.
5. **Hour 12+:** `#include <stack.h>` with `-Ilib` and the `__LINE__` macro contract error catching `pop` on an empty stack at the board line.
6. Polish: spinner, dark theme, three prepared demo boards.

### Cut list

- Camera, OpenCV, warp, glare (dead).
- Handwriting OCR, n-best, confirm UI (roadmap slide).
- Versioning, snapshots, vendoring, `lib.lock` (slide only).
- bwrap/nsjail hardening, auth beyond a shared passcode header, tldraw, Judge0 migration, WASM.
- `LD_PRELOAD` shim (use the program's own `%p` prints).

### Demo script (3 minutes)

1. Teacher types linked-list code with a missing `&` in `scanf` and a `malloc` without `free`.
2. stdin-colored text `3 5`.
3. Run: red box on the `scanf` line; LeakSanitizer report mapped to the `malloc` line.
4. Fix and rerun: correct output plus the memory diagram.
5. `#include <stack.h>`, pop on empty stack: contract error at the board line.
6. Roadmap slide: handwriting OCR, snapshots, versioned lib.

### Risks that kill hackathons

1. Deploy last-minute: deploy a skeleton in hour 2 and redeploy continuously.
2. CORS and mixed content: put the API behind HTTPS (Caddy auto-TLS, or Fly/Render).
3. ASan in restricted containers: test `docker run` flags early (memory limits can clash).
4. Line mapping off by one: keep raw text, split on `\n`, 1-indexed, test early.
5. Scope creep: anything not in the demo script gets cut.
6. Live failure: record a fallback video; run the backend on a laptop with `docker compose` as a network-free fallback; do not leave the public endpoint open after the demo.

Team split (2-3 people): A frontend and overlay drawing; B runner, error parsing, Docker deploy; C demo boards, lib header, slides, video.

---

## 13. Overall build order (beyond the hackathon)

1. Static site: Excalidraw, frame-to-code extraction, Run button.
2. Runner service on a VPS, plain `gcc`, stdout back.
3. ASan/UBSan and error overlay on element bounding boxes.
4. stdin color channel.
5. Auth and rate limiting, before any public URL.
6. Snapshot and git push (server side).
7. Teaching notes and the malloc diagram.
8. Freedraw OCR mode with confirm and n-best attribution.
9. LAN `docker compose` bundle.

---

## 14. Open questions

- Typed-only v1, or must handwriting exist from day one?
- Single stdin per board, or multiple runs (test cases)?
- Who hosts: college server or rented VPS?
- Hackathon length and team size (24/36/48 hours)?
- Should consumed stdin tokens be highlighted now or later? (Recommended: later.)
- Which stdin ink color matches the teacher's available markers/palette?
- Hosted Judge0 only for the first hour, or skip straight to the own runner?
