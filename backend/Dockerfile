# Backend do Nexo Assist (Railway / qualquer host Docker)
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

# A Railway injeta PORT; o servidor lê process.env.PORT.
EXPOSE 3101
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- "http://127.0.0.1:${PORT:-3101}/api/health" || exit 1
USER node
CMD ["node", "--import", "tsx", "src/server.ts"]
