import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { parse } from "acorn";
import * as prettier from "prettier";

const repo = path.resolve(import.meta.dirname, "..");
const bundled = path.join(repo, "vendor/automatic-twitch-1.6.3");
const input = path.resolve(process.argv[2] || bundled);
const output = path.join(repo, "build/extension");
const { version: migratedVersion } = JSON.parse(
  await fs.readFile(path.join(repo, "package.json"), "utf8"),
);
const manifest = JSON.parse(
  await fs.readFile(path.join(input, "manifest.json"), "utf8"),
);
if (manifest.version !== "1.6.3" || manifest.manifest_version !== 2) {
  throw new Error(
    "This migration targets the bundled Automatic Twitch 1.6.3 Manifest V2 source.",
  );
}
if (input === output || input.startsWith(`${output}${path.sep}`))
  throw new Error("Source and output must be separate.");
await fs.rm(output, { recursive: true, force: true });
await fs.cp(input, output, {
  recursive: true,
  filter: (source) => path.basename(source) !== "_metadata",
});
const originalBackground = await fs.readFile(
  path.join(input, "js/background.js"),
  "utf8",
);
const originalContent = await fs.readFile(
  path.join(input, "js/content.js"),
  "utf8",
);
function walk(node, callback) {
  if (!node || typeof node !== "object") return;
  if (node.type) callback(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => walk(child, callback));
    else if (value && typeof value === "object") walk(value, callback);
  }
}
const parseJS = (code) => parse(code, { ecmaVersion: "latest" });
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2)
    throw new Error(
      `Patch target is missing or ambiguous: ${before.slice(0, 100)}`,
    );
  return source.replace(before, after);
}
let defaultsNode;
walk(parseJS(originalBackground), (node) => {
  if (
    node.type === "VariableDeclarator" &&
    node.id.name === "i" &&
    node.init?.type === "ObjectExpression" &&
    node.init.properties.some((property) => property.key?.name === "settings")
  )
    defaultsNode = node.init;
});
if (!defaultsNode) throw new Error("Could not locate original defaults.");
const defaults = vm.runInNewContext(
  `(${originalBackground.slice(defaultsNode.start, defaultsNode.end)})`,
  {},
  { timeout: 1000 },
);
defaults.lastVersion = migratedVersion;
defaults.state.rateOfferDisabled = true;
defaults.state.patreonOfferDisabled = true;
defaults.state.translateOfferDisabled = true;
// Disable unused publisher endpoints and telemetry. Keep Twitch API settings intact.
defaults.analyticsApi = "";
defaults.notificationsApi = "";
defaults.promotionsApi = "";
await fs.writeFile(
  path.join(output, "defaults.js"),
  `const ATBE_DEFAULTS = ${JSON.stringify(defaults, null, 2)};\n`,
);

let hookCall, injectionFunction, heartbeatFunction, oldUnmuteFunction;
walk(parseJS(originalContent), (node) => {
  if (
    node.type === "CallExpression" &&
    node.callee.name === "Ge" &&
    node.arguments[0]?.type === "ArrowFunctionExpression"
  )
    hookCall = node;
  if (node.type === "FunctionDeclaration" && node.id.name === "Ge")
    injectionFunction = node;
  if (node.type === "FunctionDeclaration" && node.id.name === "Ze")
    heartbeatFunction = node;
  if (node.type === "FunctionDeclaration" && node.id.name === "Bt")
    oldUnmuteFunction = node;
});
if (!hookCall || !injectionFunction)
  throw new Error("Could not identify page hook and injection helper.");
const hook = hookCall.arguments[0];
const hookBody = originalContent.slice(hook.body.start + 1, hook.body.end - 1);
await fs.writeFile(
  path.join(output, "js/page-main.js"),
  `(function(){ if(window.__ATBE_MV3_HOOK__) return; window.__ATBE_MV3_HOOK__=true; ${hookBody} }).call(null, '__ATBE_MV3__');\n`,
);
const replacements = [
  [hookCall.start, hookCall.end, "void 0"],
  [
    injectionFunction.start,
    injectionFunction.end,
    'function Ge(){chrome.runtime.sendMessage({mv3:"activate-page"});}',
  ],
  [heartbeatFunction.start, heartbeatFunction.end, "function Ze(){}"],
  [oldUnmuteFunction.start, oldUnmuteFunction.end, "function Bt(){}"],
].sort((a, b) => b[0] - a[0]);
let content = originalContent;
for (const [start, end, text] of replacements)
  content = content.slice(0, start) + text + content.slice(end);
content = replaceOnce(content, "qe=ee(10)", 'qe="__ATBE_MV3__"');
// At document_start Chrome may not have created the root element yet.
// Execute the packaged content script only after both the DOM root and defaults exist.
await fs.writeFile(path.join(output, "js/content.js"), content);
await fs.writeFile(
  path.join(output, "js/bootstrap.js"),
  `
(() => {
  const initialize = async () => {
    if (!document.documentElement) {
      const observer = new MutationObserver(() => {
        if (document.documentElement) { observer.disconnect(); initialize(); }
      });
      observer.observe(document, { childList: true });
      return;
    }
    const response = await chrome.runtime.sendMessage({ mv3: 'inject-content' });
    if (!response?.ok) console.error('Automatic Twitch initialization failed:', response?.error);
  };
  initialize().catch(console.error);
})();
`,
);
// The MAIN hook must install fetch proxies at document_start; only its optional marker needs a root.
let main = await fs.readFile(path.join(output, "js/page-main.js"), "utf8");
main = replaceOnce(
  main,
  'document.documentElement.classList.add("_ATBE_INTER_")',
  '(document.documentElement?document.documentElement.classList.add("_ATBE_INTER_"):new MutationObserver((_,o)=>{if(document.documentElement){document.documentElement.classList.add("_ATBE_INTER_");o.disconnect()}}).observe(document,{childList:true}))',
);
await fs.writeFile(path.join(output, "js/page-main.js"), main);

