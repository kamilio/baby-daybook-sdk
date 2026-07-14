FROM node:24.14.0-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN npm run build

FROM node:24.14.0-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/dist/oauth-server.js /app/dist/oauth-server.js
COPY --from=build --chown=node:node /app/dist/oauth-server.js.map /app/dist/oauth-server.js.map
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "/app/dist/oauth-server.js"]
