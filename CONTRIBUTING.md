# Development

Use Node.js 22 or newer. The required original Automatic Twitch 1.6.3 source and resources are included in `vendor/automatic-twitch-1.6.3/`.

```sh
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:browser
```

On macOS, `ATBE_HEADED=1 npm run test:browser` verifies native tab switching in an isolated browser. Linux headed tests need a working display; other platforms have not been verified.

Edit `src/` and `scripts/`, then rebuild. Keep `vendor/` unchanged unless deliberately updating upstream material. Direct edits inside `build/extension` are overwritten.

- Keep changes focused and describe their user-visible effect.
- Add regression coverage for behavioral changes and record the test commands used.
- Preserve manual pause, media controls, mute, and the ability to disable protection.
- Format JavaScript with Prettier and use conventional commit messages.
- Keep credentials, browser profiles, account data, and generated artifacts out of Git.
- Preserve this repository's private visibility and upstream copyright notices.

## Release packages

The extension version comes from `package.json`. After changing it, prepare and verify a package:

```sh
npm run build
npm test
npm run package
npm run verify:package
ATBE_EXTENSION_DIR=test-results/release/automatic-twitch-manifest-v3 npm run test:browser
```

`dist/` contains the versioned extension ZIP and SHA-256 checksum. The ZIP contains a complete extension folder and license notices, ready for **Load unpacked** in Chrome.

Commit the release changes, create and push a matching `v<version>` tag, then run the **Release** workflow from GitHub Actions with that tag. It builds, verifies, tests the packaged extension, and publishes both assets. The first release can also be published with `gh release create` using the files in `dist/` and the notes in `docs/release-notes.md`.

Report problems through [Issues](https://github.com/shockbladenull/automatic-twitch-manifest-v3/issues). Include browser/extension versions, OS, and reproduction steps. For playback problems, include mute state and how the tab became hidden. Remove private data from logs before sharing them.
