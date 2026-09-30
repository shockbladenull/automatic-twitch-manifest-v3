(() => {
  async function update() {
    const { settings, config } = await chrome.storage.local.get([
      "settings",
      "config",
    ]);
    window.postMessage(
      {
        type: "ATBE_PLAYBACK_SETTINGS",
        enabled: !!(settings?.enabled && settings?.preventPause),
        playerSelector: config?.querySelectors?.playerElement || "",
      },
      location.origin,
    );
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.settings || changes.config))
      update().catch(console.error);
  });
  update().catch(console.error);
})();
