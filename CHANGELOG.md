# Changelog

## [Unreleased] - 2026-08-18

### Changed

- Automate guarded stable-tag sync, release gates, and npm trusted publishing.
- Isolate untrusted builds from PAT and npm OIDC credentials.

## [1.0.0] - 2026-08-18

### Changed

- Promote the provenance-attested Memory64 package to its first stable release.

## [1.0.0-rc.2] - 2026-08-18

### Changed

- Verify token-free publishing through the protected GitHub Actions workflow.
- Rebuild release artifacts from clean CMake directories to prevent stale binaries.
- Validate and test fresh Wasm builds semantically when equivalent exception encoding changes their bytes.

## [1.0.0-rc.1] - 2026-08-17

### Added

- Publish `wllama64` as an independent Memory64 fork of Wllama.
- Raise the default Memory64 ceiling to 16 GiB with wasm32 fallback. (dea6519)
- Add real-browser Memory64 stress coverage and demo. (2468371)
- Export `WasmFromCDN` from the package root for zero-config startup.

### Changed

- Base the fork on upstream Wllama 3.6.0 at [`f16050d`](https://github.com/ngxson/wllama/commit/f16050d), retaining parallel request handling and partial-download recovery.
- Pin the wasm32 compatibility fallback to upstream `@wllama/wllama-compat` 3.6.0 rather than publishing a forked compat package.
- Point package, repository, issue, and release documentation to [actuallymentor/wllama64](https://github.com/actuallymentor/wllama64).

### Fixed

- Preserve cross-origin cache recovery. (dcb0eb9)
- Keep large content-addressed cache writes transactional and recover incomplete entries. (225dfe6)
- Clean up failed native model loads so the same instance can retry.
