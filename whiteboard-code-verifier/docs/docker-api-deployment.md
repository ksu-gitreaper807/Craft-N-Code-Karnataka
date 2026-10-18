# Connect the Vercel frontend to a Docker API server

This is the persistent-server option for Docker-based C execution, Gemini OCR, and Git-backed lesson snapshots. The frontend at `https://board-of-c.vercel.app` calls that server over HTTPS. If you want handwriting and hosted C compilation without your own server, use the [Vercel Functions setup](vercel-serverless.md) instead. API access is public; no login is required.

## If you do not have a server yet

Create a small VPS (virtual private server) with a provider of your choice. Choose Ubuntu 24.04 or another supported Linux distribution, at least 2 vCPUs, 4 GB RAM, and about 20 GB of disk for Node, Docker, the GCC image, and lesson snapshots. A region near the classroom reduces latency. Add your SSH public key during setup, enable the provider firewall for SSH and HTTPS (ports 22, 80, and 443), and record the server's public IPv4 address. This server is separate from Vercel and generally has a recurring cost.

You also need a DNS hostname for the API, such as `api.yourdomain.com`. Create an A record pointing it at the VPS IPv4 address. Caddy can then obtain an HTTPS certificate automatically. The server address is what you will put in Vercel's `VITE_BOARDROOM_API_ORIGIN`; `https://board-of-c.vercel.app` remains the frontend address. If you do not want a VPS yet, the app can run entirely on your own Linux machine with the [local setup](../README.md#run-locally), or use the Vercel Functions option above.

On a fresh Ubuntu server, install Git, Docker Engine, and Caddy, and install Node.js 22.12 or newer from a supported Node distribution. Then create a dedicated `boardroom` account with Docker access and clone this repository into a directory it owns. Keep the Docker API on loopback; Caddy is the public HTTPS entry point. Docker group membership gives root-equivalent host access, so only the dedicated service account should have it.

## Connect the frontend and API

1. Check out this repository on the server, then run from `whiteboard-code-verifier/`:

   ```bash
   npm ci
   npm run runner:build
   npm run build
   cp .env.example .env
   ```

2. In the server's `.env`, set `BOARDROOM_APP_ORIGIN=https://board-of-c.vercel.app` and `GEMINI_API_KEY` if handwriting recognition is needed. Set `SNAPSHOT_DIR` to a persistent, writable location. Keep `.env` out of Git and readable only by the API account. `BOARDROOM_API_HOST=api.example.com` can be set if the reverse proxy preserves the external Host header.
3. Keep Node bound to loopback. A Caddy site can terminate HTTPS and forward to it:

   ```caddyfile
   api.example.com {
       reverse_proxy 127.0.0.1:8787 {
           header_up Host 127.0.0.1:8787
       }
   }
   ```

   With this Host override, `BOARDROOM_API_HOST` is unnecessary. Allow inbound HTTPS to Caddy; do not expose port 8787 directly. Start the API under a persistent service manager and restart it after changing `.env`. For example, adapt the paths and account in this systemd unit:

   ```ini
   [Unit]
   Description=Boardroom API
   After=network-online.target docker.service
   Requires=docker.service

   [Service]
   User=boardroom
   SupplementaryGroups=docker
   WorkingDirectory=/opt/boardroom/Craft-N-Code-Karnataka/whiteboard-code-verifier
   ExecStart=/usr/bin/node server/index.mjs
   Restart=on-failure
   RestartSec=3

   [Install]
   WantedBy=multi-user.target
   ```

   Use your actual Node path and ensure the service account can write `SNAPSHOT_DIR`. API access requires no token.
4. In the Vercel project rooted at `whiteboard-code-verifier/`, set `VITE_BOARDROOM_API_ORIGIN=https://api.example.com` and redeploy. This is a public hostname; Gemini and GitHub keys stay server-side. There is no token entry or cookie session.
5. Confirm `https://api.example.com/api/health` answers HTTP 200 without credentials, and that the page shows **Runner ready**. Test a typed lesson, then OCR if configured. Docker and `whiteboard-runner:local` must be available. Snapshot Git synchronization requires a separate archive remote.

CORS allows the configured frontend origin; preview URLs need their own origin configuration. Existing local request-size, concurrency and execution limits remain. `BOARDROOM_API_TOKEN` is no longer used.
