# Changelog

## [3.6.0] - 2026-08-17

### Added

- Integrate upstream Wllama 3.6.0, including parallel request handling and partial-download recovery.
- Raise the default Memory64 ceiling to 16 GiB with wasm32 fallback. (dea6519)
- Add real-browser Memory64 stress coverage and demo. (2468371)

### Fixed

- Preserve cross-origin cache recovery. (dcb0eb9)
- Keep large content-addressed cache writes transactional and recover incomplete entries. (225dfe6)
