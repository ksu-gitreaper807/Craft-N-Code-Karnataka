FROM node:22-bookworm-slim

WORKDIR /app

# Copy root packaging
COPY package.json package-lock.json* ./
COPY whiteboard-code-verifier/package.json ./whiteboard-code-verifier/

# Install root & workspace dependencies
RUN npm install

# Copy entire project source
COPY . .

# Build frontend assets
WORKDIR /app/whiteboard-code-verifier
RUN npm run build

# Expose default port
EXPOSE 8787

ENV HOST=0.0.0.0
ENV PORT=8787
ENV NODE_ENV=production

CMD ["node", "server/index.mjs"]
