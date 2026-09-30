import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";

const root = path.resolve(import.meta.dirname, "../build/extension");
async function files(dir) {
  return (
    await Promise.all(
      (await fs.readdir(dir, { withFileTypes: true })).map((entry) =>
        entry.isDirectory()
          ? files(path.join(dir, entry.name))
          : path.join(dir, entry.name),
      ),
    )
  ).flat();
}
test("generated extension has valid MV3 entry points and local-only executable code", async () => {
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, "manifest.json")),
  );
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.key, undefined);
  assert.equal(manifest.update_url, undefined);
  assert.equal(manifest.browser_action, undefined);
  for (const entry of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((item) => [
      ...(item.js || []),
      ...(item.css || []),
    ]),
  ]) {
    await fs.access(path.join(root, entry));
  }
  for (const file of await files(root)) {
    const source = await fs.readFile(file, "utf8");
    if (file.endsWith(".html"))
      assert.doesNotMatch(source, /<script[^>]*src=["']https?:/i, file);
    if (file.endsWith(".js")) {
      parse(source, { ecmaVersion: "latest" });
      assert.doesNotMatch(
        source,
        /getBackgroundPage|browserAction|tabs\.executeScript|getExtensionTabs/,
        file,
      );
    }
  }
});
