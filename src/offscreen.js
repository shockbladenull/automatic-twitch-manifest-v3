const playing = new Set();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target !== "atbe-offscreen")
    return;
  const allowed =
    /^(points|drops|moments|system|raids-[01]|predictions-[0-3](?:-1)?)$/;
  if (!allowed.test(message.sound)) {
    respond({ ok: false });
    return;
  }
  const audio = new Audio(chrome.runtime.getURL(`audio/${message.sound}.aac`));
  audio.volume = Math.max(0, Math.min(1, Number(message.volume) / 100 || 0));
  playing.add(audio);
  const cleanup = () => playing.delete(audio);
  audio.addEventListener("ended", cleanup, { once: true });
  audio.addEventListener("error", cleanup, { once: true });
  audio
    .play()
    .then(() => respond({ ok: true }))
    .catch(() => {
      cleanup();
      respond({ ok: false });
    });
  return true;
});
