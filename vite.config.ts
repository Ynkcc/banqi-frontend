import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import react from '@vitejs/plugin-react';

// 多页面构建：
//   index.html     -> Vue 棋盘界面 (src/main.ts)
//   scheduler.html -> React 调度后台 (src/scheduler/main.tsx)
export default defineConfig({
  plugins: [react(), vue()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // scheduler 后台 API（原 webui 开发代理，指向 banqi-scheduler 服务）
      '/api': 'http://127.0.0.1:9536',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        scheduler: 'scheduler.html',
      },
    },
  },
});
