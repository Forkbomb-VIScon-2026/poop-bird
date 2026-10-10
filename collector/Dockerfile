# Face dataset collector (see collector/server.ts). Build from the repo root:
#   docker build -f collector/Dockerfile -t poop-bird-collector .
# Node runs the TypeScript directly (type stripping), so there is no build step
# and no npm install: the server has no dependencies.
FROM mirror.gcr.io/library/node:24-alpine
WORKDIR /app
# package.json only for "type": "module"
COPY package.json ./
COPY src/session.ts src/session.ts
COPY collector/server.ts collector/server.ts
# A named volume mounted here takes over this directory's owner on first use.
RUN mkdir /data && chown node:node /data
USER node
ENV DATA_DIR=/data PORT=8787 NODE_ENV=production
EXPOSE 8787
CMD ["node", "collector/server.ts"]
