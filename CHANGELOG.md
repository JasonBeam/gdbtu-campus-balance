# Changelog

All notable changes are documented here using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/); 0.x releases are experimental.

## [0.2.0-candidate8] - 2026-10-30

### Added

- Added an experimental Scriptable flow for school login, dorm selection and balance display in one page.
- Added explicit meter selection and local configuration export.

### Fixed

- Preserve previous values on failed reads and isolate cached balances by account and meter.
- Preserve existing configuration when setup is cancelled.

The complete candidate8 flow has not yet been verified on an iPhone. The school portal may still show “Errors Logged”.

## [0.1.0] - 2026-10-16

### Added
- Added a standalone Scriptable widget for campus-card and dormitory-electricity balances.
- Added a local Python dashboard, private balance history, configuration examples and session-export tools.
- Added versioned Release downloads, SHA-256 checksums, a release workflow and contributor guidance.

[0.1.0]: https://github.com/JasonBeam/gdbtu-campus-balance/releases/tag/v0.1.0