const storageFile = path.join(output, "js/deps/ext-storage-manager.min.js");
let storage = await fs.readFile(storageFile, "utf8");
storage = replaceOnce(
  storage,
  'constructor(t="sync",',
  'constructor(t="local",',
);
storage = replaceOnce(
  storage,
  "this.nativeStorage.get(this._checkStorage.bind(this))",
  'chrome.runtime.sendMessage({mv3:"ready"},()=>{if(chrome.runtime.lastError){console.error(chrome.runtime.lastError);return}this.nativeStorage.get(this._checkStorage.bind(this))})',
);
await fs.writeFile(storageFile, storage);
const openerFile = path.join(output, "js/deps/ext-single-page-opener.min.js");
let opener = await fs.readFile(openerFile, "utf8");
opener = replaceOnce(
  opener,
  "!!(chrome.extension.getBackgroundPage&&chrome.extension.getBackgroundPage()===i)",
  "false",
);
opener = opener.replaceAll("chrome.extension.getURL", "chrome.runtime.getURL");
await fs.writeFile(openerFile, opener);
for (const [source, target] of [
  ["service-worker.js", "service-worker.js"],
  ["auto-inject.js", "js/deps/ext-auto-inject.min.js"],
  ["notifier.js", "js/deps/ebnull-notifier.min.js"],
  ["offscreen.html", "offscreen.html"],
  ["offscreen.js", "offscreen.js"],
  ["playback-main.js", "js/playback-main.js"],
  ["playback-bridge.js", "js/playback-bridge.js"],
])
  await fs.copyFile(path.join(repo, "src", source), path.join(output, target));
await fs.rm(path.join(output, "js/background.js"));

async function files(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? files(path.join(directory, entry.name))
          : path.join(directory, entry.name),
      ),
    )
  ).flat();
}
for (const file of await files(output)) {
  if (file.endsWith(".html")) {
    const html = await fs.readFile(file, "utf8");
    await fs.writeFile(
      file,
      html.replace(
        /<script\b[^>]*\bsrc=["']https?:\/\/[^"']+["'][^>]*>\s*<\/script>/gi,
        "",
      ),
    );
  }
  if (
    file.endsWith(`${path.sep}messages.json`) &&
    file.includes(`${path.sep}_locales${path.sep}`)
  ) {
    const messages = JSON.parse(await fs.readFile(file, "utf8"));
    for (const key of ["extension_name", "extension_title"]) {
      if (messages[key])
        messages[key].message = "Automatic Twitch (Manifest V3)";
    }
    await fs.writeFile(file, JSON.stringify(messages, null, 2) + "\n");
  }
  if (file.endsWith(".js")) {
    let code = await fs.readFile(file, "utf8");
    code = code.replaceAll(".getExtensionTabs()", '.getViews({type:"tab"})');
    // The native Chrome page translator replaces the old remote translator widget.
    if (
      file.endsWith("/pages/help.js") ||
      file.endsWith("/pages/notifications.js")
    ) {
      const ast = parseJS(code);
      const translate = ast.body.find(
        (node) =>
          node.type === "FunctionDeclaration" &&
          node.id.name === "initTranslate",
      );
      if (translate)
        code =
          code.slice(0, translate.start) +
          "function initTranslate() {}" +
          code.slice(translate.end);
    }
    parseJS(code);
    await fs.writeFile(file, await prettier.format(code, { parser: "babel" }));
  }
}
delete manifest.key;
delete manifest.update_url;
manifest.manifest_version = 3;
manifest.version = migratedVersion;
manifest.minimum_chrome_version = "116";
manifest.name = "Automatic Twitch (Manifest V3)";
manifest.action = manifest.browser_action;
delete manifest.browser_action;
manifest.background = { service_worker: "service-worker.js" };
manifest.host_permissions = manifest.permissions.filter((permission) =>
  permission.includes("://"),
);
manifest.permissions = [
  ...manifest.permissions.filter((permission) => !permission.includes("://")),
  "scripting",
  "offscreen",
];
manifest.content_security_policy = {
  extension_pages: "script-src 'self'; object-src 'self'",
};
manifest.web_accessible_resources = [
  { resources: manifest.web_accessible_resources, matches: twitchPatterns() },
];
manifest.content_scripts = [
  {
    matches: twitchPatterns(),
    js: ["js/playback-main.js", "js/page-main.js"],
    run_at: "document_start",
    all_frames: true,
    world: "MAIN",
  },
  {
    matches: twitchPatterns(),
    js: ["js/bootstrap.js"],
    css: ["css/content.css"],
    run_at: "document_start",
    all_frames: true,
  },
];
function twitchPatterns() {
  return ["https://www.twitch.tv/*", "https://player.twitch.tv/*"];
}
await fs.writeFile(
  path.join(output, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
await fs.writeFile(
  path.join(repo, "build/provenance.json"),
  JSON.stringify(
    {
      source: input,
      originalVersion: "1.6.3",
      migratedVersion: manifest.version,
      backgroundSHA256: crypto
        .createHash("sha256")
        .update(originalBackground)
        .digest("hex"),
      contentSHA256: crypto
        .createHash("sha256")
        .update(originalContent)
        .digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
console.log(`Built Automatic Twitch (Manifest V3): ${output}`);
