# Amen keeper (Railway service #2). Build context = repo root, so deployments/ is available.
FROM node:22-slim
WORKDIR /app/keeper
COPY keeper/package.json keeper/package-lock.json ./
RUN npm ci --omit=dev
COPY keeper/src ./src
COPY deployments /app/deployments
ENV NODE_ENV=production
CMD ["node", "src/keeper.mjs"]
