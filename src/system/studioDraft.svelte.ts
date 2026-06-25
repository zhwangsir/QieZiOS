import { persisted } from '../kernel/persist.svelte';

// 开发者 App 的代码草稿（持久化）：写的代码刷新不丢。
export const STARTER_CODE = `<style>
  body { background: #14142b; }
  h2 { margin: 0 0 8px; }
  p { color: #a9a9c0; margin: 4px 0 12px; font-size: 14px; }
  button {
    display: block; width: 100%; text-align: left;
    padding: 10px 12px; margin: 6px 0; border: 0; border-radius: 10px;
    background: #2a2a4a; color: #fff; cursor: pointer; font-size: 14px;
  }
  button:hover { filter: brightness(1.2); }
  pre { background: #00000040; padding: 10px; border-radius: 10px; white-space: pre-wrap; font-size: 12px; }
</style>

<h2>🍆 我的第一个 QieZiOS App</h2>
<p>这个 App 跑在沙箱 iframe 里，通过 <code>qz</code> 调用系统能力。</p>

<button onclick="openCalc()">🧮 打开计算器</button>
<button onclick="goGreen()">🎨 把系统主题改成绿色</button>
<button onclick="showApps()">📋 列出所有 App</button>
<button onclick="askAi()">🤖 问 AI：用一句话介绍茄子</button>

<pre id="out">点上面的按钮试试…</pre>

<script>
  const out = document.getElementById('out');
  const show = (x) => (out.textContent = typeof x === 'string' ? x : JSON.stringify(x, null, 2));
  async function openCalc() { await qz.launchApp('calculator'); show('已调用 launch_app(calculator)'); }
  async function goGreen() { await qz.setTheme({ accent: '#22c55e', mode: 'dark' }); show('已把主色改成绿色'); }
  async function showApps() { show(await qz.listApps()); }
  async function askAi() { show('思考中…'); show(await qz.ask('用一句话介绍茄子')); }
<\/script>`;

export const studioDraft = persisted<{ code: string }>('qz.studio', { code: STARTER_CODE }, 400);
