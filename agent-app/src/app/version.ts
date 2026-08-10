// ────────────────────────────────────────────────────────────────────────────
// APP VERSION — single source of truth for the version shown in the agent app
// and in its "new update available" prompt.
//
// Bumped automatically on deploy by scripts/gen-version-agent.mjs, which also
// mirrors the value into agent-app/ngsw-config.json's `appData.version`.
// ────────────────────────────────────────────────────────────────────────────
export const APP_VERSION = '1.0.5';
