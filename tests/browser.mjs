import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const extension = process.env.ATBE_EXTENSION_DIR
  ? path.resolve(process.env.ATBE_EXTENSION_DIR)
  : path.resolve(import.meta.dirname, "../build/extension");
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "atbe-v3-test-"));
const extensionArgs = [
  `--disable-extensions-except=${extension}`,
  `--load-extension=${extension}`,
];
let browserProcess, connectedBrowser;
let context;
if (process.env.ATBE_HEADED === "1") {
  // No focus emulation: ordinary Playwright launch makes all pages visible.
  browserProcess = spawn(
    chromium.executablePath(),
    [
      ...extensionArgs,
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let port;
  const deadline = Date.now() + 30000;
  while (!port && Date.now() < deadline) {
    try {
      port = Number(
        (
          await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")
        ).split("\n")[0],
      );
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!port) {
    browserProcess.kill();
    throw new Error("Isolated browser did not start");
  }
  connectedBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
    noDefaults: true,
  });
  context = connectedBrowser.contexts()[0];
} else {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: extensionArgs,
  });
}
context.setDefaultTimeout(15000);
const errors = [];
const operations = [];
async function waitUntil(predicate, timeout = 30000) {
  const deadline = Date.now() + timeout;
  do {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(
    `Condition timed out; operations=${JSON.stringify(operations)}; errors=${JSON.stringify(errors)}`,
  );
}
let dropClaimed = false;
let worker =
  context
    .serviceWorkers()
    .find((candidate) => candidate.url().endsWith("/service-worker.js")) ||
  (await context.waitForEvent("serviceworker", {
    predicate: (candidate) => candidate.url().endsWith("/service-worker.js"),
  }));
const id = new URL(worker.url()).hostname;
worker.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`worker: ${msg.text()}`);
});
try {
  // A Twitch-shaped fixture exercises the original packaged code without touching an account.
  await context.route("https://www.twitch.tv/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><title>Fixture stream</title></head><body><main class="twilight-main"><div class="persistent-player"><div class="video-player__container"><video></video><div class="video-player__overlay"></div></div></div></main></body></html>',
    }),
  );
  await context.route("https://gql.twitch.tv/**", async (route) => {
    const request = route.request();
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST,OPTIONS",
    };
    if (request.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (request.url().endsWith("/integrity"))
      return route.fulfill({
        headers,
        json: { token: "fixture-integrity", expiration: Date.now() + 600000 },
      });
    const queries = JSON.parse(request.postData() || "[]");
    const results = (Array.isArray(queries) ? queries : [queries]).map(
      (query) => {
        operations.push(query.operationName);
        if (query.operationName === "Inventory")
          return {
            data: {
              currentUser: {
                inventory: {
                  dropCampaignsInProgress: dropClaimed
                    ? []
                    : [
                        {
                          game: { name: "Fixture game", slug: "fixture" },
                          timeBasedDrops: [
                            {
                              id: "fixture-drop",
                              campaign: {},
                              self: {
                                dropInstanceID: "fixture-earned-drop",
                                isClaimed: false,
                              },
                              benefitEdges: [
                                {
                                  benefit: {
                                    name: "Fixture reward",
                                    imageAssetURL: "",
                                  },
                                },
                              ],
                            },
                          ],
                        },
                      ],
                },
              },
            },
          };
        if (query.operationName === "DropsPage_ClaimDropRewards") {
          assert.equal(
            query.variables.input.dropInstanceID,
            "fixture-earned-drop",
          );
          dropClaimed = true;
          return { data: { claimDropRewards: { status: "ELIGIBLE_FOR_ALL" } } };
        }
        return { data: {} };
      },
    );
    return route.fulfill({ headers, json: results });
  });
  await context.addCookies([
    {
      name: "auth-token",
      value: "fixture-auth",
      domain: ".twitch.tv",
      path: "/",
      secure: true,
    },
  ]);
  await context.addInitScript(() => {
    if (location.hostname.endsWith("twitch.tv")) {
      localStorage.setItem(
        "local_copy_unique_id",
        JSON.stringify("fixture-device"),
      );
      localStorage.setItem(
        "local_storage_app_session_id",
        JSON.stringify("fixture-session"),
      );
    }
  });
  const popup = await context.newPage();
  popup.on("pageerror", (error) => errors.push(`popup: ${error.message}`));
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await popup.waitForFunction(
    () => document.querySelector("#switchMain")?.checked === true,
  );
  await popup.locator("#introClose").click();
  await popup.locator("#popupOpenSettings").click();
  assert.ok(await popup.locator("#popupContent").textContent());
  await popup.locator("#popupClose").click();
  await popup.locator("label.switch_main").click();
  await waitUntil(() =>
    popup.evaluate(
      async () =>
        !(await chrome.storage.local.get("settings")).settings.enabled,
    ),
  );
  await popup.locator("label.switch_main").click();
  await waitUntil(() =>
    popup.evaluate(
      async () => (await chrome.storage.local.get("settings")).settings.enabled,
    ),
  );
  console.log("PASS: Manifest V3 worker, popup, settings and enable switch");

  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`content: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`content console: ${msg.text()}`);
  });
  await page.goto("https://www.twitch.tv/drops/inventory");
  await page.waitForFunction(() =>
    document.documentElement.classList.contains("_ATBE_INTER_"),
  );
  await waitUntil(() =>
    popup.evaluate(
      async () =>
        (await chrome.storage.local.get("statistics")).statistics.totalDrops ===
        1,
    ),
  );
  assert.ok(operations.includes("Inventory"));
  assert.ok(operations.includes("DropsPage_ClaimDropRewards"));
  const frames = await popup.evaluate(
    async () => (await chrome.storage.session.get("frames")).frames,
  );
  assert.equal(Object.keys(frames).length, 1);
  await popup.bringToFront();
  await popup.locator("#popupOpenClaims").click();
  await popup.waitForFunction(() =>
    document
      .querySelector("#popupContent")
      .textContent.includes("Fixture reward"),
  );
  await popup.locator("#popupClose").click();
  console.log(
    "PASS: MAIN page hook, integrity bridge, GraphQL inventory, earned-drop claim and history",
  );

  if (process.env.ATBE_HEADED === "1") {
    await page.goto("https://www.twitch.tv/fixture");
    await page.bringToFront();
    await page.evaluate(async () => {
      const video = document.querySelector("video");
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64;
      video.srcObject = canvas.captureStream(10);
      video.muted = true;
      canvas.getContext("2d").fillRect(0, 0, 64, 64);
      await video.play();
      window.fixtureVideo = video;
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) video.pause();
      });
    });
    await popup.bringToFront();
    await waitUntil(() => page.evaluate(() => document.hidden));
    assert.equal(await page.evaluate(() => window.fixtureVideo.paused), false);
    await page.bringToFront();
    await page.evaluate(() => window.fixtureVideo.pause());
    await popup.bringToFront();
    assert.equal(await page.evaluate(() => window.fixtureVideo.paused), true);
    console.log(
      "PASS: real tab switch protects playback and retains manual pause",
    );
    await popup.evaluate(async () => {
      const { settings } = await chrome.storage.local.get("settings");
      settings.preventPause = false;
      await chrome.storage.local.set({ settings });
    });
    await page.bringToFront();
    await page.evaluate(() => window.fixtureVideo.play());
    await popup.bringToFront();
    await waitUntil(() =>
      page.evaluate(() => {
        window.fixtureVideo.pause();
        return window.fixtureVideo.paused;
      }),
    );
    console.log("PASS: disabling protection restores native background pause");
  }

  // Force termination, then wake through a runtime message. No heartbeat keeps it alive.
  const cdp = await context.newCDPSession(popup);
  const versions = new Map();
  cdp.on("ServiceWorker.workerVersionUpdated", ({ versions: updates }) => {
    for (const version of updates) versions.set(version.versionId, version);
  });
  await cdp.send("ServiceWorker.enable");
  const beforeRestart = await popup.evaluate(() =>
    chrome.runtime.sendMessage({ mv3: "ready" }),
  );
  await waitUntil(() =>
    [...versions.values()].some(
      (version) =>
        version.scriptURL === `chrome-extension://${id}/service-worker.js`,
    ),
  );
  await cdp.send("ServiceWorker.stopAllWorkers");
  await waitUntil(() =>
    [...versions.values()].some(
      (version) =>
        version.scriptURL === `chrome-extension://${id}/service-worker.js` &&
        version.runningStatus === "stopped",
    ),
  );
  const afterRestart = await popup.evaluate(() =>
    chrome.runtime.sendMessage({ mv3: "ready" }),
  );
  assert.notEqual(afterRestart.bootId, beforeRestart.bootId);
  const state = await popup.evaluate(async () => ({
    local: await chrome.storage.local.get(["settings", "statistics"]),
    frames: (await chrome.storage.session.get("frames")).frames,
    alarm: await chrome.alarms.get("autoReload"),
  }));
  assert.equal(state.local.statistics.totalDrops, 1);
  assert.equal(state.local.settings.enabled, true);
  assert.equal(Object.keys(state.frames).length, 1);
  assert.equal(state.alarm.periodInMinutes, 1);
  // Exercise the offscreen sound path after restart.
  await popup.evaluate(async () => {
    const { settings, lastDrops } = await chrome.storage.local.get([
      "settings",
      "lastDrops",
    ]);
    settings.alerts.drops.sound = true;
    settings.alerts.drops.native = true;
    settings.alerts.drops.visual = false;
    await chrome.storage.local.set({ settings });
    await chrome.storage.local.set({
      lastDrops: [
        {
          type: "drops",
          dropInstanceID: "sound-test",
          claimedAt: Date.now(),
          benefit: { name: "Sound test" },
        },
        ...lastDrops,
      ],
    });
  });
  await waitUntil(() =>
    popup.evaluate(async () => await chrome.offscreen.hasDocument()),
  );
  await waitUntil(() =>
    popup.evaluate(
      async () => Object.keys(await chrome.notifications.getAll()).length === 1,
    ),
  );
  console.log(
    "PASS: worker restart, persisted state, frame registry, alarm, offscreen audio and native notification",
  );
  const twitchTabId = Object.values(state.frames)[0].tabId;
  await page.goto("about:blank");
  await waitUntil(() =>
    popup.evaluate(async (tabId) => {
      const frames = (await chrome.storage.session.get("frames")).frames;
      return (
        Object.keys(frames).length === 0 &&
        (await chrome.tabs.get(tabId)).autoDiscardable
      );
    }, twitchTabId),
  );
  console.log("PASS: leaving Twitch restores normal tab memory handling");
  await fs.mkdir(path.resolve(import.meta.dirname, "../test-results"), {
    recursive: true,
  });
  await popup.screenshot({
    path: path.resolve(import.meta.dirname, "../test-results/popup.png"),
  });
  assert.deepEqual(errors, []);
  console.log("PASS: no runtime errors in fixture browser");
} finally {
  if (connectedBrowser) await connectedBrowser.close();
  else await context.close();
  browserProcess?.kill();
  await fs.rm(profile, { recursive: true, force: true });
}
