# ── 构建阶段：装依赖 + 打包前端 ──
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── 运行阶段：只需 node + dist + server（server/index.mjs 仅用 node 内置模块，零运行时依赖）──
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
ENV PORT=8787
ENV SYNC_FILE=/data/sync-store.json
EXPOSE 8787
# /data 用于持久化同步快照（compose 里挂卷）
VOLUME ["/data"]
CMD ["node", "server/index.mjs"]
