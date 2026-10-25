// Copies the built Vue web app (../web/dist) into the Capacitor web dir (./www).
// Run after `npm run build:web` and before `cap sync`.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(here, "..");
const stackRoot = resolve(mobileRoot, "..");

const src = join(stackRoot, "web", "dist");
const dest = join(mobileRoot, "www");

if (!existsSync(src)) {
  console.error(
    `[sync-web] ${src} not found. Build the web app first: (cd ../web && npm run build) or run 'npm run build:web' here.`
  );
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`[sync-web] copied ${src} -> ${dest}`);
