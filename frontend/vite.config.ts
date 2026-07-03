import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
    // polling avoids Linux inotify watcher-limit (ENOSPC) crashes;
    // raise fs.inotify.max_user_watches to use native watching instead
    watch: {
      usePolling: true,
    },
  },
})
