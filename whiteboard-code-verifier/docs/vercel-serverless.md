# Run Boardroom on Vercel without your own Docker server

This deployment uses Vercel Functions for the private API. Gemini reads black and blue handwriting; a configured [Wandbox](https://wandbox.org/) service compiles and runs C. The app never presents Gemini-generated output as a compiler result. Source and stdin are sent to Wandbox, so do not submit private classroom data as code or input. This is a different execution environment from the local Docker runner: its compiler version, sanitizer support, limits, and runtime diagnostics may differ.

In the Vercel project, set the root directory to `whiteboard-code-verifier` and build with `npm run build`. Add these **server-side** environment variables in Project Settings → Environment Variables:

| Name | Value |
| --- | --- |
| `BOARDROOM_API_TOKEN` | A private random value generated with `openssl rand -hex 32`. Share it only with trusted teachers. |
| `GEMINI_API_KEY` | Your Google AI Studio key for handwriting recognition. |
| `WANDBOX_API_URL` | `https://wandbox.org/api` for Wandbox's public API. |
| `WANDBOX_C_COMPILER` | Optional compiler name; defaults to `gcc-head-c`. |
| `OCR_MODEL` | Optional Gemini model override. |

Remove any old `VITE_BOARDROOM_API_ORIGIN` setting so the browser calls the same Vercel deployment's `/api` functions. Redeploy after changing environment variables. Open the site, enter `BOARDROOM_API_TOKEN` in **API ACCESS TOKEN**, and click **Connect API**. The token stays in that browser tab's session storage; no secret is included in the frontend build. The health endpoint requires the token and checks that the selected C compiler appears in Wandbox's list. Test one typed C program and a handwritten board after deployment. A successful health check does not guarantee that Wandbox will accept a later execution request.

Vercel Functions have no persistent local disk or Docker runner. Lesson snapshots and Git history therefore remain unavailable on this deployment; use **Download board** to save work, or use the [persistent Docker deployment](docker-api-deployment.md) for the full archive. The hosted compiler may not provide AddressSanitizer/UBSan evidence, so memory lessons cannot promise the same diagnostics as the local runner. Wandbox's FAQ permits classroom use but applies per-IP limits and offers no SLA. The Vercel deployment may share an outbound IP with other users, so check its current usage terms and expect occasional rate-limit responses.
