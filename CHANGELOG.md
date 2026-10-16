# Changelog
All notable changes follow Keep a Changelog.
## [0.1.0] - 2026-10-16
### Added
- Phase 1 scaffold with slash goal plus file state.
- Atomic claim-lock file with stale reclaim plus per-call unique tmp names for single-flight.
- Guarded block and complete transitions returning friendly status messages.
### Fixed
- Parser boundary: /goalie-style prefixes plus bare block plus keyword extras now invalid.
- Full shape validation rejects partial goal state as corrupt.
- handleGoalCommand guards null input plus bad project dir plus corrupt state plus separated save errors.
