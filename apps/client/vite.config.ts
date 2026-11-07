import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const SERVER = 'mathbattles-server.mathbattles.workers.dev';
const FIREBASE_AUTH_DOMAIN = 'mathbattles-98eee.firebaseapp.com';

/**
 * The content security policy for the built site. Only this site's own scripts run; network
 * calls can go only to the game server and the Google services used for sign-in and (with
 * consent) analytics. GitHub Pages can't send headers, so it goes in a meta tag.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.googletagmanager.com",
  // Inline style attributes come from the UI library and KaTeX; no inline scripts are allowed.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://www.google-analytics.com https://www.googletagmanager.com",
  "font-src 'self' data:",
  `connect-src 'self' https://${SERVER} wss://${SERVER} https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://firebase.googleapis.com https://firebaseinstallations.googleapis.com https://www.google-analytics.com https://region1.google-analytics.com https://*.google-analytics.com`,
  `frame-src https://${FIREBASE_AUTH_DOMAIN} https://accounts.google.com`,
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ');

/**
 * Adds the security policy, and Subresource Integrity hashes to every script and stylesheet the
 * page loads, so a changed file (from a compromised host or cache) is refused by the browser.
 */
function securityTags(): Plugin {
  let outDir = 'dist';
  return {
    name: 'mathbattles-security-tags',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
      },
    },
    // Hashes are taken from the files exactly as written, after every other build step.
    writeBundle() {
      const page = join(outDir, 'index.html');
      const html = readFileSync(page, 'utf8');
      const hashOf = (url: string): string | null => {
        const file = join(outDir, url.replace(/^\.?\//, ''));
        if (!existsSync(file)) return null;
        return `sha384-${createHash('sha384').update(readFileSync(file)).digest('base64')}`;
      };
      const withHash = (tag: string, attr: 'src' | 'href') => {
        const url = tag.match(new RegExp(`${attr}="([^"]+)"`))?.[1];
        const hash = url && hashOf(url);
        if (!hash || tag.includes('integrity=')) return tag;
        const cors = tag.includes('crossorigin') ? '' : ' crossorigin="anonymous"';
        return tag.replace(/\s*\/?>$/, ` integrity="${hash}"${cors}>`);
      };
      const out = html
        .replace(/<script\b[^>]*\bsrc="[^"]+"[^>]*>/g, (tag) => withHash(tag, 'src'))
        .replace(/<link\b[^>]*\brel="(?:stylesheet|modulepreload)"[^>]*>/g, (tag) => withHash(tag, 'href'));
      writeFileSync(page, out);
    },
  };
}

export default defineConfig({
  // Relative paths let the same build work at the site root or under a folder.
  base: './',
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  // Source maps stay out of the published site.
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 900, sourcemap: false },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true },
  plugins: [securityTags()],
});
