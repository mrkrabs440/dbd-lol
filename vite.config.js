// ===========================================================================
// Vite 설정 파일 (선택적 클라이언트 빌드 도구)
// ---------------------------------------------------------------------------
// 기본 구동 방식(`npm start`)은 Express 가 public/ 정적 파일을 그대로 서빙하며
// index.html 의 importmap(CDN)을 통해 Three.js 를 로드합니다. 즉 빌드 없이도
// 즉시 실행이 가능합니다.
//
// 이 vite.config.js 는 "선택적" 프로덕션 번들링/개발 서버 용도입니다.
//   - npm run client:dev   : HMR 개발 서버(5173) + 백엔드(3000) 프록시
//   - npm run client:build : public/ 자원을 dist/ 로 번들링
// ===========================================================================
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // 클라이언트 정적 자원의 루트 디렉토리
  root: 'public',

  // 빌드 산출물 위치 (프로젝트 루트 기준)
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'public/index.html'),
      },
    },
  },

  // 개발 서버 설정: API / WebSocket 을 백엔드(3000)로 프록시
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
