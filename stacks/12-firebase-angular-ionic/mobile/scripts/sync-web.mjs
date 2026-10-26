// Copies the built Angular web app (../web/dist/stack12-web/browser) into the
// Capacitor web dir (./www). Run after `npm run build:web` and before `cap sync`.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(here, "..");
const stackRoot = resolve(mobileRoot, "..");

const candidates = [
  join(stackRoot, "web", "dist", "stack12-web", "browser"),
  join(stackRoot, "web", "dist", "stack12-web"),
];
const src = candidates.find((p) => existsSync(p));
const dest = join(mobileRoot, "www");

if (!src) {
  console.error(
    `[sync-web] no built web app found. Build first: (cd ../web && npm run build). Looked in:\n  ${candidates.join("\n  ")}`
  );
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`[sync-web] copied ${src} -> ${dest}`);
