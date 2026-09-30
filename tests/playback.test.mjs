import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";

const source = await fs.readFile(
  new URL("../src/playback-main.js", import.meta.url),
  "utf8",
);
function fixture(pathname = "/fixture") {
  class Events {
    listeners = new Map();
    addEventListener(name, callback) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(callback);
    }
    dispatch(name, event = {}) {
      for (const callback of this.listeners.get(name) || []) callback(event);
    }
  }
  class Document extends Events {
    background = false;
    get hidden() {
      return this.background;
    }
    querySelectorAll() {
      return [video, otherVideo];
    }
  }
  const document = new Document();
  class HTMLMediaElement {
    paused = false;
    ended = false;
    muted = true;
    volume = 0.5;
    calls = 0;
    pause() {
      this.calls++;
      this.paused = true;
      document.dispatch("pause", { target: this });
    }
  }
  class HTMLVideoElement extends HTMLMediaElement {
    primary = true;
    matches() {
      return this.primary;
    }
  }
  const video = new HTMLVideoElement();
  const otherVideo = new HTMLVideoElement();
  otherVideo.primary = false;
  const window = new Events();
  const handlers = new Map();
  const navigator = {
    mediaSession: {
      setActionHandler(action, handler) {
        handlers.set(action, handler);
      },
    },
  };
  const location = {
    hostname: "www.twitch.tv",
    pathname,
    origin: "https://www.twitch.tv",
    href: `https://www.twitch.tv${pathname}`,
  };
  const context = vm.createContext({
    window,
    document,
    navigator,
    location,
    Document,
    HTMLMediaElement,
    HTMLVideoElement,
    URL,
  });
  vm.runInContext(source, context);
  function settings(enabled) {
    window.dispatch("message", {
      source: window,
      origin: location.origin,
      data: {
        type: "ATBE_PLAYBACK_SETTINGS",
        enabled,
        playerSelector: ".player video",
      },
    });
  }
  settings(true);
  function hide() {
    document.background = true;
    document.dispatch("visibilitychange");
  }
  function show() {
    document.background = false;
    document.dispatch("visibilitychange");
  }
  return {
    video,
    otherVideo,
    document,
    hide,
    show,
    settings,
    navigator,
    handlers,
  };
}
test("tab switch protects a playing live video and preserves mute/volume", () => {
  const f = fixture();
  f.hide();
  f.video.pause();
  assert.equal(f.video.paused, false);
  assert.equal(f.video.calls, 0);
  assert.equal(f.video.muted, true);
  assert.equal(f.video.volume, 0.5);
});
test("foreground manual pause remains available and stays paused after hiding", () => {
  const f = fixture();
  f.video.pause();
  f.hide();
  assert.equal(f.video.paused, true);
  assert.equal(f.video.calls, 1);
});
test("returning to foreground permits pause again", () => {
  const f = fixture();
  f.hide();
  f.show();
  f.video.pause();
  assert.equal(f.video.paused, true);
});
test("turning protection or the extension off restores native background pause", () => {
  const f = fixture();
  f.hide();
  f.settings(false);
  f.video.pause();
  assert.equal(f.video.paused, true);
});
test("non-player media and VODs retain native pause behavior", () => {
  const f = fixture();
  f.hide();
  f.otherVideo.pause();
  assert.equal(f.otherVideo.paused, true);
  const vod = fixture("/videos/123");
  vod.hide();
  vod.video.pause();
  assert.equal(vod.video.paused, true);
});
test("media-session pause commands remain available while hidden", () => {
  const f = fixture();
  f.navigator.mediaSession.setActionHandler("pause", () => f.video.pause());
  f.hide();
  f.handlers.get("pause")();
  assert.equal(f.video.paused, true);
});
test("Ctrl+Tab does not accidentally grant permission to pause", () => {
  const f = fixture();
  f.document.dispatch("keydown", {
    key: "Tab",
    ctrlKey: true,
    isTrusted: true,
  });
  f.hide();
  f.video.pause();
  assert.equal(f.video.paused, false);
});
test("trusted pause control input is honored while hidden", () => {
  const f = fixture();
  f.hide();
  f.document.dispatch("keydown", { key: "MediaPause", isTrusted: true });
  f.video.pause();
  assert.equal(f.video.paused, true);
});
