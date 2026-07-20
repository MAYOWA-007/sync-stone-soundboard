export const APP_VERSION = "0.2.0";
export const APP_NAMESPACE = "sync-stone-soundboard-public:v1";
export const STORAGE_KEY = `${APP_NAMESPACE}:state`;
export const REVISION_KEY = `${APP_NAMESPACE}:published`;
export const ROOM_KEY = `${APP_NAMESPACE}:room`;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_DECODED_SECONDS = 45;
export const PAD_COLORS = ["cobalt", "teal", "emerald", "amber", "coral", "plum", "slate"];

const CORE_IMPORT_ALIASES = `
wav wave bwf bw64 rf64 w64 aif aiff aifc caf flac ape mac wv tta
mp3 mp2 m2a mpa aac adts loas m4a m4b m4r mp4 mp4a mov 3gp 3g2 3ga 3gpp 3gpp2
ogg oga opus spx webm weba mka mkv au snd amr awb ac3 eac3 ec3 wma asf
`;

const BEST_EFFORT_IMPORT_ALIASES = `
dts dtshd mlp thd shn tak sox voc avr sf ircam nist sph pvf rso
qoa iamf lc3 sbc msbc aptx aptxhd al ul sln sw sb uw ub
g722 722 gsm g729 bit tco rco g723_1 g728 dss dsf dff wsd
vqf vql vqe oma omg aa3 act rka wa bonk osq laf apc ac4
302 daud c2 dfpwm ilbc qcp mpc mpp mp+ mp1 8svx 16sv iff maud
acm adp dtk ads ss2 adx aea afc aix ast bfstm bcstm binka brstm
fsb fwse genh hca mca msf mtaf musx rsd sdns svag svs vag vpk
way xmd xvag xwma xa wve uv2 sol xmv thp str mve cpk pmp pva
rl2 rpl lxf mlv 4xm bmv roq smk bik bk2 usm mods moflex
669 amf ams dbm digi dmf dsm dtm far gdm ice imf it j2b m15 mdl
med mmcmp mms mo3 mod mptm mt2 mtm nst okt plm ppm psm pt36 ptm
s3m sfx sfx2 st26 stk stm stp ult umx wow xm xpk
wmv avi flv f4v mpg mpeg mpe m2p vob ts m2ts mts mxf
rm ra rmvb qt dv dif m2t ogv ogm nut ty wtv dvr-ms gxf nsv
swf r3d ismv isma psp mj2 m4v
`;

export const IMPORT_EXTENSION_ALIASES = Object.freeze(
  [...new Set(`${CORE_IMPORT_ALIASES} ${BEST_EFFORT_IMPORT_ALIASES}`.trim().split(/\s+/))],
);

export const IMPORT_ACCEPT_VALUE = Object.freeze(
  ["audio/*", ...IMPORT_EXTENSION_ALIASES.map((extension) => `.${extension}`)].join(","),
);

const SHORTCUTS = ["1", "2", "3", "4", "Q", "W", "E", "R", "A", "S", "D", "F", "Z", "X", "C", "V"];

