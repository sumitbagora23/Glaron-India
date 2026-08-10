// ────────────────────────────────────────────────────────────────────────────
// Auto-bump the AGENT app version on deploy.
//
// Increments the PATCH of APP_VERSION in agent-app/src/app/version.ts and
// mirrors it into agent-app/ngsw-config.json's appData.version, so the
// installed agent PWA's update prompt always announces a new, higher version.
//
// The agent app versions independently of the dealer PWA and the admin console
// — see scripts/gen-version.mjs and scripts/gen-version-admin.mjs.
//
// Run via `npm run version:bump:agent` (also runs inside `npm run deploy:agent`).
// ────────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versionFile = path.join(root, 'agent-app', 'src', 'app', 'version.ts');
const ngswFile = path.join(root, 'agent-app', 'ngsw-config.json');

const src = fs.readFileSync(versionFile, 'utf8');
const m = src.match(/APP_VERSION\s*=\s*['"](\d+)\.(\d+)\.(\d+)['"]/);
if (!m) {
  console.error('gen-version-agent: could not find APP_VERSION in agent-app/src/app/version.ts');
  process.exit(1);
}
const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
const next = `${major}.${minor}.${patch + 1}`;

fs.writeFileSync(
  versionFile,
  src.replace(/APP_VERSION\s*=\s*['"][\d.]+['"]/, `APP_VERSION = '${next}'`)
);

const ngsw = JSON.parse(fs.readFileSync(ngswFile, 'utf8'));
ngsw.appData = { ...(ngsw.appData || {}), version: next };
fs.writeFileSync(ngswFile, JSON.stringify(ngsw, null, 2) + '\n');

console.log(`gen-version-agent: bumped ${m[1]}.${m[2]}.${m[3]} -> ${next}`);
