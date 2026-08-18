#!/usr/bin/env node

import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import {
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const ABSENT = Symbol('absent');
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const FORK_FIELDS = [
  'bugs',
  'description',
  'exports',
  'files',
  'homepage',
  'main',
  'module',
  'name',
  'prettier',
  'repository',
  'type',
  'types',
];
const MERGED_MAP_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'scripts',
];
const UPSTREAM_METADATA_FIELDS = [
  'author',
  'directories',
  'funding',
  'keywords',
  'license',
  'sideEffects',
];
const ALLOWED_UPSTREAM_FIELDS = new Set([
  ...FORK_FIELDS,
  ...MERGED_MAP_FIELDS,
  ...UPSTREAM_METADATA_FIELDS,
  'version',
]);

const parseStableVersion = (version, label) => {
  const match = STABLE_VERSION.exec(version);
  if (!match) throw new Error(`${label} must be a stable semver: ${version}`);

  return match.slice(1).map(Number);
};

const compareVersions = (left, right) => {
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }

  return 0;
};

/**
 * Mirror the kind of upstream change in the downstream version. This keeps the
 * independent package version meaningful without pretending it shares
 * upstream's release history.
 * @param {object} versions - Current and next package versions.
 * @param {string} versions.currentDownstream - Published wllama64 version.
 * @param {string} versions.currentUpstream - Current Wllama baseline.
 * @param {string} versions.nextUpstream - New stable Wllama release.
 * @returns {string} Next wllama64 version.
 */
export const nextDownstreamVersion = ({
  currentDownstream,
  currentUpstream,
  nextUpstream,
}) => {
  const downstream = parseStableVersion(
    currentDownstream,
    'Current downstream version'
  );
  const previous = parseStableVersion(currentUpstream, 'Current upstream version');
  const next = parseStableVersion(nextUpstream, 'Next upstream version');

  if (compareVersions(next, previous) <= 0) {
    throw new Error(
      `Next upstream version ${nextUpstream} must be newer than ${currentUpstream}`
    );
  }

  if (next[0] !== previous[0]) return `${downstream[0] + 1}.0.0`;
  if (next[1] !== previous[1]) return `${downstream[0]}.${downstream[1] + 1}.0`;

  return `${downstream[0]}.${downstream[1]}.${downstream[2] + 1}`;
};

const hasOwn = (object, key) => Object.hasOwn(object ?? {}, key);

/**
 * Three-way merge package maps. Independent fork changes win when upstream did
 * not touch the same key; upstream changes win when the fork left the key alone.
 * Concurrent edits fail instead of silently shipping an unreviewed compromise.
 * @param {object} maps - Previous, fork, and next upstream package maps.
 * @returns {object} Safely merged package map.
 */
export const mergePackageMap = ({ fork, label, previous, upstream }) => {
  const result = {};
  const conflicts = [];
  const keys = new Set([
    ...Object.keys(previous ?? {}),
    ...Object.keys(fork ?? {}),
    ...Object.keys(upstream ?? {}),
  ]);

  for (const key of [...keys].sort()) {
    const previousValue = hasOwn(previous, key) ? previous[key] : ABSENT;
    const forkValue = hasOwn(fork, key) ? fork[key] : ABSENT;
    const upstreamValue = hasOwn(upstream, key) ? upstream[key] : ABSENT;
    const forkChanged = !isDeepStrictEqual(forkValue, previousValue);
    const upstreamChanged = !isDeepStrictEqual(upstreamValue, previousValue);

    let selected;
    if (!forkChanged) selected = upstreamValue;
    else if (!upstreamChanged || isDeepStrictEqual(forkValue, upstreamValue)) {
      selected = forkValue;
    } else {
      conflicts.push(`${label}.${key}`);
      continue;
    }

    if (selected !== ABSENT) result[key] = selected;
  }

  if (conflicts.length > 0) {
    throw new Error(`Concurrent package changes require review: ${conflicts.join(', ')}`);
  }

  return result;
};

const copyFields = (target, source, fields) => {
  for (const field of fields) {
    if (hasOwn(source, field)) target[field] = source[field];
    else delete target[field];
  }
};

/**
 * Combine the next upstream manifest with the fork's distribution contract.
 * @param {object} packages - Package manifests and pinned upstream commit.
 * @returns {object} Prepared wllama64 package manifest.
 */
export const buildReleasePackage = ({
  forkPackage,
  nextUpstreamPackage,
  previousUpstreamPackage,
  upstreamCommit,
}) => {
  const version = nextDownstreamVersion({
    currentDownstream: forkPackage.version,
    currentUpstream: forkPackage.wllama64.upstreamVersion,
    nextUpstream: nextUpstreamPackage.version,
  });
  const unsupported = Object.keys(nextUpstreamPackage).filter(
    (field) => !ALLOWED_UPSTREAM_FIELDS.has(field)
  );
  if (unsupported.length > 0) {
    throw new Error(
      `Unsupported upstream package fields require review: ${unsupported.join(', ')}`
    );
  }

  const result = {};

  // Metadata is copied from a narrow allowlist. Fields that change install or
  // publish behavior (for example private, publishConfig, engines, os, or cpu)
  // stop the automated release and require explicit review.
  copyFields(result, nextUpstreamPackage, UPSTREAM_METADATA_FIELDS);

  // These fields define the downstream distribution contract. Upstream source,
  // dependencies, and unchanged scripts still flow through from the new tag.
  copyFields(result, forkPackage, FORK_FIELDS);

  for (const field of MERGED_MAP_FIELDS) {
    result[field] = mergePackageMap({
      previous: previousUpstreamPackage[field],
      fork: forkPackage[field],
      upstream: nextUpstreamPackage[field],
      label: field,
    });

    if (Object.keys(result[field]).length === 0) delete result[field];
  }

  result.version = version;
  result.wllama64 = {
    ...forkPackage.wllama64,
    upstreamVersion: nextUpstreamPackage.version,
    upstreamCommit,
    compatVersion: nextUpstreamPackage.version,
  };

  return result;
};

