import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { hunyuanMiddleware } from './server/hunyuan.mjs'

/** 开发环境挂上混元 API 中转（生产用 node server/index.mjs） */
function hunyuanApi({ mock = false } = {}) {
  return {
    name: 'hunyuan-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => hunyuanMiddleware(req, res, next, { mock }))
    }
  }
}

export default defineConfig(({ mode }) => ({
  // `vite --mode mock` = 前端照常跑，混元接口用本地假任务，便于没有 Key 时走通全流程
  plugins: [vue(), hunyuanApi({ mock: mode === 'mock' })],
  server: {
    port: mode === 'mock' ? 5184 : 5183,
    host: '127.0.0.1',
    strictPort: true,
    watch: {
      // 编辑器/工具写入时的临时目录会让 Windows 文件监听报 EBUSY
      ignored: ['**/*.tmp', '**/*.tmpdir/**', '**/.*.tmpdir/**', '**/.DS_Store']
    }
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000
  }
}))
