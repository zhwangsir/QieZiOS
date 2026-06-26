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
import { createReadStream, existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(ROOT, '..', 'dist');
const PORT = Number(process.env.PORT) || 8787;
const TARGET = process.env.AI_PROXY_TARGET || 'https://dgmt.top';
const AI_KEY = process.env.AI_KEY || '';

// 跨设备同步：按 token 存一份状态快照（文件持久化，重启不丢）。雏形：无鉴权，靠 token 当密钥。
// 路径可由 SYNC_FILE 覆盖（Docker 里指到挂载卷，避免卷遮挡代码目录）。
const SYNC_FILE = process.env.SYNC_FILE || join(ROOT, 'sync-store.json');
let syncStore = {};
try {
  syncStore = JSON.parse(readFileSync(SYNC_FILE, 'utf8'));
} catch {
  /* 首次无文件：空 */
}

function sync(req, res, url) {
  const token = url.pathname.slice('/sync/'.length).replace(/[^\w-]/g, '');
  if (!token) {
    res.writeHead(400, { 'content-type': 'application/json' });
    return res.end('{"error":"missing token"}');
  }
  if (req.method === 'GET') {
    const blob = syncStore[token];
    res.writeHead(blob ? 200 : 404, { 'content-type': 'application/json' });
    return res.end(blob ? JSON.stringify(blob) : '{"error":"not found"}');
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 8_000_000) req.destroy(); // 8MB 上限
    });
    req.on('end', () => {
      try {
        syncStore[token] = { data: JSON.parse(body), updatedAt: Date.now() };
        writeFileSync(SYNC_FILE, JSON.stringify(syncStore));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end('{"error":"bad json"}');
      }
    });
    return;
  }
  res.writeHead(405);
  res.end('method not allowed');
}

// ── 账号体系（G7.1，功能优先 / 安全待硬化）──────────────────
// ⚠️ 简单实现：密码 sha256 无盐、随机 token 当会话、明文存文件。够单机自托管把功能跑通；
//   真鉴权（盐+慢哈希、限流、HTTPS、token 过期）留作后续硬化。
const ACCT_FILE = process.env.ACCT_FILE || join(ROOT, 'accounts-store.json');
let acct = { users: {}, data: {} }; // users[name]={passHash,tokens[]}；data[name]={data,updatedAt}
try {
  acct = JSON.parse(readFileSync(ACCT_FILE, 'utf8'));
} catch {
  /* 首次无文件：空 */
}
const saveAcct = () => writeFileSync(ACCT_FILE, JSON.stringify(acct));
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => {
      b += c;
      if (b.length > 8_000_000) req.destroy();
    });
    req.on('end', () => resolve(b));
    req.on('error', () => resolve(''));
  });
const userByToken = (token) => {
  if (!token) return null;
  for (const [u, rec] of Object.entries(acct.users)) if ((rec.tokens || []).includes(token)) return u;
  return null;
};

// /auth/register | /auth/login → 返回 {username, token}
async function auth(req, res, url) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
  let p;
  try {
    p = JSON.parse((await readBody(req)) || '{}');
  } catch {
    return json(res, 400, { error: 'bad json' });
  }
  const username = String(p.username || '').trim();
  const password = String(p.password || '');
  if (!username || !password) return json(res, 400, { error: '缺少用户名或密码' });
  if (!/^[\w.-]{1,32}$/.test(username)) return json(res, 400, { error: '用户名只允许字母数字 . _ -（≤32）' });
  if (url.pathname === '/auth/register') {
    if (acct.users[username]) return json(res, 409, { error: '用户名已存在' });
    const token = randomUUID().replace(/-/g, '');
    acct.users[username] = { passHash: sha(password), tokens: [token] };
    saveAcct();
    return json(res, 200, { username, token });
  }
  if (url.pathname === '/auth/login') {
    const rec = acct.users[username];
    if (!rec || rec.passHash !== sha(password)) return json(res, 401, { error: '用户名或密码错误' });
    const token = randomUUID().replace(/-/g, '');
    rec.tokens = (rec.tokens || []).concat(token).slice(-10); // 保留最近 10 个会话
    saveAcct();
    return json(res, 200, { username, token });
  }
  return json(res, 404, { error: 'unknown auth endpoint' });
}

// 账号制同步：靠 Authorization: Bearer <token> 解析出用户，按用户隔离存取
async function acctSync(req, res) {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  const user = userByToken(token);
  if (!user) return json(res, 401, { error: '未登录或会话失效' });
  if (req.method === 'GET') {
    const blob = acct.data[user];
    return json(res, blob ? 200 : 404, blob || { error: 'not found' });
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    try {
      acct.data[user] = { data: JSON.parse(await readBody(req)), updatedAt: Date.now() };
      saveAcct();
      return json(res, 200, { ok: true });
    } catch {
      return json(res, 400, { error: 'bad json' });
    }
  }
  return json(res, 405, { error: 'method not allowed' });
}

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
    else if (url.pathname.startsWith('/auth/')) auth(req, res, url);
    else if (url.pathname === '/sync') acctSync(req, res); // 账号制（Bearer token 鉴权）
    else if (url.pathname.startsWith('/sync/')) sync(req, res, url); // 旧 token 制（兼容）
    else serveStatic(req, res, url);
  })
  .listen(PORT, () => {
    console.log(`QieZiOS 后端就绪：http://localhost:${PORT}`);
    console.log(`  /aiproxy/* → ${TARGET}${AI_KEY ? '（服务端注入 key）' : '（转发客户端 key）'}`);
  });
