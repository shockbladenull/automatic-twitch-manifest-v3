// Installed in MAIN before Twitch can cache the native media methods.
(() => {
  if (globalThis.__ATBE_PLAYBACK_GUARD__) return;
  globalThis.__ATBE_PLAYBACK_GUARD__ = true;
  const nativePause = HTMLMediaElement.prototype.pause;
  const nativeHidden = Object.getOwnPropertyDescriptor(
    Document.prototype,
    "hidden",
  )?.get;
  const hidden = () =>
    nativeHidden ? nativeHidden.call(document) : document.hidden;
  let enabled = false;
  let playerSelector = "";
  let playingBeforeHide = new WeakSet();
  let manualPauseUntil = 0;
  function isLivePage() {
    if (location.hostname === "player.twitch.tv")
      return new URL(location.href).searchParams.has("channel");
    const segment = location.pathname.split("/")[1];
    return (
      !location.pathname.includes("/clip/") &&
      ![
        "",
        "videos",
        "directory",
        "subscriptions",
        "drops",
        "wallet",
        "settings",
        "embed",
        "popout",
      ].includes(segment)
    );
  }
  function isPlayer(video) {
    return (
      video instanceof HTMLVideoElement &&
      isLivePage() &&
      playerSelector &&
      video.matches(playerSelector)
    );
  }
  function rememberPlaying() {
    if (!enabled || !playerSelector || !isLivePage()) return;
    for (const video of document.querySelectorAll(playerSelector)) {
      if (!video.paused && !video.ended) playingBeforeHide.add(video);
    }
  }
  document.addEventListener(
    "visibilitychange",
    () => {
      if (hidden()) rememberPlaying();
      else playingBeforeHide = new WeakSet();
    },
    true,
  );
  document.addEventListener(
    "play",
    (event) => {
      if (hidden() && isPlayer(event.target))
        playingBeforeHide.add(event.target);
    },
    true,
  );
  for (const name of ["pause", "ended", "emptied"]) {
    document.addEventListener(
      name,
      (event) => playingBeforeHide.delete(event.target),
      true,
    );
  }
  // Let explicit player controls pause the stream, including keyboard/media keys.
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (
        event.isTrusted &&
        event.target?.closest?.(".video-player__container")
      ) {
        manualPauseUntil = Date.now() + 1500;
      }
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      const editable = event.target?.closest?.(
        'input, textarea, [contenteditable="true"]',
      );
      if (
        event.isTrusted &&
        !editable &&
        [" ", "k", "K", "MediaPlayPause", "MediaPause"].includes(event.key)
      ) {
        manualPauseUntil = Date.now() + 1500;
      }
    },
    true,
  );
  if (navigator.mediaSession?.setActionHandler) {
    const nativeSetAction = navigator.mediaSession.setActionHandler;
    navigator.mediaSession.setActionHandler = function (action, handler) {
      if (action === "pause" && typeof handler === "function") {
        const original = handler;
        handler = function (...args) {
          manualPauseUntil = Date.now() + 1500;
          return Reflect.apply(original, this, args);
        };
      }
      return Reflect.apply(nativeSetAction, this, [action, handler]);
    };
  }
  HTMLMediaElement.prototype.pause = function (...args) {
    if (
      enabled &&
      hidden() &&
      isPlayer(this) &&
      playingBeforeHide.has(this) &&
      !this.paused &&
      !this.ended &&
      Date.now() > manualPauseUntil
    ) {
      return; // Ignore an automatic pause of an already-playing hidden live stream.
    }
    playingBeforeHide.delete(this);
    return Reflect.apply(nativePause, this, args);
  };
  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.type !== "ATBE_PLAYBACK_SETTINGS"
    )
      return;
    enabled = event.data.enabled === true;
    playerSelector =
      typeof event.data.playerSelector === "string"
        ? event.data.playerSelector
        : "";
    if (!enabled) playingBeforeHide = new WeakSet();
    else if (hidden()) rememberPlaying();
  });
})();
