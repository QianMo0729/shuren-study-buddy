import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = import.meta.dirname;
/** 仓库内不允许开发服务器当作静态文件读出的目录或文件（按绝对路径匹配，不会误伤 shared/data 这类源码目录） */
const sealed = (relative: string) => `${path.resolve(root, relative).split(path.sep).join('/').replace(/[\\$^*+?.()|[\]{}!]/g, '\\$&')}`;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, '');
  const dataDir = path.resolve(root, env.DATA_DIR || 'data');
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      // 默认只监听本机。确实需要让手机等其他设备访问时设置 DEV_LAN=true。
      host: env.DEV_LAN === 'true' ? true : '127.0.0.1',
      // xfwd：把真实来源地址交给 API，API 不会把经代理进来的局域网请求当成本机请求（验证码回显只给本机）
      proxy: { '/api': { target: 'http://127.0.0.1:8787', xfwd: true } },
      fs: {
        // 数据库、上传的图片与本机配置都在仓库目录里，开发服务器不能把它们当静态文件读出来
        deny: [
          '.env', '.env.*', '*.{crt,pem,key}', '**/.git/**',
          '*.{db,db-wal,db-shm,sqlite,sqlite3,sqlite-wal,sqlite-shm}',
          `${sealed(dataDir)}/**`, `${sealed('data')}/**`, `${sealed('uploads')}/**`, `${sealed('deploy')}/**`,
        ],
      },
    },
    build: {
      chunkSizeWarningLimit: 900,
    },
  };
});
