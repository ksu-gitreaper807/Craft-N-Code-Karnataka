# Run Boardroom on Vercel without your own Docker server

This deployment uses Vercel Functions for the public API. Gemini reads black and blue handwriting and provides all three pseudocode assistance levels; a configured [Wandbox](https://wandbox.org/) service compiles C and runs Python 3. The app never presents Gemini-generated output as a compiler result. Source and stdin are sent to Wandbox, so do not submit private classroom data as code or input. This is a different execution environment from the local Docker runner: its compiler version, sanitizer support, limits, and runtime diagnostics may differ.

In the Vercel project, set the root directory to `whiteboard-code-verifier` and build with `npm run build`. Add these **server-side** environment variables in Project Settings → Environment Variables:

| Name | Value |
| --- | --- |
| `GEMINI_API_KEY` | Your Google AI Studio key for handwriting recognition. |
| `WANDBOX_API_URL` | `https://wandbox.org/api` for Wandbox's public API. |
| `WANDBOX_CPP_COMPILER` | Optional compiler name; defaults to `gcc-head`. |
| `WANDBOX_PYTHON_COMPILER` | Optional Python runtime; defaults to `cpython-3.13.8`. |
| `OCR_MODEL` | Optional Gemini model override. |
| `SNAPSHOT_GITHUB_REPOSITORY` | Archive repository, e.g. `ksu-gitreaper807/Craft-N-Code-Karnataka`. |
| `SNAPSHOT_GITHUB_BRANCH` | Optional archive branch; defaults to `boardroom-lessons`. |
| `SNAPSHOT_GITHUB_TOKEN` | Fine-grained GitHub token limited to the archive repository, with **Contents: read/write**. |

Remove any old `VITE_BOARDROOM_API_ORIGIN` setting so the browser calls the same Vercel deployment's `/api` functions. Redeploy after changing environment variables. Boardroom is public and requires no sign-in, token, or cookie. Existing `BOARDROOM_API_TOKEN` values are ignored. Keep Gemini and GitHub secrets server-side. The public health endpoint checks that the selected runtime (`/api/health?language=python` for Python) appears in Wandbox's list. Test C++, Python, and a handwritten board after deployment. A successful health check does not guarantee that Wandbox will accept a later execution request.

## GitHub lesson snapshots

Vercel stores lesson snapshots directly through GitHub's Git Data API; it needs neither local Git nor a persistent disk. Configure the three snapshot variables above in **Production**, then redeploy. Create the token under GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens; select only the archive repository, grant Contents read/write, and choose an expiry. Store it only in Vercel's server environment. Preview deployments need their own explicitly configured archive variables if they should save lessons.

The repository must have an initial commit (a README is sufficient). The archive branch is created from its default branch on the first save. Each snapshot adds `YYYY-MM-DD/HH-MM-SS-title-id/` with `board.excalidraw`, `board.cpp` or `board.py`, `input.txt`, and the portable replay bundle. A single branch update publishes every file together. Concurrent saves retry on the newest commit; updates never force-push. The application default branch is not updated by snapshot saves. Reopening and comparing headers read committed data from GitHub, so history survives function restarts and redeploys. History shows up to 30 lessons from the latest 300 commits, including older local archive commits that were pushed to this branch.

Snapshots have the same visibility as the repository: lessons on a public fork are public. All visitors share this archive. If GitHub access fails, the save reports an error and the current canvas remains available for download. After a timeout, refresh History before saving again, because GitHub may already have accepted the commit. Missing configuration is shown in History; expired tokens, permissions, branch rules, and rate limits produce actionable errors. Rotate the archive token before its expiry. Existing local disk snapshots continue to use the separate Git archive and its configured remote; they are not uploaded automatically by the hosted store.

The hosted compiler may not provide AddressSanitizer/UBSan evidence, so memory lessons cannot promise the same diagnostics as the local runner. Wandbox's FAQ permits classroom use but applies per-IP limits and offers no SLA. The Vercel deployment may share an outbound IP with other users, so check its current usage terms and expect occasional rate-limit responses.
