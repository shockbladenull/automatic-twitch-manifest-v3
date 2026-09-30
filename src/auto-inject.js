// Content scripts are declared in the MV3 manifest. Existing tabs need a reload.
class ExtAutoInject {
  constructor() {
    return new Promise((resolve) => {
      const instance = crypto.randomUUID();
      const listener = (event) => {
        if (event.source !== window || !event.data?.extAutoInjected) return;
        if (event.data.extAutoInjected.instance === instance) return;
        window.removeEventListener("message", listener);
        resolve(event.data.extAutoInjected);
      };
      window.addEventListener("message", listener);
      window.postMessage(
        {
          extAutoInjected: {
            instance,
            version: chrome.runtime.getManifest().version,
          },
        },
        location.origin,
      );
    });
  }
  static get pageMatches() {
    return true;
  }
}
