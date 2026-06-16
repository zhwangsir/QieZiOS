// ───────────────────────────────────────────────────────────
// 内核 · 进程表
// "进程" = 一个正在运行的 App（连同它窗口的几何信息）。
// ───────────────────────────────────────────────────────────
export interface Process {
  id: string;       // 进程唯一 id
  appId: string;    // 对应注册表里的哪个 App
  title: string;
  x: number;        // 窗口左上角位置（用 transform 移动 → 走 GPU）
  y: number;
  width: number;
  height: number;
  z: number;        // 叠放层级（越大越在上面）
}

// $state(...) 把它变成"信号"：谁在模板里读它，谁就在它变化时自动更新。
// 写在 .svelte.ts 文件里 = 一份全局共享的响应式状态——这就是我们的"内核状态"。
export const processes = $state<Process[]>([]);

let nextZ = 1; // 普通变量即可：真正要响应式的是每个进程对象上的 z

// 启动一个 App：往进程表里加一项（= "打开一个窗口"）
export function launch(appId: string, title: string) {
  const id = `${appId}-${crypto.randomUUID().slice(0, 8)}`;
  const offset = processes.length * 28;
  processes.push({
    id,
    appId,
    title,
    x: 120 + offset,
    y: 90 + offset,
    width: 480,
    height: 320,
    z: ++nextZ,
  });
}

// 关闭：从进程表里删掉它（窗口随之从 DOM 消失）
export function close(id: string) {
  const i = processes.findIndex((p) => p.id === id);
  if (i !== -1) processes.splice(i, 1);
}

// 聚焦：把它提到最上层
export function focus(id: string) {
  const p = processes.find((p) => p.id === id);
  if (p) p.z = ++nextZ;
}
