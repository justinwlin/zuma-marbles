import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

/** The commit this build came from (shown on the home screen), "-dirty" if built with uncommitted changes. */
function buildSha() {
  const git = (cmd: string) => execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  try {
    return git('rev-parse --short HEAD') + (git('status --porcelain') ? '-dirty' : '');
  } catch {
    return (process.env.GITHUB_SHA ?? 'unknown').slice(0, 7);
  }
}

export default defineConfig({
  base: './',
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  build: { target: 'es2022' },
  define: { __BUILD_SHA__: JSON.stringify(buildSha()), __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Zuma Marbles',
        short_name: 'Zuma',
        description: 'Zuma-style marble shooter with infinite generated levels.',
        start_url: './',
        scope: './',
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'any',
        background_color: '#050a12',
        theme_color: '#07111d',
        categories: ['games'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      // og.png is only for link previews: don't make every player download it.
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'], globIgnores: ['og.png'] },
    }),
  ],
});