const DEMO_CUES = [
  {
    position: 0,
    label: "Walk-on sting",
    color: "cobalt",
    triggerMode: "restart",
    asset: { id: "synth-arrival", kind: "synth", preset: "arrival", name: "Built-in arrival tone", duration: 2.4 },
  },
  {
    position: 1,
    label: "Room tone",
    color: "teal",
    triggerMode: "loop-stop",
    fadeIn: 0.7,
    fadeOut: 1.1,
    asset: { id: "synth-room", kind: "synth", preset: "room", name: "Built-in room tone", duration: 8 },
  },
  {
    position: 2,
    label: "Attention",
    color: "amber",
    triggerMode: "play-stop",
    asset: { id: "synth-attention", kind: "synth", preset: "attention", name: "Built-in attention tone", duration: 1.45 },
  },
  {
    position: 3,
    label: "Scene shift",
    color: "plum",
    triggerMode: "overlap",
    asset: { id: "synth-shift", kind: "synth", preset: "shift", name: "Built-in scene-shift tone", duration: 1.8 },
  },
  {
    position: 4,
    label: "Applause swell",
    color: "coral",
    triggerMode: "overlap",
    fadeOut: 0.25,
    asset: { id: "synth-applause", kind: "synth", preset: "applause", name: "Built-in applause texture", duration: 2.7 },
  },
  {
    position: 5,
    label: "Confirm chime",
    color: "emerald",
    triggerMode: "restart",
    asset: { id: "synth-confirm", kind: "synth", preset: "confirm", name: "Built-in confirmation chime", duration: 1.4 },
  },
  {
    position: 6,
    label: "Low impact",
    color: "slate",
    triggerMode: "overlap",
    asset: { id: "synth-impact", kind: "synth", preset: "impact", name: "Built-in low impact", duration: 1.2 },
  },
  {
    position: 7,
    label: "Countdown 3 · 2 · 1",
    color: "amber",
    triggerMode: "restart",
    asset: { id: "synth-countdown", kind: "synth", preset: "countdown", name: "Built-in countdown", duration: 2 },
  },
  {
    position: 8,
    label: "Curtain close",
    color: "plum",
    triggerMode: "play-stop",
    fadeOut: 0.2,
    asset: { id: "synth-curtain", kind: "synth", preset: "curtain", name: "Built-in curtain tone", duration: 1.8 },
  },
  {
    position: 9,
    label: "Intermission bed",
    color: "teal",
    triggerMode: "loop-stop",
    fadeIn: 0.8,
    fadeOut: 1.2,
    asset: { id: "synth-intermission", kind: "synth", preset: "intermission", name: "Built-in intermission bed", duration: 8 },
  },
  {
    position: 10,
    label: "Alert pulse",
    color: "coral",
    triggerMode: "play-stop",
    asset: { id: "synth-alert", kind: "synth", preset: "alert", name: "Built-in alert pulse", duration: 1.6 },
  },
  {
    position: 11,
    label: "Resolve",
    color: "cobalt",
    triggerMode: "restart",
    asset: { id: "synth-resolve", kind: "synth", preset: "resolve", name: "Built-in resolution chord", duration: 2.2 },
  },
];

function createPad(bankId, position, overrides = {}) {
  return {
    id: `${bankId}-pad-${position + 1}`,
    position,
    shortcut: SHORTCUTS[position],
    label: "",
    color: "slate",
    triggerMode: "play-stop",
    fadeIn: 0,
    fadeOut: 0,
    exclusiveGroup: null,
    asset: null,
    peaks: [],
    ...overrides,
  };
}

function createBank(id, name, cueOverrides = []) {
  const byPosition = new Map(cueOverrides.map((cue) => [cue.position, cue]));
  return {
    id,
    name,
    pads: Array.from({ length: 16 }, (_, position) => createPad(id, position, byPosition.get(position))),
  };
}

export function createDefaultBoard() {
  return {
    id: "board-event-control",
    name: "Event Control",
    layout: "pad",
    draftVersion: 1,
    selectedBankId: "bank-on-air",
    updatedAt: new Date().toISOString(),
    banks: [
      createBank("bank-on-air", "On air", DEMO_CUES),
      createBank("bank-atmosphere", "Atmosphere"),
      createBank("bank-stingers", "Stingers"),
    ],
  };
}

export function normalizeBoard(input) {
  const fallback = createDefaultBoard();
  if (!input || typeof input !== "object" || !Array.isArray(input.banks) || !input.banks.length) return fallback;

  const banks = input.banks.map((bank, bankIndex) => {
    const id = typeof bank.id === "string" ? bank.id : `bank-${bankIndex + 1}`;
    const sourcePads = Array.isArray(bank.pads) ? bank.pads : [];
    return {
      id,
      name: cleanLabel(bank.name || `Bank ${bankIndex + 1}`, 28),
      pads: Array.from({ length: 16 }, (_, position) => {
        const pad = sourcePads.find((candidate) => candidate.position === position) || sourcePads[position] || {};
        return createPad(id, position, {
          ...pad,
          id: typeof pad.id === "string" ? pad.id : `${id}-pad-${position + 1}`,
          position,
          shortcut: SHORTCUTS[position],
          label: cleanLabel(pad.label || "", 48),
          color: PAD_COLORS.includes(pad.color) ? pad.color : "slate",
          triggerMode: ["play-stop", "overlap", "restart", "hold", "loop-stop"].includes(pad.triggerMode)
            ? pad.triggerMode
            : "play-stop",
          fadeIn: clampNumber(pad.fadeIn, 0, 10, 0),
          fadeOut: clampNumber(pad.fadeOut, 0, 10, 0),
          peaks: Array.isArray(pad.peaks) ? pad.peaks.slice(0, 120).map((peak) => clampNumber(peak, 0, 1, 0)) : [],
        });
      }),
    };
  });

  return {
    ...fallback,
    ...input,
    id: "board-event-control",
    name: cleanLabel(input.name || fallback.name, 48),
    layout: "pad",
    draftVersion: Math.max(1, Number(input.draftVersion) || 1),
    selectedBankId: banks.some((bank) => bank.id === input.selectedBankId) ? input.selectedBankId : banks[0].id,
    banks,
  };
}

