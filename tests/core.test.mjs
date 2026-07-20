import test from "node:test";
import assert from "node:assert/strict";

import {
  APP_VERSION,
  IMPORT_ACCEPT_VALUE,
  IMPORT_EXTENSION_ALIASES,
  cleanLabel,
  computeReadiness,
  createDefaultBoard,
  createPublishedRevision,
  isCommandEligible,
  normalizeBoard,
} from "../js/core.js";

test("import picker exposes the researched 250-plus alias set without claiming conversion", () => {
  assert.ok(IMPORT_EXTENSION_ALIASES.length >= 250);
  assert.equal(new Set(IMPORT_EXTENSION_ALIASES).size, IMPORT_EXTENSION_ALIASES.length);
  assert.match(IMPORT_ACCEPT_VALUE, /audio\/\*/);
  assert.match(IMPORT_ACCEPT_VALUE, /\.wav/);
  assert.match(IMPORT_ACCEPT_VALUE, /\.mkv/);
  assert.match(IMPORT_ACCEPT_VALUE, /\.xm/);
});

test("default board has fixed 4x4 banks and useful demo cues", () => {
  const board = createDefaultBoard();
  assert.equal(board.banks.length, 3);
  assert.ok(board.banks.every((bank) => bank.pads.length === 16));
  assert.equal(board.banks[0].pads.filter((pad) => pad.asset).length, 12);
});

test("normalization restores pad invariants and removes control characters", () => {
  const board = normalizeBoard({
    name: "  Event\u0000 board  ",
    selectedBankId: "missing",
    banks: [{ id: "one", name: "Main", pads: [{ position: 0, label: "  Cue\nOne ", triggerMode: "invalid", color: "laser" }] }],
  });
  assert.equal(board.name, "Event board");
  assert.equal(board.selectedBankId, "one");
  assert.equal(board.banks[0].pads.length, 16);
  assert.equal(board.banks[0].pads[0].label, "Cue One");
  assert.equal(board.banks[0].pads[0].triggerMode, "play-stop");
  assert.equal(board.banks[0].pads[0].color, "slate");
});

test("published revisions exclude empty pads and carry immutable cue settings", () => {
  const board = createDefaultBoard();
  const revision = createPublishedRevision(board);
  assert.match(revision.id, /^rev-[a-f0-9]{8}$/);
  assert.equal(revision.banks[0].pads.length, 12);
  assert.equal(revision.banks[1].pads.length, 0);
  board.banks[0].pads[0].label = "Changed draft";
  assert.equal(revision.banks[0].pads[0].label, "Walk-on sting");
});

test("readiness is true only for a fresh visible Player on the exact revision", () => {
  const now = Date.now();
  const revision = { id: "rev-1" };
  const readyPresence = {
    seenAt: now,
    appVersion: APP_VERSION,
    audioContextState: "running",
    revisionId: "rev-1",
    assetsPrepared: true,
    visibility: "visible",
  };
  const ready = computeReadiness(readyPresence, revision);
  assert.deepEqual(ready, { connected: true, version: true, audio: true, revision: true, visible: true, ready: true });

  assert.equal(computeReadiness({ ...readyPresence, seenAt: now - 10_000 }, revision).ready, false);
  assert.equal(computeReadiness({ ...readyPresence, appVersion: "0.1.0" }, revision).version, false);
  assert.equal(computeReadiness({ ...readyPresence, appVersion: "0.1.0" }, revision).ready, false);
  assert.equal(computeReadiness({ seenAt: now, audioContextState: "suspended", revisionId: "rev-1", assetsPrepared: true, visibility: "visible" }, revision).ready, false);
});

test("command gate rejects stale, expired, standby, and mismatched commands", () => {
  const runtime = { mode: "live", epoch: 4, stopGeneration: 2, revisionId: "rev-a" };
  const command = { expiresAt: 2_000, epoch: 4, stopGeneration: 2, revisionId: "rev-a" };
  assert.equal(isCommandEligible(command, runtime, 1_000).ok, true);
  assert.equal(isCommandEligible({ ...command, expiresAt: 999 }, runtime, 1_000).code, "EXPIRED");
  assert.equal(isCommandEligible({ ...command, epoch: 3 }, runtime, 1_000).code, "STALE_EPOCH");
  assert.equal(isCommandEligible({ ...command, stopGeneration: 1 }, runtime, 1_000).code, "STALE_STOP_GENERATION");
  assert.equal(isCommandEligible({ ...command, revisionId: "rev-old" }, runtime, 1_000).code, "STALE_REVISION");
  assert.equal(isCommandEligible(command, { ...runtime, mode: "standby" }, 1_000).code, "STANDBY");
});

test("labels are bounded and whitespace normalized", () => {
  assert.equal(cleanLabel("  A   long\tlabel  ", 8), "A long l");
});
