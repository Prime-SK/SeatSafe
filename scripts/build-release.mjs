import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { cp, mkdir, writeFile, readFile } from "node:fs/promises";
const root = fileURLToPath(new URL("../", import.meta.url));
const npm = process.env.npm_execpath;
if (!npm) throw Error("Run the release build through npm.");
for (const project of ["api", "web"]) {
  const result = spawnSync(process.execPath, [npm, "run", "build"], {
    cwd: join(root, project),
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const target = resolve(root, "api/dist/client");
await mkdir(target, { recursive: true });
await cp(join(root, "web/dist/seatsafe-web/browser"), target, {
  recursive: true,
});
let license = process.env.PRIMENG_LICENSE;
if (!license) {
  try {
    const local = JSON.parse(
      await readFile(
        join(root, "web/public/primeui-license.local.json"),
        "utf8",
      ),
    );
    license = local.license;
  } catch {}
}
if (typeof license !== "string" || !license.trim())
  throw Error(
    "PrimeNG licence configuration is required for a release. Supply PRIMENG_LICENSE privately.",
  );
await writeFile(
  join(target, "primeui-license.local.json"),
  JSON.stringify({ license }),
);
console.log(
  "Release built: compiled API and frontend; licence configured without logging its value.",
);
