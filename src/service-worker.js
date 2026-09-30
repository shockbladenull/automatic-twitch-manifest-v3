importScripts("defaults.js");
const bootId = crypto.randomUUID();

const twitchPatterns = [
  "https://www.twitch.tv/*",
  "https://player.twitch.tv/*",
];
const clone = (value) => JSON.parse(JSON.stringify(value));
function mergeDefaults(current, defaults) {
  const result = { ...current };
  for (const [key, value] of Object.entries(defaults)) {
    if (result[key] === undefined) result[key] = clone(value);
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = mergeDefaults(result[key] || {}, value);
    }
  }
  return result;
}
const ready = (async () => {
  const current = await chrome.storage.local.get(null);
  const merged = mergeDefaults(current, ATBE_DEFAULTS);
  const missing = Object.fromEntries(
    Object.entries(merged).filter(
      ([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value),
    ),
  );
  if (Object.keys(missing).length) await chrome.storage.local.set(missing);
})();

async function settings() {
  await ready;
  return (await chrome.storage.local.get("settings")).settings;
}
function isTwitch(url = "") {
  try {
    return (
      ["www.twitch.tv", "player.twitch.tv"].includes(new URL(url).hostname) &&
      new URL(url).protocol === "https:"
    );
  } catch {
    return false;
  }
}
async function registeredFrames() {
  return (await chrome.storage.session.get("frames")).frames || {};
}
// Serialize session-registry writes so registrations from multiple frames aren't lost.
let registryQueue = Promise.resolve();
function updateFrames(update) {
  registryQueue = registryQueue
    .catch(() => {})
    .then(async () => {
      const frames = await registeredFrames();
      update(frames);
      await chrome.storage.session.set({ frames });
    });
  return registryQueue;
}
function frameKey(sender) {
  return `${sender.tab.id}.${sender.frameId}`;
}
async function broadcast(message, except) {
  const frames = await registeredFrames();
  await Promise.all(
    Object.entries(frames).map(async ([key, frame]) => {
      if (key === except) return;
      try {
        await chrome.tabs.sendMessage(
          frame.tabId,
          message,
          frame.documentId
            ? { documentId: frame.documentId }
            : { frameId: frame.frameId },
        );
      } catch {
        await updateFrames((entries) => {
          delete entries[key];
        });
      }
    }),
  );
}
async function updateAction() {
  const enabled = (await settings()).enabled;
  await chrome.action.setIcon({
    path: {
      19: `icon/actions/action_19_${enabled ? "enabled" : "disabled"}.png`,
      38: `icon/actions/action_38_${enabled ? "enabled" : "disabled"}.png`,
    },
  });
  await chrome.action.setTitle({
    title: `Automatic Twitch (Manifest V3) — ${enabled ? "Enabled" : "Disabled"}`,
  });
}
async function updateDiscarding(tabId) {
  const prefs = await settings();
  const tabs = tabId
    ? [{ id: tabId }]
    : await chrome.tabs.query({ url: twitchPatterns });
  await Promise.all(
    tabs.map((tab) =>
      chrome.tabs
        .update(tab.id, {
          autoDiscardable: !(prefs.enabled && prefs.preventDiscard),
        })
        .catch(() => {}),
    ),
  );
}
async function ensureAlarm() {
  if (!(await chrome.alarms.get("autoReload"))) {
    await chrome.alarms.create("autoReload", { periodInMinutes: 1 });
  }
}
async function autoReload() {
  const prefs = await settings();
  if (!prefs.enabled || !prefs.autoReload) return;
  for (const tab of await chrome.tabs.query({ url: twitchPatterns })) {
    if (
      tab.status === "unloaded" ||
      (tab.status === "complete" &&
        /^(www\.|player\.|)twitch\.tv$/.test(tab.title || ""))
    ) {
      await chrome.tabs.reload(tab.id).catch(() => {});
    }
  }
}
function resolveUrl(input) {
  const value = typeof input === "string" ? input : input.url;
  const url = value.startsWith("@@dir")
    ? chrome.runtime.getURL(value.slice(5))
    : value;
  const parsed = new URL(url);
  if (!["https:", "chrome-extension:"].includes(parsed.protocol))
    throw new Error("Unsupported URL");
  if (
    parsed.protocol === "chrome-extension:" &&
    parsed.hostname !== chrome.runtime.id
  )
    throw new Error("Foreign extension URL");
  return url;
}
async function openPage(input) {
  const options = typeof input === "string" ? { url: input } : input;
  const url = resolveUrl(input);
  const base = url.split(/[?#]/)[0];
  const found = (await chrome.tabs.query({})).find(
    (tab) => tab.url?.split(/[?#]/)[0] === base,
  );
  if (found) {
    await chrome.windows.update(found.windowId, { focused: true });
    return chrome.tabs.update(found.id, {
      active: true,
      ...(found.url !== url ? { url } : {}),
    });
  }
  if (options.type === "popup") {
    const win = await chrome.windows.create({
      url,
      type: "popup",
      width: options.width || 700,
      height: options.height || 500,
    });
    return win.tabs[0];
  }
  return chrome.tabs.create({ url });
}
async function activateTab(tab) {
  const prefs = await settings();
  if (!prefs.enabled || !prefs.autoStart) return;
  // Preserve the previous active tab even when activation fails midway.
  const focused = await chrome.windows.getLastFocused();
  const [previous] = await chrome.tabs.query({
    active: true,
    windowId: tab.windowId,
  });
  if (previous?.id === tab.id && focused.id === tab.windowId && focused.focused)
    return;
  try {
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
    await new Promise((resolve) => setTimeout(resolve, 500));
  } finally {
    if (previous)
      await chrome.tabs.update(previous.id, { active: true }).catch(() => {});
    if (focused.state !== "minimized")
      await chrome.windows
        .update(focused.id, { focused: true })
        .catch(() => {});
  }
}
async function activatePage(sender) {
  await chrome.scripting.executeScript({
    target: { tabId: sender.tab.id, frameIds: [sender.frameId] },
    world: "MAIN",
    func: () => {
      Object.defineProperty(document, "hidden", {
        get: () => false,
        configurable: true,
      });
      Object.defineProperty(document, "visibilityState", {
        get: () => "visible",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      setTimeout(() => {
        delete document.hidden;
        delete document.visibilityState;
      }, 1000);
    },
  });
}

let creatingOffscreen;
async function playSound(sound, volume) {
  if (!(await chrome.offscreen.hasDocument())) {
    creatingOffscreen ||= chrome.offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Play user-enabled reward alert sounds",
      })
      .finally(() => {
        creatingOffscreen = undefined;
      });
    await creatingOffscreen;
  }
  await chrome.runtime.sendMessage({ target: "atbe-offscreen", sound, volume });
}
const historyFields = {
  lastPoints: "claimID",
  lastDrops: "dropInstanceID",
  lastMoments: "momentID",
  lastRaids: "id",
  lastPredictions: "id",
  lastReloads: "id",
};
function eventIdentity(item, field) {
  // One drop can grant several benefits; prediction IDs span start and result events.
  return `${item[field]}:${item.status ?? ""}:${item.benefit?.name ?? ""}`;
}
async function alertItem(item, prefs) {
  const kind = item.type;
  const alertKind =
    kind === "predictions"
      ? item.status === 0
        ? "predictionsStart"
        : "predictionsResult"
      : kind;
  const alert = prefs.alerts?.[alertKind];
  const timestamp = item.claimedAt || item.timestamp;
  if (
    !alert ||
    !timestamp ||
    Date.now() - timestamp > ATBE_DEFAULTS.config.alertShowDelay
  )
    return;
  if (alert.visual)
    await broadcast({ visualAlert: { item, duration: alert.duration } });
  if (alert.sound) {
    let sound = kind === "reloads" ? "system" : kind;
    if (["raids", "predictions"].includes(kind))
      sound += `-${item.status || 0}`;
    await playSound(sound, alert.volume).catch(console.warn);
  }
  if (alert.native) {
    const titleKey = {
      points: "alert_points",
      drops: "alert_drop",
      moments: "alert_moment",
      raids: "alert_raids",
      predictions:
        item.status === 0
          ? "alert_predictionsStart"
          : "alert_predictionsResult",
      reloads: "alert_reloads",
    }[kind];
    const id = crypto.randomUUID();
    const login = item.login || item.broadcaster?.login || item.data?.login;
    const url = login
      ? `https://www.twitch.tv/${encodeURIComponent(login)}`
      : "https://www.twitch.tv/drops/inventory";
    await chrome.storage.session.set({ [`notification:${id}`]: url });
    await chrome.notifications.create(id, {
      type: "basic",
      silent: true,
      iconUrl: "icon/appicon_128.png",
      title: chrome.i18n.getMessage(titleKey) || "Automatic Twitch",
      message: String(
        item.benefit?.name ||
          item.title ||
          item.data?.title ||
          (kind === "points"
            ? `+${item.points} ${item.pointsName || "points"}`
            : kind),
      ),
      contextMessage:
        item.displayName ||
        item.game?.name ||
        item.broadcaster?.displayName ||
        "",
    });
  }
}
async function handleStorage(changes) {
  await ready;
  if (changes.settings) {
    await updateAction();
    await updateDiscarding();
  }
  if (changes.processExtensionReload?.newValue) {
    await chrome.storage.local.clear();
    chrome.runtime.reload();
    return;
  }
  const prefs = await settings();
  for (const [key, field] of Object.entries(historyFields)) {
    const change = changes[key];
    // Ignore the initial insertion of default history arrays.
    if (!change?.oldValue || !Array.isArray(change.newValue)) continue;
    const previous = new Set(
      change.oldValue.map((item) => eventIdentity(item, field)),
    );
    for (const item of change.newValue) {
      if (!previous.has(eventIdentity(item, field)))
        await alertItem(item, prefs);
    }
  }
}
async function handleMessage(message, sender) {
  await ready;
  const fromPage = sender.tab && isTwitch(sender.url);
  if (message?.mv3 === "ready") return { ok: true, bootId };
  if (message?.mv3 === "inject-content" && fromPage) {
    const target = sender.documentId
      ? { tabId: sender.tab.id, documentIds: [sender.documentId] }
      : { tabId: sender.tab.id, frameIds: [sender.frameId] };
    const [guard] = await chrome.scripting.executeScript({
      target,
      func: () => {
        if (globalThis.__ATBE_MV3_CONTENT__) return false;
        globalThis.__ATBE_MV3_CONTENT__ = true;
        return true;
      },
    });
    if (guard?.result)
      await chrome.scripting.executeScript({
        target,
        files: [
          "js/deps/ext-storage-manager.min.js",
          "js/deps/ext-auto-inject.min.js",
          "js/playback-bridge.js",
          "js/content.js",
        ],
      });
    return { ok: true };
  }
  if (message?.analytics || ["hideBage", "showNotifsBage"].includes(message))
    return { ok: true };
  if (message === "registerTab" && fromPage) {
    await updateFrames((frames) => {
      frames[frameKey(sender)] = {
        tabId: sender.tab.id,
        frameId: sender.frameId,
        documentId: sender.documentId,
      };
    });
    await updateDiscarding(sender.tab.id);
  } else if (message === "unregisterTab" && fromPage) {
    await updateFrames((frames) => {
      delete frames[frameKey(sender)];
    });
    const remaining = Object.values(await registeredFrames());
    if (!remaining.some((frame) => frame.tabId === sender.tab.id)) {
      await chrome.tabs
        .update(sender.tab.id, { autoDiscardable: true })
        .catch(() => {});
    }
  } else if (message?.resend && fromPage) {
    await broadcast(message.resend, frameKey(sender));
  } else if (message === "activateTab" && fromPage)
    await activateTab(sender.tab);
  else if (message?.mv3 === "activate-page" && fromPage)
    await activatePage(sender);
  else if (message?.extSinglePageOpener)
    return openPage(message.extSinglePageOpener);
  else if (message === "openNotifications")
    return openPage({ url: "@@dir/pages/notifications.html", type: "popup" });
  else if (message?.openHelp) {
    return openPage({
      url: `@@dir/pages/help_${chrome.i18n.getMessage("extension_lang")}.html#${message.section || ""}`,
      type: "popup",
    });
  } else if (message?.openContribs)
    return openPage({ url: "@@dir/pages/contributors.html", type: "popup" });
  else if (message?.resetStats) {
    await chrome.storage.local.set(
      Object.fromEntries(
        ["statistics", ...Object.keys(historyFields)].map((key) => [
          key,
          clone(ATBE_DEFAULTS[key]),
        ]),
      ),
    );
  } else if (message?.removeCookies && fromPage) {
    const cookies = Array.isArray(message.removeCookies)
      ? message.removeCookies
      : [message.removeCookies];
    for (const cookie of cookies) {
      const url = new URL(cookie.url);
      if (
        url.protocol === "https:" &&
        (url.hostname === "twitch.tv" || url.hostname.endsWith(".twitch.tv"))
      ) {
        await chrome.cookies.remove(cookie);
      }
    }
  }
  return { ok: true };
}

// Register all wake-up listeners synchronously, before storage initialization.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target === "atbe-offscreen")
    return;
  handleMessage(message, sender)
    .then(respond)
    .catch((error) => {
      console.error("ATBE message:", error);
      respond({ ok: false, error: error.message });
    });
  return true;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") handleStorage(changes).catch(console.error);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  updateFrames((frames) => {
    for (const [key, value] of Object.entries(frames))
      if (value.tabId === tabId) delete frames[key];
  }).catch(console.error);
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url || isTwitch(change.url)) return;
  updateFrames((frames) => {
    let registered = false;
    for (const [key, frame] of Object.entries(frames)) {
      if (frame.tabId === tabId) {
        registered = true;
        delete frames[key];
      }
    }
    if (registered)
      chrome.tabs.update(tabId, { autoDiscardable: true }).catch(() => {});
  }).catch(console.error);
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "autoReload") autoReload().catch(console.error);
});
chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm().catch(console.error);
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm().catch(console.error);
});
chrome.notifications.onClicked.addListener(async (id) => {
  const key = `notification:${id}`;
  const entry = await chrome.storage.session.get(key);
  if (entry[key]) await openPage(entry[key]);
});
chrome.notifications.onClosed.addListener((id) => {
  chrome.storage.session.remove(`notification:${id}`).catch(console.error);
});
ready
  .then(() => Promise.all([updateAction(), ensureAlarm()]))
  .catch(console.error);
