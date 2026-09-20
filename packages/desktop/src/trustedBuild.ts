/**
 * Compile-time trusted-downstream invariants.
 *
 * These are real `false` literals, not environment lookups. Trusted production
 * bundles must not be able to re-enable telemetry or the official AionUi
 * update channel by setting a runtime variable.
 */
export const AIONUI_TELEMETRY_ENABLED = false;
export const AIONUI_OFFICIAL_UPDATES_ENABLED = false;

/** GitHub owner/name for this trusted fork's Releases. */
export const AIONUI_GITHUB_REPO = 'KeithCoreDumped/AionUi';
