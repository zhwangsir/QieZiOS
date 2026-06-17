import { defineConfig, loadEnv } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // AI 网关同源代理：浏览器请求 /aiproxy/... → dev server 转发到上游网关。
  // 为什么要代理：浏览器直连第三方网关受 CORS 限制（网关没发 ACAO 头会被拦）；
  // 服务器到服务器没有 CORS，于是让 Vite 当中间人。流式 SSE 也能原样透传。
  // 生产环境需由真正的反向代理（未来的 Node 后端 / nginx）提供同样的 /aiproxy 路径。
  const target = env.VITE_AI_PROXY_TARGET || 'https://dgmt.top'
  return {
    plugins: [svelte(), tailwindcss()],
    server: {
      proxy: {
        '/aiproxy': {
          target,
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/aiproxy/, ''),
        },
      },
    },
  }
})