export function cleanLabel(value, maxLength = 48) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function clampNumber(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function createId(prefix = "evt") {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

export function createRoomCode() {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function triggerModeLabel(mode) {
  return ({
    "play-stop": "Play / Stop",
    overlap: "Play / Overlap",
    restart: "Play / Restart",
    hold: "Hold",
    "loop-stop": "Loop / Stop",
  })[mode] || "Play / Stop";
}

export function formatDuration(seconds) {
  if (!Number.isFinite(Number(seconds))) return "—";
  const value = Math.max(0, Number(seconds));
  const minutes = Math.floor(value / 60);
  const remainder = value - minutes * 60;
  return minutes ? `${minutes}:${remainder.toFixed(1).padStart(4, "0")}` : `${remainder.toFixed(1)}s`;
}

export function getSelectedBank(board) {
  return board.banks.find((bank) => bank.id === board.selectedBankId) || board.banks[0];
}

export function getPad(board, padId) {
  for (const bank of board.banks) {
    const pad = bank.pads.find((candidate) => candidate.id === padId);
    if (pad) return pad;
  }
  return null;
}

export function computeReadiness(presence, revision, expectedVersion = APP_VERSION) {
  const connected = Boolean(presence && Date.now() - Number(presence.seenAt || 0) < 8_000);
  const version = connected && presence.appVersion === expectedVersion;
  const audio = connected && presence.audioContextState === "running";
  const revisionMatch = audio && Boolean(revision?.id) && presence.revisionId === revision.id && presence.assetsPrepared === true;
  const visible = connected && presence.visibility === "visible";
  return {
    connected,
    version,
    audio,
    revision: revisionMatch,
    visible,
    ready: connected && version && audio && revisionMatch && visible,
  };
}

export function isCommandEligible(command, runtime, now = Date.now()) {
  if (!command || typeof command !== "object") return { ok: false, code: "INVALID" };
  if (Number(command.expiresAt) <= now) return { ok: false, code: "EXPIRED" };
  if (Number(command.epoch) !== Number(runtime.epoch)) return { ok: false, code: "STALE_EPOCH" };
  if (Number(command.stopGeneration) !== Number(runtime.stopGeneration)) return { ok: false, code: "STALE_STOP_GENERATION" };
  if (command.revisionId !== runtime.revisionId) return { ok: false, code: "STALE_REVISION" };
  if (runtime.mode !== "live") return { ok: false, code: "STANDBY" };
  return { ok: true, code: null };
}

export function createPublishedRevision(board) {
  const manifest = {
    schemaVersion: 1,
    boardId: board.id,
    boardName: board.name,
    createdAt: new Date().toISOString(),
    banks: board.banks.map((bank) => ({
      id: bank.id,
      name: bank.name,
      pads: bank.pads.filter((pad) => pad.asset).map((pad) => ({
        id: pad.id,
        position: pad.position,
        shortcut: pad.shortcut,
        label: pad.label,
        color: pad.color,
        triggerMode: pad.triggerMode,
        fadeIn: clampNumber(pad.fadeIn, 0, 10, 0),
        fadeOut: clampNumber(pad.fadeOut, 0, 10, 0),
        exclusiveGroup: pad.exclusiveGroup || null,
        asset: structuredCloneSafe(pad.asset),
      })),
    })),
  };
  const hash = fnv1a(JSON.stringify(manifest));
  return { ...manifest, id: `rev-${hash}`, manifestHash: `fnv1a:${hash}` };
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
