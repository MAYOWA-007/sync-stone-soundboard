# Sync Stone public campaign library

This is the public-safe launch kit for the open-source Sync Stone release by MAYOWA-007. Open [`index.html`](index.html) for the searchable gallery or use any file in [`assets/`](assets/).

## What is included

- 39 campaign PNGs across 4K landscape cards, seven-slide carousels, social crops, channel headers, wallpapers, and vertical one-pagers
- One presentation-ready 2160 x 3840 product sheet
- One single-page US Letter PDF
- A SHA-256 manifest and an automated integrity check

The gallery links each card directly to its original-resolution asset. The `3840 x 3840` carousel masters are the source-of-truth square set; 2160 and 1080 derivatives are provided for faster publishing.

## Product truth boundary

Sync Stone pairs a Controller and Player in the same browser profile on one device. Uploaded audio remains local in browser storage. The chooser recognizes 254 researched audio extension aliases, but a selected file must still be decodable by the active browser; this release does not claim universal transcoding or cross-device transport.

## Public links

- App: <https://mayowa-007.github.io/sync-stone-soundboard/>
- Campaign gallery: <https://mayowa-007.github.io/sync-stone-soundboard/marketing/>
- Source: <https://github.com/MAYOWA-007/sync-stone-soundboard>

## Verify

From the repository root:

```sh
npm run marketing:verify
```

The check recomputes every SHA-256 digest, validates PNG dimensions and PDF signatures, confirms the manifest/file set is exact, and scans both public source text and binary metadata for restricted paths, credentials, and non-public brand references.
