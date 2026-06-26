// ───────────────────────────────────────────────────────────
// Shell 后台作业表（job control）。运行时态（不持久化），跨终端共享。
// `cmd &` → 不 await 地跑、登记一条；jobs 列出；fg 等它完成；完成发通知。
// ───────────────────────────────────────────────────────────
export interface Job {
  n: number; // 作业号
  cmd: string;
  status: 'running' | 'done' | 'failed';
  code?: number;
}

export const jobs = $state<{ list: Job[] }>({ list: [] });

let counter = 0;
export function addJob(cmd: string): Job {
  const j: Job = { n: ++counter, cmd, status: 'running' };
  jobs.list.push(j);
  if (jobs.list.length > 30) jobs.list.splice(0, jobs.list.length - 30); // 封顶，别无限涨
  return j;
}
export function finishJob(n: number, code: number): void {
  const j = jobs.list.find((x) => x.n === n);
  if (j) {
    j.status = code === 0 ? 'done' : 'failed';
    j.code = code;
  }
}
