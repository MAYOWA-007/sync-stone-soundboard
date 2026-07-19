# Sync Stone Soundboard

Sync Stone is a privacy-first, local-pair browser soundboard with a dedicated Controller, a prepared Player window, immutable published revisions, and a dynamically scaling fullscreen Trigger View.

**Live demo:** https://mayowa-007.github.io/sync-stone-soundboard/

**Public campaign library:** https://mayowa-007.github.io/sync-stone-soundboard/marketing/

## Boundary first

- Controller and Player must be tabs or windows on this GitHub Pages origin and in the same browser profile.
- This repository does not provide cross-device or internet control.
- It performs no conversion or upload. A file becomes a cue only after the active browser successfully decodes it.
- Imported audio remains in browser storage on the current device.
- There are no accounts, analytics, cloud relay, or external runtime dependencies.

## What works

- 4×4 banks with twelve distinct built-in demo cues and room for custom audio.
- Edit and Perform modes that keep selection separate from triggering.
- Play / Stop, Overlap, Restart, Hold, and Loop / Stop behaviors.
- Publish an immutable revision, prepare it in the Player, and enter Live only after readiness passes.
- Fullscreen Trigger View that preserves the 4×4 map and dynamically scales to desktop, mobile, and short landscape viewports.
- Master gain, Fade all, Stop all, scheduled acknowledgements, disconnect recovery, and an installable offline shell.
- A picker exposing 254 researched extension aliases while treating real browser decode success as the only current support decision.

## Run locally

Serve the repository over HTTP; browser audio, modules, and the service worker do not run correctly from `file://`.

```sh
python -m http.server 4174
```

Then open `http://127.0.0.1:4174/`.

## Verify

```sh
npm test
npm run check
```

See [browser feasibility notes](docs/browser-feasibility.html) and the [format research inventory](docs/import-compatibility.md).

## License

Repository code and bundled graphical assets are available under the MIT License. The license does not grant trademark rights in the Sync Stone name or mark.
