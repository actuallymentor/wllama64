import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/publish-npm.yml', import.meta.url),
  'utf8'
);
const publishStep = workflow
  .split('      - name: Inspect and publish without lifecycle scripts\n')[1]
  .split('\n  release:')[0];
const publishScript = publishStep
  .split('        run: |\n')[1]
  .split('\n')
  .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
  .join('\n');

test('publish and recovery validators accept only the reviewed downloader override', () => {
  const validators = [
    ...workflow.matchAll(
      /PACKAGE_MANIFEST="\$package_manifest" node --input-type=module <<'NODE'\n([\s\S]*?)          NODE/g
    ),
  ];
  assert.equal(validators.length, 2);
  const approvedOverrides = {
    '@wdio/utils': { '@puppeteer/browsers': '3.2.3' },
  };
  const manifest = { name: 'wllama64', version: '0.0.0-test' };
  for (const [, script] of validators) {
    for (const overrides of [
      undefined,
      approvedOverrides,
      null,
      {},
      { 'extract-zip': 'npm:other-package@1' },
      { '@wdio/utils': { '@puppeteer/browsers': '3.2.4' } },
      { ...approvedOverrides, extra: '1' },
    ]) {
      const result = spawnSync(
        process.execPath,
        ['--input-type=module', '--eval', script],
        {
          encoding: 'utf8',
          timeout: 10_000,
          env: {
            PACKAGE_MANIFEST: JSON.stringify({
              ...manifest,
              ...(overrides === undefined ? {} : { overrides }),
            }),
            RELEASE_VERSION: manifest.version,
          },
        }
      );
      if (overrides === undefined || overrides === approvedOverrides) {
        assert.equal(result.status, 0, result.stderr);
      } else {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /overrides require review/);
      }
    }
  }
});

test('isolated publish step treats downloaded artifact as a local npm tarball', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wllama-publish-'));
  try {
    mkdirSync(join(directory, 'package'));
    mkdirSync(join(directory, 'release-artifact'));
    writeFileSync(
      join(directory, 'package/package.json'),
      JSON.stringify({
        name: 'wllama64',
        version: '0.0.0-test',
        overrides: { '@wdio/utils': { '@puppeteer/browsers': '3.2.3' } },
      })
    );
    execFileSync(
      'tar',
      ['-czf', 'release-artifact/wllama64-0.0.0-test.tgz', 'package'],
      { cwd: directory }
    );

    // Execute the production shell with npm's real argument parser, without publishing.
    const script = publishScript.replace(
      '--provenance \\',
      '--dry-run --provenance=false --json \\'
    );
    assert.notEqual(
      script,
      publishScript,
      'Publish command must be converted to a dry run'
    );
    const env = {
      PATH: process.env.PATH,
      HOME: directory,
      DIST_TAG: 'next',
      RELEASE_VERSION: '0.0.0-test',
      NPM_CONFIG_USERCONFIG: '/dev/null',
      NPM_CONFIG_CACHE: join(directory, 'npm-cache'),
      NPM_CONFIG_FETCH_RETRIES: '0',
      NPM_CONFIG_FETCH_TIMEOUT: '1000',
      NPM_CONFIG_REGISTRY: 'http://127.0.0.1:1',
    };
    const result = spawnSync('bash', ['-c', script], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 30_000,
      env,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /wllama64@0\.0\.0-test/);
    assert.match(result.stderr, /dry.run/i);

    const rejected = spawnSync('bash', ['-c', script], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...env, RELEASE_VERSION: '0.0.1' },
    });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Unexpected tarball identity/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('all release paths test installed tarball inference without publish credentials', () => {
  const gates = readFileSync(
    new URL('../.github/workflows/release-gates.yml', import.meta.url),
    'utf8'
  );
  assert.match(gates, /npm run test:package/);
  const build = workflow.split('\n  build:')[1].split('\n  publish:')[0];
  assert.match(
    build,
    /WLLAMA_PACKAGE_SPEC: \$\{\{ github.workspace \}\}\/\$\{\{ steps.pack.outputs.tarball \}\}/
  );
  assert.match(
    build,
    /Pack and inspect publish artifact[\s\S]*Run inference from the exact publish tarball[\s\S]*npm run test:package[\s\S]*Upload exact npm tarball/
  );
  assert.doesNotMatch(build, /id-token: write|secrets\./);
  assert.doesNotMatch(
    workflow.split('\n  publish:')[1].split('\n  release:')[0],
    /actions\/checkout/
  );
});
