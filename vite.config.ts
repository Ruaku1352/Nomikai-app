import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// 開発時は Firebase Emulator（functions）に /api をプロキシする。
// 本番は Firebase Hosting の rewrites で /api/** を Functions に流す想定（firebase.json 参照）。
const API_PROXY_TARGET =
  process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:5001';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'icon.svg',
        'icon-maskable.svg',
        'apple-touch-icon.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-maskable-512.png',
      ],
      manifest: {
        name: '飲み会集合場所決め',
        short_name: '飲み会マップ',
        description:
          'メンバーの最寄駅から、みんなが集まりやすい駅とお店を提案するアプリ',
        lang: 'ja',
        // アイコンの背景（藍色）と揃える
        theme_color: '#16233D',
        background_color: '#16233D',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // Places API の結果は長期キャッシュ禁止のため API レスポンスはキャッシュしない。
        // 直前の結果は localStorage(zustand persist) 側で保持してオフライン閲覧する。
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/maps\.googleapis\.com\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
        // Emulator の Functions は /<project>/<region>/api 配下に生える
        rewrite: (path) =>
          process.env.VITE_FUNCTIONS_EMULATOR_PREFIX
            ? `${process.env.VITE_FUNCTIONS_EMULATOR_PREFIX}${path}`
            : path,
      },
    },
  },
});
