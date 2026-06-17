import { launch } from '../kernel/processes.svelte';
import { children, createDir, createFile, getNode, writeFile } from '../kernel/vfs.svelte';
import { settings } from './settings.svelte';
import { wallpapers } from './wallpaper';
import { appMeta } from '../apps/appList';

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
      launch(appId, a.title, { width: a.width, height: a.height });
      return { ok: true, launched: appId };
    }

    case 'list_files':
      return children(String(input.folderId ?? 'root')).map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type,
      }));

    case 'create_folder':
      return { id: createDir(String(input.parentId ?? 'root'), String(input.name)) };

    case 'create_file':
      return {
        id: createFile(
          String(input.parentId ?? 'root'),
          String(input.name),
          String(input.content ?? ''),
        ),
      };

    case 'write_file': {
      const n = getNode(String(input.fileId));
      if (!n) return { error: '文件不存在' };
      writeFile(String(input.fileId), String(input.content));
      return { ok: true };
    }

    case 'set_theme': {
      if (input.mode === 'dark' || input.mode === 'light') settings.mode = input.mode;
      if (typeof input.accent === 'string') settings.accent = input.accent;
      if (typeof input.wallpaperId === 'string' && wallpapers.some((w) => w.id === input.wallpaperId))
        settings.wallpaperId = input.wallpaperId;
      if (typeof input.radius === 'number') settings.radius = input.radius;
      if (typeof input.blur === 'number') settings.blur = input.blur;
      return { ok: true };
    }

    default:
      return { error: '未知工具：' + name };
  }
}

// 开发期把工具执行挂到 window，方便不接 LLM 也能验证「AI→系统」这条链路
if (import.meta.env.DEV) {
  (globalThis as unknown as { __qzExec: typeof executeTool }).__qzExec = executeTool;
}
