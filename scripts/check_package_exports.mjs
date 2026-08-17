#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(
  readFileSync(join(projectRoot, 'package.json'), 'utf8')
);
const installDir = mkdtempSync(join(tmpdir(), 'wllama64-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: installDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_loglevel: 'error',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options,
  });

try {
  const pack = JSON.parse(
    execFileSync(
      npm,
      ['pack', '--json', '--pack-destination', installDir],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...process.env, npm_config_loglevel: 'error' },
      }
    )
  )[0];
  const tarball = join(installDir, pack.filename);

  statSync(tarball);
  run(npm, ['install', '--ignore-scripts', tarball]);

  const installedPackage = join(
    installDir,
    'node_modules',
    packageJson.name
  );
  for (const path of [
    packageJson.main,
    packageJson.module,
    packageJson.types,
    'esm/wasm/wllama.wasm',
  ]) {
    statSync(join(installedPackage, path));
  }

  const expectedCDN = `${packageJson.name}@${packageJson.version}/esm/wasm/wllama.wasm`;
  const compatVersion = packageJson.wllama64.compatVersion;

  run('node', [
    '--input-type=module',
    '--eval',
    `
      import { statSync } from 'node:fs';
      import { Wllama, WasmFromCDN, WasmCompatFromCDN } from 'wllama64';
      import packageJson from 'wllama64/package.json' with { type: 'json' };

      if (typeof Wllama !== 'function') throw new Error('Missing ESM Wllama export');
      if (!WasmFromCDN.default.includes(${JSON.stringify(expectedCDN)})) {
        throw new Error('Default CDN URL does not target this package');
      }
      if (!WasmCompatFromCDN.wasm.includes('@wllama/wllama-compat@${compatVersion}/')) {
        throw new Error('Compat CDN URL is not pinned to the upstream version');
      }
      if (packageJson.name !== ${JSON.stringify(packageJson.name)}) {
        throw new Error('Exported package metadata has the wrong name');
      }

      statSync(new URL(import.meta.resolve('wllama64/wasm/wllama.wasm')));
    `,
  ]);

  run('node', [
    '--eval',
    `
      const { statSync } = require('node:fs');
      const { Wllama, WasmFromCDN } = require('wllama64');
      const packageJson = require('wllama64/package.json');

      if (typeof Wllama !== 'function') throw new Error('Missing CJS Wllama export');
      if (!WasmFromCDN.default) throw new Error('Missing CJS CDN export');
      if (packageJson.name !== ${JSON.stringify(packageJson.name)}) {
        throw new Error('CJS package metadata has the wrong name');
      }

      statSync(require.resolve('wllama64/wasm/wllama.wasm'));
    `,
  ]);

  console.log(
    `Package exports passed for ${packageJson.name}@${packageJson.version}`
  );
} finally {
  rmSync(installDir, { recursive: true, force: true });
}
