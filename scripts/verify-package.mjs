import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";

const repo = path.resolve(import.meta.dirname, "..");
const { version } = JSON.parse(
  await fs.readFile(path.join(repo, "package.json"), "utf8"),
);
const root = "automatic-twitch-manifest-v3";
const filename = `${root}-${version}.zip`;
const archive = await fs.readFile(path.join(repo, "dist", filename));
const checksum = (
  await fs.readFile(path.join(repo, "dist", `${filename}.sha256`), "utf8")
).split(/\s/)[0];
assert.equal(createHash("sha256").update(archive).digest("hex"), checksum);
const entries = unzipSync(archive);
const manifest = JSON.parse(
  new TextDecoder().decode(entries[`${root}/manifest.json`]),
);
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, version);
assert.equal(manifest.name, "Automatic Twitch (Manifest V3)");
const extraction = path.join(repo, "test-results/release");
await fs.rm(extraction, { recursive: true, force: true });
for (const [name, data] of Object.entries(entries)) {
  assert.ok(
    name.startsWith(`${root}/`) && !name.split("/").includes(".."),
    name,
  );
  assert.doesNotMatch(
    name,
    /(?:^|\/)(?:node_modules|vendor|\.git|_metadata)(?:\/|$)/,
  );
  const file = path.join(extraction, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
  const relative = name.slice(root.length + 1);
  const expected = ["LICENSE", "THIRD_PARTY_NOTICES.md"].includes(relative)
    ? path.join(repo, relative)
    : path.join(repo, "build/extension", relative);
  assert.deepEqual(Buffer.from(data), await fs.readFile(expected), relative);
}
for (const file of [
  manifest.background.service_worker,
  manifest.action.default_popup,
  ...manifest.content_scripts.flatMap((script) => [
    ...(script.js || []),
    ...(script.css || []),
  ]),
]) {
  assert.ok(entries[`${root}/${file}`], file);
}
console.log(`Verified installable release: ${filename}`);
console.log(`Extracted extension: ${path.join(extraction, root)}`);
