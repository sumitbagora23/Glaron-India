// ────────────────────────────────────────────────────────────────────────────
// Auto-bump the app version on deploy.
//
// Increments the PATCH of APP_VERSION in src/app/version.ts and mirrors it into
// ngsw-config.json's appData.version, so the installed PWA's "Update Required"
// prompt always announces a new, higher version number after each deploy.
//
// Run via `npm run version:bump` (also runs automatically inside `npm run deploy`).
// ────────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versionFile = path.join(root, 'src', 'app', 'version.ts');
const ngswFile = path.join(root, 'ngsw-config.json');

const src = fs.readFileSync(versionFile, 'utf8');
const m = src.match(/APP_VERSION\s*=\s*['"](\d+)\.(\d+)\.(\d+)['"]/);
if (!m) {
  console.error('gen-version: could not find APP_VERSION in version.ts');
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

console.log(`gen-version: bumped ${m[1]}.${m[2]}.${m[3]} -> ${next}`);
