import { sys } from './sys';
import { appMeta } from '../apps/appList';

// shell 运行器（注入：aiTools 在 system 层，不能反向 import lib/shell——否则 shell→ai→aiTools→shell 成环）。
// App 启动时把 (cmd)=>run(cmd, aiCtx) 接上；AI 用一个常驻 ctx，cd/env 在会话内保留。
type ShellRun = (command: string) => Promise<{ out: string; err?: string; code: number }>;
let shellRun: ShellRun | null = null;
export function setShellRunner(fn: ShellRun): void {
  shellRun = fn;
}

// ───────────────────────────────────────────────────────────
// AI 能力工具 · 把内核/VFS/设置的函数暴露给 AI 调用
// 这就是「AI 底层驱动」的核心：AI 返回 tool_use → executeTool 执行到系统 → 回灌结果。
// 加一个工具 = 往 TOOL_DEFS 加一条 + 在 executeTool 加一个 case。
// ───────────────────────────────────────────────────────────

// Anthropic 工具定义（input_schema 用 JSON Schema）
export const TOOL_DEFS = [
  {
    name: 'list_apps',
    description: '列出系统里所有可启动的 App 及其 id（启动前先查 id）',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'launch_app',
    description: '启动一个 App（开一个窗口）',
    input_schema: {
      type: 'object' as const,
      properties: { appId: { type: 'string', description: 'App 的 id，先用 list_apps 查' } },
      required: ['appId'],
    },
  },
  {
    name: 'list_files',
    description: '列出某文件夹下的文件/子文件夹。folderId 省略 = 根目录 root',
    input_schema: {
      type: 'object' as const,
      properties: { folderId: { type: 'string' } },
    },
  },
  {
    name: 'create_folder',
    description: '在某文件夹下新建文件夹。parentId 省略 = root',
    input_schema: {
      type: 'object' as const,
      properties: { name: { type: 'string' }, parentId: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'create_file',
    description: '在某文件夹下新建文本文件。parentId 省略 = root',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' },
        content: { type: 'string' },
        parentId: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'write_file',
    description: '改写已有文件的内容（按 list_files 返回的文件 id）',
    input_schema: {
      type: 'object' as const,
      properties: { fileId: { type: 'string' }, content: { type: 'string' } },
      required: ['fileId', 'content'],
    },
  },
  {
    name: 'set_theme',
    description: '改系统外观：mode(dark/light) / accent(#hex 主色) / wallpaperId / radius(圆角px) / blur(模糊px)',
    input_schema: {
      type: 'object' as const,
      properties: {
        mode: { type: 'string', enum: ['dark', 'light'] },
        accent: { type: 'string' },
        wallpaperId: { type: 'string' },
        radius: { type: 'number' },
        blur: { type: 'number' },
      },
    },
  },
  {
    name: 'run_shell',
    description:
      '在系统 shell（qzsh）里执行一行命令并返回 stdout/stderr/退出码。支持管道 | 、重定向 > < 2> ，以及 ls/cat/grep/find/mkdir/rm/mv/cp/ps/pstree/kill/systemctl/pkg/chmod/chown/curl/man 等命令。比单独的文件工具更全能——浏览/操作文件、查进程与服务、装 App、改权限都用它。',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: '要执行的命令行，如 "ls -l /docs" 或 "ps | grep terminal"' },
      },
      required: ['command'],
    },
  },
];

// 执行一个工具调用，返回结果（会被序列化回灌给 AI）
export async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'list_apps':
      return Object.values(appMeta)
        .filter((a) => !a.hidden)
        .map((a) => ({ id: a.id, title: a.title }));

    case 'launch_app': {
      const appId = String(input.appId);
      const a = appMeta[appId];
      if (!a) return { error: '未知 appId：' + appId };
      sys.proc.launch(appId, a.title, { width: a.width, height: a.height });
      return { ok: true, launched: appId };
    }

    case 'list_files':
      return sys.fs.list(String(input.folderId ?? 'root')).map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type,
      }));

    case 'create_folder':
      return { id: sys.fs.mkdir(String(input.parentId ?? 'root'), String(input.name)) };

    case 'create_file':
      return {
        id: sys.fs.create(
          String(input.parentId ?? 'root'),
          String(input.name),
          String(input.content ?? ''),
        ),
      };

    case 'write_file': {
      if (!sys.fs.read(String(input.fileId))) return { error: '文件不存在' };
      sys.fs.write(String(input.fileId), String(input.content));
      return { ok: true };
    }

    case 'set_theme':
      sys.ui.setTheme(input as Parameters<typeof sys.ui.setTheme>[0]);
      return { ok: true };

    case 'run_shell': {
      if (!shellRun) return { error: 'shell 未就绪' };
      const res = await shellRun(String(input.command ?? ''));
      return { stdout: res.out, stderr: res.err ?? '', exitCode: res.code };
    }

    default:
      return { error: '未知工具：' + name };
  }
}

// 开发期把工具执行挂到 window，方便不接 LLM 也能验证「AI→系统」这条链路
if (import.meta.env.DEV) {
  (globalThis as unknown as { __qzExec: typeof executeTool }).__qzExec = executeTool;
}
