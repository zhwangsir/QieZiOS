// ───────────────────────────────────────────────────────────
// QieZiOS 最小生产后端（零依赖，仅用 Node 内置模块）
//  · 托管 dist/ 静态资源（SPA 回退到 index.html）
//  · 反代 /aiproxy/* → 上游 AI 网关，补上「Vite 代理只在 dev 生效」的缺口
//    （浏览器同源请求 → 本服务 → 网关，绕过 CORS；SSE 流式透传）
//
// 用法：先 `npm run build`，再 `node server/index.mjs`（或 `npm run serve`）。
// 环境变量：
//   PORT             监听端口（默认 8787）
//   AI_PROXY_TARGET  上游网关（默认 https://dgmt.top）
//   AI_KEY           设了就由服务端注入 Bearer（客户端可不再持有 key）；不设则转发客户端的
// ───────────────────────────────────────────────────────────
import http from 'node:http';
import https from 'node:https';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(ROOT, '..', 'dist');
const PORT = Number(process.env.PORT) || 8787;
const TARGET = process.env.AI_PROXY_TARGET || 'https://dgmt.top';
const AI_KEY = process.env.AI_KEY || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function proxy(req, res, url) {
  const upstream = new URL(url.pathname.replace(/^\/aiproxy/, '') + url.search, TARGET);
  const headers = { ...req.headers, host: upstream.host };
  delete headers['content-length']; // 流式：让底层重算
  if (AI_KEY) headers['authorization'] = 'Bearer ' + AI_KEY; // 服务端注入 key（可选）
  const lib = upstream.protocol === 'https:' ? https : http;
  const up = lib.request(upstream, { method: req.method, headers }, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res); // SSE / 普通响应都原样透传
  });
  up.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('aiproxy error: ' + e.message);
  });
  req.pipe(up); // 转发请求体
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/' || !extname(p)) p = '/index.html'; // 无扩展名 → SPA 入口
  const file = normalize(join(DIST, p));
  // 路径穿越保护 + 存在性检查；找不到就回退 index.html
  if (file.startsWith(DIST) && existsSync(file) && statSync(file).isFile()) {
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
    return;
  }
  const idx = join(DIST, 'index.html');
  if (existsSync(idx)) {
    res.writeHead(200, { 'content-type': MIME['.html'] });
    createReadStream(idx).pipe(res);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('dist/ 未构建？先跑 npm run build');
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/aiproxy/')) proxy(req, res, url);
    else serveStatic(req, res, url);
  })
  .listen(PORT, () => {
    console.log(`QieZiOS 后端就绪：http://localhost:${PORT}`);
    console.log(`  /aiproxy/* → ${TARGET}${AI_KEY ? '（服务端注入 key）' : '（转发客户端 key）'}`);
  });
