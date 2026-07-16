# Sync Stone public format research

This GitHub Pages edition performs **no conversion**. Its file picker exposes 254 researched suffix aliases so a user can select a candidate, but the file becomes a cue only when this browser reads safe metadata and completes a real Web Audio decode. A suffix is never a guarantee.

## Common browser candidates

Current browsers commonly decode some combinations of:

```text
mp3 wav wave flac m4a m4b m4r mp4 mp4a aac webm weba ogg oga opus
```

Codec support varies by browser and operating system, including when two files share the same suffix.

## Future pipeline research inventory

The following aliases are research candidates for a separately tested media pipeline. They are **not supported-format claims for this public app**.

### Core fixture candidates — 50 aliases

```text
wav wave bwf bw64 rf64 w64 aif aiff aifc caf flac ape mac wv tta
mp3 mp2 m2a mpa aac adts loas m4a m4b m4r mp4 mp4a mov 3gp 3g2 3ga 3gpp 3gpp2
ogg oga opus spx webm weba mka mkv au snd amr awb ac3 eac3 ec3 wma asf
```

### Legacy, surround, speech, raw, and specialist — 70 aliases

```text
dts dtshd mlp thd shn tak sox voc avr sf ircam nist sph pvf rso
qoa iamf lc3 sbc msbc aptx aptxhd al ul sln sw sb uw ub
g722 722 gsm g729 bit tco rco g723_1 g728 dss dsf dff wsd
vqf vql vqe oma omg aa3 act rka wa bonk osq laf apc ac4
302 daud c2 dfpwm ilbc qcp mpc mpp mp+ mp1 8svx 16sv iff maud
```

### Game and console audio/container — 56 aliases

```text
acm adp dtk ads ss2 adx aea afc aix ast bfstm bcstm binka brstm
fsb fwse genh hca mca msf mtaf musx rsd sdns svag svs vag vpk
way xmd xvag xwma xa wve uv2 sol xmv thp str mve cpk pmp pva
rl2 rpl lxf mlv 4xm bmv roq smk bik bk2 usm mods moflex
```

### Tracker/module — 43 aliases

```text
669 amf ams dbm digi dmf dsm dtm far gdm ice imf it j2b m15 mdl
med mmcmp mms mo3 mod mptm mt2 mtm nst okt plm ppm psm pt36 ptm
s3m sfx sfx2 st26 stk stm stp ult umx wow xm xpk
```

### Multimedia containers that may contain audio — 35 aliases

```text
wmv avi flv f4v mpg mpeg mpe m2p vob ts m2ts mts mxf
rm ra rmvb qt dv dif m2t ogv ogm nut ty wtv dvr-ms gxf nsv
swf r3d ismv isma psp mj2 m4v
```

## Explicitly outside this picker

- Encrypted or DRM media.
- Playlists and external-reference files.
- Executable media scripts.
- DAW/project files.
- MIDI or notation without a dedicated synthesizer.
- Archives, packages, executables, corrupt files, and files with no decodable audio stream.

## Primary references

- [Web Audio decoding specification](https://www.w3.org/TR/webaudio/#dom-baseaudiocontext-decodeaudiodata)
- [HTML `canPlayType()` contract](https://html.spec.whatwg.org/multipage/media.html#dom-navigator-canplaytype)
- [MDN media container guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Containers)
- [FFmpeg format inventory](https://ffmpeg.org/general.html#File-Formats) — research reference only; this app does not bundle it
