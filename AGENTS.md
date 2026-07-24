# AGENTS.md — QieZiOS

> 本文件为 AI 协作规范,所有 Agent 在本仓库工作时必须遵守。

---

## 一、项目概述

- **定位**: 茄子 OS,桌面 OS 模拟器,Live2D + 系统模拟
- **版本**: 主分支持续迭代
- **技术栈**: Node.js + Svelte + Vite + TypeScript
- **核心能力**:
  - 桌面环境模拟 (窗口/任务栏/应用切换)
  - Live2D 角色展示与交互
  - 模拟系统应用
- **部署位置**: 本地开发

---

## 二、项目结构

```
QieZiOS/
├── src/
│   ├── main.ts             # 入口
│   ├── App.svelte
│   ├── lib/
│   │   ├── components/      # Svelte 组件 (图标统一 lucide-svelte)
│   │   ├── stores/         # Svelte stores (状态)
│   │   ├── system/          # OS 模拟核心 (窗口管理/进程)
│   │   ├── apps/            # 模拟应用
│   │   └── live2d/          # Live2D 集成
│   ├── assets/
│   └── app.css
├── public/
│   └── models/             # Live2D 模型 (可选)
├── tests/
├── index.html
├── package.json            # pnpm
├── tsconfig.json
├── svelte.config.js
├── vite.config.ts
└── AGENTS.md
```

---

## 三、开发命令

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
```

---

## 四、代码规范

- TypeScript `strict: true`,禁止 `any`
- Svelte 组件优先函数式 store (`svelte/store`)
- 窗口管理逻辑集中 `lib/system/`,组件只负责渲染
- Live2D 集成隔离在 `lib/live2d/`,不污染系统层
- 图标统一使用 `lucide-svelte` (Svelte 版 Lucide)

---

## 五、测试策略

| 层 | 工具 | 命令 | 重点 |
|---|---|---|---|
| 单元 | vitest | `pnpm test` | 窗口管理、状态流转 |
| 组件 | @testing-library/svelte | `pnpm test` | 关键 UI 交互 |

- 窗口管理器 (创建/聚焦/最小化/关闭) 必须有完整测试
- Live2D 模型加载失败需有兜底

---

## 六、集群依赖

> 完整集群拓扑详见 `/Users/wangzhenyu/Desktop/ALLProject/.设备说明.md`

- **Live2D 模型**: 可选,本地或 NAS (`192.168.71.7`) 获取
- **spark01 vLLM**: 可选,角色对话能力可调用 `http://192.168.71.82:8000/v1/chat/completions`
- 不依赖 EXO/ComfyUI

调用 vLLM 时须设置超时与降级,失败时返回本地兜底文案。

---

## 七、提交规范

- **不主动提交**: 用户未明确要求时不执行 `git commit`/`git push`
- **Conventional Commits**:
  - `feat(system): add window snapping`
  - `fix(live2d): handle model load failure`
  - `docs: update AGENTS.md`
- 范围优先: `system` / `live2d` / `apps` / `ui` / `docs`

---

## 八、项目隔离纪律

- **禁止跨项目修改**: 不得修改 `LUVU/`、`DRT-BOT/` 等其他 Live2D/Electron 项目源码
- **依赖独立**: 仅在 `package.json` 声明
- **模型隔离**: Live2D 模型路径通过配置注入,不硬编码

---

## 九、图标规范

- **统一使用 Lucide** (Svelte 版 `lucide-svelte`),禁止 emoji、禁止其他图标库
- 按需引入: `import { Window, Power, Wifi } from 'lucide-svelte'`
- 已存在的 emoji 必须在下次重构时替换

---

## 十、Agent 行为底线

1. 改动前先读相关文件,理解 OS 模拟架构
2. 不创建未要求的文件/文档
3. 测试失败不重复同一修复路径
4. 完成后给出简明报告
