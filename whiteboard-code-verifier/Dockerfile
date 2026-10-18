FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 8787

ENV HOST=0.0.0.0
ENV PORT=8787
ENV NODE_ENV=production

CMD ["node", "server/index.mjs"]
