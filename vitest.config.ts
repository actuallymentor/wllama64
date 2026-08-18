import { playwright } from '@vitest/browser-playwright';
import { webdriverio } from '@vitest/browser-webdriverio';
import { defineConfig } from 'vitest/config';

const SAFARI = process.env.BROWSER === 'safari';
const WEBGPU = process.env.WEBGPU === '1';
const AUTO = process.env.AUTO === '1';
const COMPAT = process.env.COMPAT === '1';
const CI = !!process.env.CI;

const chromeArgsCI = [
  '--disable-gpu',
  '--no-sandbox',
  '--disable-setuid-sandbox',
];
const chromeArgsWebGPU = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--enable-unsafe-webgpu',
  '--enable-features=WebGPU',
];

const browserName = process.env.BROWSER ?? 'chromium';
const browserProvider = SAFARI
  ? webdriverio()
  : playwright({
      launchOptions: {
        args: WEBGPU ? chromeArgsWebGPU : CI ? chromeArgsCI : [],
      },
    });

export default defineConfig({
  define: {
    __GITHUB_CI__: JSON.stringify(!!process.env.GITHUB_ACTIONS),
  },
  test: {
    ...(AUTO ? { watch: false } : {}),
    exclude: [
      '**/node_modules/**',
      '**/esm/**',
      '**/docs/**',
      '**/examples/**',
      ...(!WEBGPU ? ['**/src/*.wgpu.test.*'] : []),
      ...(!COMPAT ? ['**/src/*.compat.test.*'] : []),
    ],
    include: WEBGPU ? ['**/src/*.wgpu.test.*'] : ['**/src/**/*.test.*'],
    browser: {
      enabled: true,
      headless: AUTO || CI,
      provider: browserProvider,
      instances: [{ browser: browserName }],
    },
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
});