const replaceExactlyOnce = (content, pattern, replacement, label) => {
  const matches = content.match(pattern);
  if (!matches || matches.length !== 1) {
    throw new Error(`Expected exactly one ${label}; found ${matches?.length ?? 0}`);
  }

  return content.replace(pattern, replacement);
};

const writeJson = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const updateReleaseDocs = ({ root, upstreamCommit, upstreamVersion, version }) => {
  const shortCommit = upstreamCommit.slice(0, 8);
  const commitUrl = `https://github.com/ngxson/wllama/commit/${upstreamCommit}`;
  const readmePath = join(root, 'README.md');
  const developmentPath = join(root, 'README-dev.md');
  const changelogPath = join(root, 'CHANGELOG.md');

  let readme = readFileSync(readmePath, 'utf8');
  readme = replaceExactlyOnce(
    readme,
    /Current release: `[^`]+`, based on upstream Wllama `[^`]+`\n\(\[`[0-9a-f]+`\]\(https:\/\/github\.com\/ngxson\/wllama\/commit\/[0-9a-f]+\)\)\./g,
    `Current release: \`${version}\`, based on upstream Wllama \`${upstreamVersion}\`\n([\`${shortCommit}\`](${commitUrl})).`,
    'README release baseline'
  );
  readme = replaceExactlyOnce(
    readme,
    /The current baseline is Wllama `[^`]+` at `[0-9a-f]+`\./g,
    `The current baseline is Wllama \`${upstreamVersion}\` at \`${shortCommit}\`.`,
    'README upstream tracking baseline'
  );
  writeFileSync(readmePath, readme);

  let development = readFileSync(developmentPath, 'utf8');
  development = replaceExactlyOnce(
    development,
    /Release `[^`]+` is based on upstream Wllama `[^`]+`\n\(\[`[0-9a-f]+`\]\(https:\/\/github\.com\/ngxson\/wllama\/commit\/[0-9a-f]+\)\)\./g,
    `Release \`${version}\` is based on upstream Wllama \`${upstreamVersion}\`\n([\`${shortCommit}\`](${commitUrl})).`,
    'development guide release baseline'
  );
  writeFileSync(developmentPath, development);

  let changelog = readFileSync(changelogPath, 'utf8');
  const heading = `## [${version}]`;
  if (!changelog.includes(heading)) {
    const date = new Date().toISOString().slice(0, 10);
    const entry = [
      heading + ` - ${date}`,
      '',
      '### Changed',
      '',
      `- Sync upstream Wllama ${upstreamVersion} at [\`${shortCommit}\`](${commitUrl}).`,
      '- Rebuild and verify the Memory64 and wasm32 compatibility artifacts.',
      '',
    ].join('\n');
    const firstRelease = /^## \[(?!Unreleased\])/m.exec(changelog);
    const insertionPoint = firstRelease?.index ?? '# Changelog\n'.length;
    const before = changelog.slice(0, insertionPoint).trimEnd();
    const after = changelog.slice(insertionPoint).trimStart();
    changelog = `${before}\n\n${entry}${after}`;
    writeFileSync(changelogPath, changelog);
  }
};

/**
 * Prepare package identity, examples, and release documentation in a worktree.
 * @param {object} paths - Manifest paths, repository root, and upstream commit.
 * @returns {object} Prepared wllama64 package manifest.
 */
export const prepareWorkspace = ({
  forkPackagePath,
  nextUpstreamPackagePath,
  previousUpstreamPackagePath,
  root,
  upstreamCommit,
}) => {
  const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
  const forkPackage = readJson(forkPackagePath);
  const nextUpstreamPackage = readJson(nextUpstreamPackagePath);
  const previousUpstreamPackage = readJson(previousUpstreamPackagePath);
  const releasePackage = buildReleasePackage({
    forkPackage,
    nextUpstreamPackage,
    previousUpstreamPackage,
    upstreamCommit,
  });

  writeJson(join(root, 'package.json'), releasePackage);

  const examplePath = join(root, 'examples/main/package.json');
  const examplePackage = readJson(examplePath);
  examplePackage.devDependencies.wllama64 = 'file:../../';
  examplePackage.devDependencies[releasePackage.wllama64.compatPackage] =
    releasePackage.wllama64.compatVersion;
  writeJson(examplePath, examplePackage);

  updateReleaseDocs({
    root,
    upstreamCommit,
    upstreamVersion: releasePackage.wllama64.upstreamVersion,
    version: releasePackage.version,
  });

  return releasePackage;
};

const parseArguments = (arguments_) => {
  const options = {};

  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument: ${key}`);
    options[key.slice(2)] = value;
  }

  for (const required of [
    'fork-package',
    'next-upstream-package',
    'previous-upstream-package',
    'upstream-commit',
  ]) {
    if (!options[required]) throw new Error(`Missing --${required}`);
  }

  return options;
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const options = parseArguments(process.argv.slice(2));
  const releasePackage = prepareWorkspace({
    root: process.cwd(),
    forkPackagePath: resolve(options['fork-package']),
    nextUpstreamPackagePath: resolve(options['next-upstream-package']),
    previousUpstreamPackagePath: resolve(options['previous-upstream-package']),
    upstreamCommit: options['upstream-commit'],
  });

  console.log(
    `Prepared ${releasePackage.name}@${releasePackage.version} from upstream ${releasePackage.wllama64.upstreamVersion}`
  );
}
