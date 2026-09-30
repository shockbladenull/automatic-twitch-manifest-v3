import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";

const repo = path.resolve(import.meta.dirname, "..");
const source = path.join(repo, "build/extension");
const output = path.join(repo, "dist");
const manifest = JSON.parse(
  await fs.readFile(path.join(source, "manifest.json"), "utf8"),
);
const { version } = JSON.parse(
  await fs.readFile(path.join(repo, "package.json"), "utf8"),
);
if (manifest.version !== version || manifest.manifest_version !== 3)
  throw new Error("Rebuild the extension before packaging.");
if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== `v${version}`)
  throw new Error("Release tag does not match package version.");
const root = "automatic-twitch-manifest-v3";
const entries = {};
const timestamp = new Date("2026-01-01T00:00:00Z");
async function collect(directory) {
  for (const entry of (
    await fs.readdir(directory, { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(file);
    else if (entry.isFile())
      entries[
        `${root}/${path.relative(source, file).split(path.sep).join("/")}`
      ] = [new Uint8Array(await fs.readFile(file)), { mtime: timestamp }];
    else throw new Error(`Unexpected filesystem entry: ${file}`);
  }
}
await collect(source);
for (const filename of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
  entries[`${root}/${filename}`] = [
    new Uint8Array(await fs.readFile(path.join(repo, filename))),
    { mtime: timestamp },
  ];
}
const filename = `${root}-${version}.zip`;
const archive = zipSync(entries, { level: 9 });
const sha256 = createHash("sha256").update(archive).digest("hex");
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, filename), archive);
await fs.writeFile(
  path.join(output, `${filename}.sha256`),
  `${sha256}  ${filename}\n`,
);
console.log(`Release package: ${path.join(output, filename)}`);
