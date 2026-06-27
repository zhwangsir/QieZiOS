import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { hydrateAll } from './kernel/persist.svelte'

// 启动门：先把 IndexedDB 里的大块状态（VFS 等）读回来，再挂载 UI。
// 这样首屏直接是真数据，不会先闪一下种子/默认值。IDB 读通常 <50ms，门控延迟可忽略。
await hydrateAll()

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
