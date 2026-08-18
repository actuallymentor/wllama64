import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReleasePackage,
  mergePackageMap,
  nextDownstreamVersion,
} from './prepare_upstream_release.mjs';

test('maps upstream release magnitude to the downstream version', () => {
  const base = {
    currentDownstream: '1.4.7',
    currentUpstream: '3.6.2',
  };

  assert.equal(nextDownstreamVersion({ ...base, nextUpstream: '3.6.3' }), '1.4.8');
  assert.equal(nextDownstreamVersion({ ...base, nextUpstream: '3.7.0' }), '1.5.0');
  assert.equal(nextDownstreamVersion({ ...base, nextUpstream: '4.0.0' }), '2.0.0');
});

test('rejects prereleases and non-forward upstream versions', () => {
  assert.throws(
    () =>
      nextDownstreamVersion({
        currentDownstream: '1.0.0',
        currentUpstream: '3.6.0',
        nextUpstream: '3.7.0-rc.1',
      }),
    /stable semver/
  );
  assert.throws(
    () =>
      nextDownstreamVersion({
        currentDownstream: '1.0.0',
        currentUpstream: '3.6.0',
        nextUpstream: '3.6.0',
      }),
    /must be newer/
  );
});

test('three-way package maps retain independent changes and upstream updates', () => {
  assert.deepEqual(
    mergePackageMap({
      previous: { build: 'old build', test: 'old test' },
      fork: { build: 'memory64 build', test: 'old test', release: 'guarded' },
      upstream: { build: 'old build', test: 'new test', lint: 'new lint' },
      label: 'scripts',
    }),
    {
      build: 'memory64 build',
      lint: 'new lint',
      release: 'guarded',
      test: 'new test',
    }
  );
});

test('three-way package maps reject concurrent edits', () => {
  assert.throws(
    () =>
      mergePackageMap({
        previous: { build: 'old' },
        fork: { build: 'memory64' },
        upstream: { build: 'upstream' },
        label: 'scripts',
      }),
    /scripts\.build/
  );
});

test('release package keeps fork identity and accepts upstream dependencies', () => {
  const forkPackage = {
    name: 'wllama64',
    version: '1.0.0',
    description: 'Memory64 fork',
    main: './esm/index.cjs',
    module: './esm/index.js',
    types: './esm/index.d.ts',
    type: 'module',
    exports: { '.': './esm/index.js' },
    files: ['esm'],
    repository: { url: 'fork' },
    bugs: { url: 'fork/issues' },
    homepage: 'fork',
    scripts: { build: 'upstream build', 'check:wasm': 'memory check' },
    devDependencies: { typescript: '5', prettier: '3' },
    prettier: { semi: true },
    wllama64: {
      upstreamVersion: '3.6.0',
      upstreamCommit: 'old',
      compatPackage: '@wllama/wllama-compat',
      compatVersion: '3.6.0',
    },
  };
  const previousUpstreamPackage = {
    name: '@wllama/wllama',
    version: '3.6.0',
    scripts: { build: 'upstream build' },
    devDependencies: { typescript: '5' },
  };
  const nextUpstreamPackage = {
    name: '@wllama/wllama',
    version: '3.7.0',
    scripts: { build: 'better build' },
    devDependencies: { typescript: '5', vite: '6' },
  };

  const result = buildReleasePackage({
    forkPackage,
    previousUpstreamPackage,
    nextUpstreamPackage,
    upstreamCommit: 'next',
  });

  assert.equal(result.name, 'wllama64');
  assert.equal(result.version, '1.1.0');
  assert.equal(result.scripts.build, 'better build');
  assert.equal(result.scripts['check:wasm'], 'memory check');
  assert.equal(result.devDependencies.vite, '6');
  assert.equal(result.devDependencies.prettier, '3');
  assert.equal(result.wllama64.upstreamVersion, '3.7.0');
  assert.equal(result.wllama64.upstreamCommit, 'next');
  assert.equal(result.wllama64.compatVersion, '3.7.0');
});

test('release package refuses upstream fields that affect publishing', () => {
  const forkPackage = {
    name: 'wllama64',
    version: '1.0.0',
    scripts: {},
    wllama64: {
      upstreamVersion: '3.6.0',
      upstreamCommit: 'old',
      compatPackage: '@wllama/wllama-compat',
      compatVersion: '3.6.0',
    },
  };
  const previousUpstreamPackage = {
    name: '@wllama/wllama',
    version: '3.6.0',
    scripts: {},
  };

  assert.throws(
    () =>
      buildReleasePackage({
        forkPackage,
        previousUpstreamPackage,
        nextUpstreamPackage: {
          ...previousUpstreamPackage,
          version: '3.6.1',
          publishConfig: { registry: 'https://example.invalid' },
        },
        upstreamCommit: 'next',
      }),
    /publishConfig/
  );
});

test('release package refuses automatic lifecycle scripts', () => {
  const forkPackage = {
    name: 'wllama64',
    version: '1.0.0',
    scripts: { build: 'build' },
    wllama64: {
      upstreamVersion: '3.6.0',
      compatPackage: '@wllama/wllama-compat',
    },
  };
  const previousUpstreamPackage = {
    name: '@wllama/wllama',
    version: '3.6.0',
    scripts: { build: 'build' },
  };

  for (const script of ['preinstall', 'postinstall', 'prepack', 'prepare']) {
    assert.throws(
      () =>
        buildReleasePackage({
          forkPackage,
          previousUpstreamPackage,
          nextUpstreamPackage: {
            ...previousUpstreamPackage,
            version: '3.6.1',
            scripts: { build: 'build', [script]: 'unsafe' },
          },
          upstreamCommit: 'next',
        }),
      new RegExp(script)
    );
  }
});

test('release package keeps only the fork example directory', () => {
  const forkPackage = {
    name: 'wllama64',
    version: '1.0.0',
    directories: { example: 'examples' },
    scripts: {},
    wllama64: {
      upstreamVersion: '3.6.0',
      compatPackage: '@wllama/wllama-compat',
    },
  };
  const previousUpstreamPackage = {
    name: '@wllama/wllama',
    version: '3.6.0',
    directories: { example: 'examples' },
    scripts: {},
  };
  const result = buildReleasePackage({
    forkPackage,
    previousUpstreamPackage,
    nextUpstreamPackage: {
      ...previousUpstreamPackage,
      version: '3.6.1',
      directories: { bin: 'bin' },
    },
    upstreamCommit: 'next',
  });

  assert.deepEqual(result.directories, { example: 'examples' });
});
