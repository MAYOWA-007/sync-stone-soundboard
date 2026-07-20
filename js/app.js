import {
  APP_VERSION,
  APP_NAMESPACE,
  IMPORT_ACCEPT_VALUE,
  MAX_DECODED_SECONDS,
  MAX_FILE_BYTES,
  PAD_COLORS,
  cleanLabel,
  clampNumber,
  computeReadiness,
  createDefaultBoard,
  createId,
  createPublishedRevision,
  formatDuration,
  getPad,
  getSelectedBank,
  isCommandEligible,
  triggerModeLabel,
} from "./core.js";
import { AudioEngine, inspectAudioFile } from "./audio-engine.js";
import {
  deleteAsset,
  getRoomCode,
  listAssets,
  loadBoard,
  loadRevision,
  putAsset,
  requestPersistentStorage,
  saveBoard,
  saveRevision,
} from "./storage.js";

const params = new URLSearchParams(location.search);
const isPlayer = params.get("view") === "player";
const roomCode = getRoomCode(params.get("room"));
const channel = "BroadcastChannel" in globalThis ? new BroadcastChannel(`${APP_NAMESPACE}:room:${roomCode}`) : null;
const APP_UPDATE_EVENT = "sync-stone:update-required";
let pendingAppUpdateVersion = null;
document.body.dataset.view = isPlayer ? "player" : "controller";

if (isPlayer) initPlayer();
else initController();
setupAppUpdateUi();
registerOfflineShell();

function initController() {
  const app = document.querySelector("#app");
  const playerView = document.querySelector("#player-view");
  app.hidden = false;
  playerView.hidden = true;

  let board = loadBoard();
  let revision = loadRevision();
  let selectedPadId = null;
  let workspaceMode = "edit";
  let presence = null;
  let primaryDeviceId = null;
  let activeVoices = [];
  let saveTimer = null;
  let requestedTimer = null;
  let triggerView = false;
  let triggerViewEnteredFullscreen = false;
  const heldPointers = new Map();
  const heldKeys = new Map();
  const pendingCommands = new Map();
  const runtime = {
    mode: "standby",
    epoch: 1,
    seq: 0,
    stopGeneration: 0,
    revisionId: revision?.id || null,
    primaryDeviceId: null,
  };

  const localEngine = new AudioEngine();
  const elements = mapElements({
    bankList: "#bank-list",
    boardGrid: "#board-grid",
    boardTitle: "#board-title",
    boardEyebrow: "#board-eyebrow",
    draftState: "#draft-state",
    cueForm: "#cue-form",
    inspector: "#inspector",
    inspectorEmpty: "#inspector-empty",
    inspectorTitle: "#inspector-title",
    cueLabel: "#cue-label",
    cueFile: "#cue-file",
    fileName: "#file-name",
    triggerMode: "#trigger-mode",
    fadeIn: "#fade-in",
    fadeOut: "#fade-out",
    colorOptions: "#color-options",
    shortcutChip: "#shortcut-chip",
    cueDuration: "#cue-duration",
    waveform: "#waveform",
    formStatus: "#form-status",
    readinessButton: "#readiness-button",
    readinessPopover: "#readiness-popover",
    playerSummary: "#player-summary",
    liveToggle: "#live-toggle",
    masterLevel: "#master-level",
    masterOutput: "#master-output",
    mobileBankSelect: "#mobile-bank-select",
    mobileMasterLevel: "#mobile-master-level",
    mobileMasterOutput: "#mobile-master-output",
    triggerToolbar: "#trigger-toolbar",
    triggerViewToggle: "#trigger-view-toggle",
    triggerBankSelect: "#trigger-bank-select",
    triggerPlayerStatus: "#trigger-player-status",
    triggerMasterLevel: "#trigger-master-level",
    triggerMasterOutput: "#trigger-master-output",
    triggerFullscreen: "#trigger-fullscreen",
    readinessLive: "#readiness-live",
    voiceList: "#voice-list",
    voiceCount: "#voice-count",
    nowPlaying: ".now-playing",
    notesDialog: "#notes-dialog",
  });
  elements.cueFile.accept = IMPORT_ACCEPT_VALUE;

  for (const color of PAD_COLORS) {
    const button = document.createElement("button");
    button.className = "color-option";
    button.type = "button";
    button.dataset.color = color;
    button.style.setProperty("--swatch", `var(--${color})`);
    button.setAttribute("aria-label", `${capitalize(color)} stone color`);
    elements.colorOptions.append(button);
  }

  renderAll();
  updateReadiness();
  setInterval(updatePresenceFreshness, 2_000);
  setInterval(() => channel?.postMessage({ type: "controller.presence", appVersion: APP_VERSION, targetDeviceId: primaryDeviceId, sentAt: Date.now() }), 2_000);
  addEventListener(APP_UPDATE_EVENT, () => {
    if (runtime.mode === "live") setSessionMode("standby", "An app update is ready. Live was disarmed until both windows reload.");
    else updateReadiness();
  });

  channel?.addEventListener("message", ({ data }) => {
    if (!data || typeof data !== "object") return;
    if (data.type === "player.offline" && data.deviceId === primaryDeviceId) {
      releasePrimaryPlayer(runtime.mode === "live" ? "The Player window closed. Session returned to Standby." : null);
      return;
    }
    if (data.type === "presence") {
      if (!primaryDeviceId) {
        primaryDeviceId = data.presence?.deviceId || null;
        runtime.primaryDeviceId = primaryDeviceId;
      }
      if (!primaryDeviceId || data.presence?.deviceId !== primaryDeviceId) return;
      presence = { ...data.presence, seenAt: Date.now() };
      const before = runtime.mode;
      updateReadiness();
      if (before === "live" && !computeReadiness(presence, revision).ready) setSessionMode("standby", "Player readiness was lost.");
    }
    if (data.type === "command.ack" && data.deviceId === primaryDeviceId) handleAcknowledgement(data.ack);
    if (data.type === "voices") {
      if (data.deviceId !== primaryDeviceId) return;
      activeVoices = Array.isArray(data.voices) ? data.voices : [];
      renderVoices();
      renderGrid();
    }
    if (data.type === "player.request-state") {
      if (!primaryDeviceId) {
        primaryDeviceId = data.deviceId || null;
        runtime.primaryDeviceId = primaryDeviceId;
      }
      if (data.deviceId !== primaryDeviceId) return;
      if (revision) postToPlayer({ type: "revision.prepare", revision, runtime });
      postToPlayer({ type: "session.set", runtime });
      postToPlayer({ type: "master.set", db: Number(elements.masterLevel.value) });
    }
  });

  document.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => setWorkspaceMode(button.dataset.mode));
  });
  document.querySelectorAll(".mobile-mode-button").forEach((button) => {
    button.addEventListener("click", () => setWorkspaceMode(button.dataset.mobileMode));
  });

  elements.bankList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-bank-id]");
    if (!button) return;
    releaseAllHeldPads();
    board.selectedBankId = button.dataset.bankId;
    selectedPadId = null;
    saveDraftNow();
    renderAll();
  });
  elements.mobileBankSelect.addEventListener("change", () => {
    releaseAllHeldPads();
    board.selectedBankId = elements.mobileBankSelect.value;
    selectedPadId = null;
    saveDraftNow();
    renderAll();
  });
  elements.triggerBankSelect.addEventListener("change", () => {
    releaseAllHeldPads();
    board.selectedBankId = elements.triggerBankSelect.value;
    selectedPadId = null;
    saveDraftNow();
    renderAll();
  });

  elements.boardGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pad-id]");
    if (!button) return;
    const pad = getPad(board, button.dataset.padId);
    if (!pad) return;
    if (workspaceMode === "edit") {
      selectedPadId = pad.id;
      renderGrid();
      renderInspector();
      elements.inspector.classList.add("is-open");
    } else {
      const performancePad = getPerformancePad(pad.id);
      if (performancePad?.asset && performancePad.triggerMode !== "hold") sendPadCommand(performancePad, "press");
    }
  });

  elements.boardGrid.addEventListener("pointerdown", (event) => {
    if (workspaceMode !== "perform") return;
    const button = event.target.closest("[data-pad-id]");
    const pad = button && getPerformancePad(button.dataset.padId);
    if (!pad?.asset || pad.triggerMode !== "hold") return;
    heldPointers.set(event.pointerId, pad.id);
    button.setPointerCapture?.(event.pointerId);
    sendPadCommand(pad, "press");
  });

  const releasePointerHold = (event) => {
    const padId = heldPointers.get(event.pointerId);
    if (!padId) return;
    heldPointers.delete(event.pointerId);
    releaseHeldPad(padId);
  };
  addEventListener("pointerup", releasePointerHold, true);
  addEventListener("pointercancel", releasePointerHold, true);
  elements.boardGrid.addEventListener("keydown", (event) => {
    const button = event.target.closest("[data-pad-id]");
    if (button && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      focusGridNeighbor(button, event.key, event.ctrlKey || event.metaKey);
      return;
    }
    if (workspaceMode !== "perform" || event.repeat || !["Enter", " "].includes(event.key)) return;
    const pad = button && getPerformancePad(button.dataset.padId);
    if (pad?.asset && pad.triggerMode === "hold") {
      event.preventDefault();
      heldKeys.set(event.code || event.key, pad.id);
      sendPadCommand(pad, "press");
    }
  });
  addEventListener("keyup", (event) => {
    const key = event.code || event.key;
    const padId = heldKeys.get(key);
    if (!padId) return;
    event.preventDefault();
    heldKeys.delete(key);
    releaseHeldPad(padId);
  });

  elements.cueForm.addEventListener("input", (event) => {
    if (event.target === elements.cueFile) return;
    updatePadFromForm();
    scheduleDraftSave();
  });
  elements.cueForm.addEventListener("change", (event) => {
    if (event.target === elements.cueFile) return;
    updatePadFromForm();
    scheduleDraftSave();
  });

  elements.colorOptions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-color]");
    const pad = getPad(board, selectedPadId);
    if (!button || !pad) return;
    pad.color = button.dataset.color;
    markDraftChanged();
    scheduleDraftSave();
    renderGrid();
    renderInspectorColors(pad);
  });

  elements.cueFile.addEventListener("change", async () => {
    const file = elements.cueFile.files?.[0];
    const pad = getPad(board, selectedPadId);
    if (!file || !pad) return;
    const previousAsset = pad.asset;
    elements.formStatus.textContent = "Analyzing audio…";
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error("This feasibility build accepts files up to 25 MB.");
      const analysis = await inspectAudioFile(file);
      if (analysis.duration > MAX_DECODED_SECONDS) throw new Error("Use a cue no longer than 45 seconds in this feasibility build.");
      const assetId = createId("asset");
      await putAsset({
        id: assetId,
        blob: file,
        name: cleanLabel(file.name, 120),
        type: file.type,
        size: file.size,
        duration: analysis.duration,
        createdAt: new Date().toISOString(),
      });
      pad.asset = {
        id: assetId,
        kind: "file",
        name: cleanLabel(file.name, 120),
        type: file.type || "audio/unknown",
        size: file.size,
        duration: analysis.duration,
        channels: analysis.channels,
        sampleRate: analysis.sampleRate,
      };
      pad.peaks = analysis.peaks;
      if (!pad.label) pad.label = cleanLabel(file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "), 48);
      markDraftChanged();
      saveDraftNow();
      renderGrid();
      renderInspector();
      if (previousAsset?.kind === "file" && !assetIsReferenced(previousAsset.id)) await deleteAsset(previousAsset.id).catch(() => {});
      elements.formStatus.textContent = "Audio is ready and stored only in this browser.";
      toast("Audio analyzed and added to the stone.", "success");
    } catch (error) {
      elements.cueFile.value = "";
      elements.formStatus.textContent = error.message;
      toast(error.message, "error");
    }
  });

  document.querySelector("#audition-cue").addEventListener("click", async () => {
    const pad = getPad(board, selectedPadId);
    if (!pad?.asset) return toast("Add audio to this stone before auditioning.", "error");
    try {
      await localEngine.trigger(pad, "press");
      toast(`Auditioning ${pad.label || "cue"} on this device.`);
    } catch (error) {
      toast(error.message, "error");
    }
  });

  document.querySelector("#clear-cue").addEventListener("click", async () => {
    const pad = getPad(board, selectedPadId);
    if (!pad) return;
    const previousAsset = pad.asset;
    Object.assign(pad, { label: "", asset: null, peaks: [], triggerMode: "play-stop", fadeIn: 0, fadeOut: 0 });
    if (previousAsset?.kind === "file" && !assetIsReferenced(previousAsset.id)) await deleteAsset(previousAsset.id).catch(() => {});
    markDraftChanged();
    saveDraftNow();
    renderGrid();
    renderInspector();
  });

  document.querySelector("#publish-board").addEventListener("click", () => {
    const assigned = board.banks.flatMap((bank) => bank.pads).filter((pad) => pad.asset);
    if (!assigned.length) return toast("Add at least one audio cue before publishing.", "error");
    setSessionMode("standby");
    revision = createPublishedRevision(board);
    saveRevision(revision);
    runtime.revisionId = revision.id;
    postToPlayer({ type: "revision.prepare", revision, runtime });
    postToPlayer({ type: "session.set", runtime });
    toast(`Published ${revision.id}. The Player is preparing it.`, "success");
    updateReadiness();
  });

  elements.liveToggle.addEventListener("click", () => {
    if (runtime.mode === "live") setSessionMode("standby");
    else setSessionMode("live");
  });

  document.querySelector("#stop-all").addEventListener("click", () => {
    clearHeldInputs();
    runtime.stopGeneration += 1;
    postToPlayer({ type: "runtime.stop-all", stopGeneration: runtime.stopGeneration });
    activeVoices = [];
    renderVoices();
    renderGrid();
    toast("Stop all sent.");
  });

  document.querySelector("#fade-all").addEventListener("click", () => {
    runtime.stopGeneration += 1;
    postToPlayer({ type: "runtime.fade-all", seconds: 1, stopGeneration: runtime.stopGeneration });
    toast("Fading all cues over one second.");
  });

  elements.masterLevel.addEventListener("input", () => {
    syncMaster(Number(elements.masterLevel.value));
  });
  elements.mobileMasterLevel.addEventListener("input", () => {
    syncMaster(Number(elements.mobileMasterLevel.value));
  });
  elements.triggerMasterLevel.addEventListener("input", () => syncMaster(Number(elements.triggerMasterLevel.value)));

  elements.triggerViewToggle.addEventListener("click", () => enterTriggerView());
  document.querySelector("#exit-trigger-view").addEventListener("click", () => exitTriggerView());
  document.querySelector("#trigger-fade-all").addEventListener("click", () => document.querySelector("#fade-all").click());
  document.querySelector("#trigger-stop-all").addEventListener("click", () => document.querySelector("#stop-all").click());
  elements.triggerFullscreen.addEventListener("click", () => requestControllerFullscreen({ announce: true }));
  elements.readinessLive.addEventListener("click", () => enterTriggerView());

  document.querySelector("#open-player").addEventListener("click", openPlayerWindow);
  elements.readinessButton.addEventListener("click", () => toggleReadiness());
  document.querySelector("#close-readiness").addEventListener("click", () => toggleReadiness(false));
  document.addEventListener("pointerdown", (event) => {
    if (elements.readinessPopover.hidden) return;
    if (!elements.readinessPopover.contains(event.target) && !elements.readinessButton.contains(event.target)) toggleReadiness(false);
  });

  document.querySelector("#add-bank").addEventListener("click", () => {
    const name = cleanLabel(prompt("Name this bank", `Bank ${board.banks.length + 1}`), 28);
    if (!name) return;
    const template = createDefaultBoard().banks[1];
    const bankId = createId("bank");
    board.banks.push({
      id: bankId,
      name,
      pads: template.pads.map((pad) => ({ ...pad, id: `${bankId}-pad-${pad.position + 1}` })),
    });
    board.selectedBankId = bankId;
    selectedPadId = null;
    markDraftChanged();
    saveDraftNow();
    renderAll();
  });

  document.querySelector("#show-library").addEventListener("click", async () => {
    const assets = await listAssets().catch(() => []);
    toast(`${assets.length} uploaded audio ${assets.length === 1 ? "file is" : "files are"} stored in this browser.`);
  });
  document.querySelector("#show-notes").addEventListener("click", () => elements.notesDialog.showModal());
  elements.notesDialog.querySelector(".dialog-close").addEventListener("click", () => elements.notesDialog.close());
  document.querySelector("#close-inspector").addEventListener("click", () => elements.inspector.classList.remove("is-open"));
  document.querySelector("#tray-toggle").addEventListener("click", (event) => {
    const collapsed = elements.nowPlaying.classList.toggle("is-collapsed");
    event.currentTarget.setAttribute("aria-expanded", String(!collapsed));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (triggerView) {
        exitTriggerView();
        return;
      }
      elements.inspector.classList.remove("is-open");
      toggleReadiness(false);
      return;
    }
    if (workspaceMode !== "perform" || event.repeat || isTypingTarget(event.target)) return;
    const shortcutPad = getSelectedBank(board).pads.find((candidate) => candidate.shortcut.toLowerCase() === event.key.toLowerCase());
    const pad = shortcutPad && getPerformancePad(shortcutPad.id);
    if (!pad?.asset) return;
    event.preventDefault();
    if (pad.triggerMode === "hold") heldKeys.set(event.code || event.key, pad.id);
    sendPadCommand(pad, "press");
  });
  addEventListener("blur", releaseAllHeldPads);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") releaseAllHeldPads();
  });

  function renderAll() {
    elements.boardTitle.textContent = board.name;
    const bankIndex = board.banks.findIndex((bank) => bank.id === board.selectedBankId);
    elements.boardEyebrow.textContent = `LIVE EVENT / BANK ${String(bankIndex + 1).padStart(2, "0")}`;
    renderBanks();
    renderGrid();
    renderInspector();
    renderVoices();
  }

  function renderBanks() {
    elements.bankList.innerHTML = board.banks.map((bank, index) => `
      <button class="bank-button ${bank.id === board.selectedBankId ? "is-active" : ""}" type="button" data-bank-id="${escapeHtml(bank.id)}" aria-pressed="${bank.id === board.selectedBankId}">
        <span>${String(index + 1).padStart(2, "0")}</span><span>${escapeHtml(bank.name)}</span>
      </button>`).join("");
    elements.mobileBankSelect.innerHTML = board.banks.map((bank) => `<option value="${escapeHtml(bank.id)}" ${bank.id === board.selectedBankId ? "selected" : ""}>${escapeHtml(bank.name)}</option>`).join("");
    elements.triggerBankSelect.innerHTML = board.banks.map((bank) => `<option value="${escapeHtml(bank.id)}" ${bank.id === board.selectedBankId ? "selected" : ""}>${escapeHtml(bank.name)}</option>`).join("");
  }

  function renderGrid() {
    const focusedPadId = document.activeElement?.closest?.("[data-pad-id]")?.dataset.padId || null;
    const draftBank = getSelectedBank(board);
    const publishedBank = revision?.banks?.find((bank) => bank.id === draftBank.id);
    const pads = workspaceMode === "perform" && revision
      ? draftBank.pads.map((draftPad) => {
          const publishedPad = publishedBank?.pads?.find((candidate) => candidate.position === draftPad.position);
          if (!publishedPad) return { ...draftPad, label: "", asset: null, peaks: [] };
          return { ...draftPad, ...publishedPad, peaks: publishedPad.asset?.id === draftPad.asset?.id ? draftPad.peaks : [] };
        })
      : draftBank.pads;
    const playingPadIds = new Set(activeVoices.map((voice) => voice.padId));
    elements.boardGrid.innerHTML = pads.map((pad) => {
      if (!pad.asset) {
        const disabled = workspaceMode === "perform" ? " disabled aria-disabled=\"true\"" : "";
        return `<button class="sound-pad is-empty ${selectedPadId === pad.id ? "is-selected" : ""}" type="button" data-pad-id="${escapeHtml(pad.id)}" data-pad-position="${pad.position}" aria-label="Empty stone ${pad.position + 1}, shortcut ${pad.shortcut}"${disabled}>
          <span class="empty-plus">+</span><span>Empty stone</span><span class="pad-shortcut">${pad.shortcut}</span>
        </button>`;
      }
      const bars = Array.from({ length: 12 }, (_, index) => {
        const peak = pad.peaks?.length ? pad.peaks[Math.floor(index * pad.peaks.length / 12)] : .2 + ((index * 7 + pad.position * 3) % 8) / 10;
        return `<i style="--bar:${Math.max(18, Math.round(peak * 100))}%"></i>`;
      }).join("");
      const audibleState = playingPadIds.has(pad.id) ? "playing" : "ready";
      const pressed = workspaceMode === "edit"
        ? ` aria-pressed="${selectedPadId === pad.id}"`
        : ["play-stop", "loop-stop"].includes(pad.triggerMode) ? ` aria-pressed="${playingPadIds.has(pad.id)}"` : "";
      return `<button class="sound-pad ${selectedPadId === pad.id ? "is-selected" : ""} ${playingPadIds.has(pad.id) ? "is-playing" : ""}" type="button" data-pad-id="${escapeHtml(pad.id)}" data-pad-position="${pad.position}" style="--pad-color:var(--${pad.color})" aria-label="${escapeHtml(pad.label)}, ${triggerModeLabel(pad.triggerMode)}, ${audibleState}, shortcut ${pad.shortcut}" aria-keyshortcuts="${pad.shortcut}"${pressed}>
        <span class="pad-top"><span class="pad-state">${playingPadIds.has(pad.id) ? "Playing" : "Ready"}</span><span class="pad-shortcut">${pad.shortcut}</span></span>
        <strong class="pad-label">${escapeHtml(pad.label || pad.asset.name)}</strong>
        <span class="pad-footer"><span>${escapeHtml(modeShortLabel(pad.triggerMode))}</span><span class="pad-wave" aria-hidden="true">${bars}</span><span>${formatDuration(pad.asset.duration)}</span></span>
      </button>`;
    }).join("");
    if (focusedPadId) elements.boardGrid.querySelector(`[data-pad-id="${CSS.escape(focusedPadId)}"]:not(:disabled)`)?.focus({ preventScroll: true });
  }

  function focusGridNeighbor(button, key, wholeGrid) {
    const current = Number(button.dataset.padPosition);
    const rowStart = Math.floor(current / 4) * 4;
    if (["Home", "End"].includes(key)) {
      const positions = wholeGrid
        ? Array.from({ length: 16 }, (_, index) => index)
        : Array.from({ length: 4 }, (_, index) => rowStart + index);
      if (key === "End") positions.reverse();
      for (const position of positions) {
        const candidate = elements.boardGrid.querySelector(`[data-pad-position="${position}"]:not(:disabled)`);
        if (candidate) {
          candidate.focus({ preventScroll: true });
          return;
        }
      }
      return;
    }
    if (key === "ArrowLeft" && current === rowStart) return;
    if (key === "ArrowRight" && current === rowStart + 3) return;
    if (key === "ArrowUp" && current < 4) return;
    if (key === "ArrowDown" && current >= 12) return;
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 })[key];
    if (!step) return;
    let target = current + step;
    while (target >= 0 && target < 16) {
      const candidate = elements.boardGrid.querySelector(`[data-pad-position="${target}"]:not(:disabled)`);
      if (candidate) {
        candidate.focus({ preventScroll: true });
        return;
      }
      target += step;
      if (["ArrowLeft", "ArrowRight"].includes(key) && Math.floor(target / 4) !== Math.floor(current / 4)) return;
    }
  }

  function renderInspector() {
    const pad = getPad(board, selectedPadId);
    elements.inspectorEmpty.hidden = Boolean(pad);
    elements.cueForm.hidden = !pad;
    if (!pad) return;
    elements.inspectorTitle.textContent = pad.label || `Stone ${pad.position + 1}`;
    elements.cueLabel.value = pad.label;
    elements.fileName.textContent = pad.asset?.name || "Choose a file";
    elements.triggerMode.value = pad.triggerMode;
    elements.fadeIn.value = pad.fadeIn;
    elements.fadeOut.value = pad.fadeOut;
    elements.shortcutChip.textContent = pad.shortcut;
    elements.cueDuration.textContent = pad.asset ? `${formatDuration(pad.asset.duration)} · ${pad.asset.kind === "synth" ? "demo tone" : "decoded audio"}` : "No audio loaded";
    elements.formStatus.textContent = pad.asset?.kind === "synth" ? "Built-in demo cue. Replace it with your own audio at any time." : "";
    renderInspectorColors(pad);
    drawWaveform(elements.waveform, pad.peaks, pad.color, pad.asset?.kind === "synth");
  }

  function renderInspectorColors(pad) {
    elements.colorOptions.querySelectorAll("[data-color]").forEach((button) => {
      const selected = button.dataset.color === pad.color;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", selected);
    });
  }

  function renderVoices() {
    const count = activeVoices.length;
    elements.voiceCount.textContent = `${count} ${count === 1 ? "voice" : "voices"}`;
    elements.nowPlaying.classList.toggle("has-voices", count > 0);
    if (!count) {
      elements.voiceList.innerHTML = "<p>No active cues. Scheduled acknowledgements appear here.</p>";
      return;
    }
    elements.voiceList.innerHTML = activeVoices.map((voice) => `
      <article class="voice-card"><strong>${escapeHtml(voice.label || "Cue")}</strong><small>${escapeHtml(voice.state || "playing")}</small><span>PLAYER</span></article>`).join("");
  }

  function updatePadFromForm() {
    const pad = getPad(board, selectedPadId);
    if (!pad) return;
    pad.label = cleanLabel(elements.cueLabel.value, 48);
    pad.triggerMode = elements.triggerMode.value;
    pad.fadeIn = clampNumber(elements.fadeIn.value, 0, 10, 0);
    pad.fadeOut = clampNumber(elements.fadeOut.value, 0, 10, 0);
    elements.inspectorTitle.textContent = pad.label || `Stone ${pad.position + 1}`;
    markDraftChanged();
    renderGrid();
  }

  function scheduleDraftSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraftNow, 750);
  }

  function saveDraftNow() {
    clearTimeout(saveTimer);
    board.draftVersion += 1;
    board.updatedAt = new Date().toISOString();
    board = saveBoard(board);
    elements.draftState.classList.remove("is-changed");
    elements.draftState.innerHTML = "<i></i> Draft saved locally";
  }

  function markDraftChanged() {
    elements.draftState.classList.add("is-changed");
    elements.draftState.innerHTML = "<i></i> Draft changed";
  }

  function setWorkspaceMode(mode) {
    workspaceMode = mode === "perform" ? "perform" : "edit";
    document.querySelectorAll(".mode-button").forEach((button) => {
      const active = button.dataset.mode === workspaceMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active);
    });
    document.querySelectorAll(".mobile-mode-button").forEach((button) => {
      const active = button.dataset.mobileMode === workspaceMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active);
    });
    if (workspaceMode === "perform") elements.inspector.classList.remove("is-open");
    renderGrid();
    toast(workspaceMode === "perform" ? "Perform mode: stones now send to the Player." : "Edit mode: stone presses only select cues.");
  }

  function setSessionMode(mode, reason) {
    if (mode === "live") {
      const readiness = computeReadiness(presence, revision);
      if (!readiness.ready) return toast("The Player must pass every readiness check before Live.", "error");
      runtime.mode = "live";
      runtime.epoch += 1;
      elements.liveToggle.classList.add("is-live");
      elements.liveToggle.querySelector("strong").textContent = "Live";
      elements.liveToggle.setAttribute("aria-pressed", "true");
      setWorkspaceMode("perform");
      toast("Session is Live. Stone presses route to the Player.", "success");
    } else {
      runtime.mode = "standby";
      runtime.epoch += 1;
      runtime.stopGeneration += 1;
      clearHeldInputs();
      for (const timeout of pendingCommands.values()) clearTimeout(timeout);
      pendingCommands.clear();
      elements.liveToggle.classList.remove("is-live");
      elements.liveToggle.querySelector("strong").textContent = "Standby";
      elements.liveToggle.setAttribute("aria-pressed", "false");
      activeVoices = [];
      renderVoices();
      renderGrid();
      if (workspaceMode === "perform") setWorkspaceMode("edit");
      if (triggerView) exitTriggerView();
      if (reason) toast(reason, "error");
    }
    postToPlayer({ type: "session.set", runtime });
    updateReadiness();
  }

  function sendPadCommand(pad, action) {
    const readiness = computeReadiness(presence, revision);
    if (runtime.mode !== "live") return toast("Session is in Standby. Enter Live before triggering cues.", "error");
    if (!readiness.ready) {
      setSessionMode("standby", "Player readiness was lost. Session returned to Standby.");
      return;
    }
    runtime.seq += 1;
    const command = {
      v: 1,
      eventId: createId("evt"),
      type: action === "release" ? "pad.release" : "pad.trigger",
      padId: pad.id,
      label: pad.label,
      epoch: runtime.epoch,
      seq: runtime.seq,
      stopGeneration: runtime.stopGeneration,
      revisionId: revision.id,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 2_000,
      action,
    };
    postToPlayer({ type: "command", command });
    const timeout = setTimeout(() => {
      pendingCommands.delete(command.eventId);
      setSessionMode("standby", `${pad.label || "Cue"} was not acknowledged. Player readiness was revoked.`);
    }, 1_200);
    pendingCommands.set(command.eventId, timeout);
    const padElement = elements.boardGrid.querySelector(`[data-pad-id="${CSS.escape(pad.id)}"]`);
    padElement?.classList.add("is-requested");
    clearTimeout(requestedTimer);
    requestedTimer = setTimeout(() => padElement?.classList.remove("is-requested"), 160);
  }

  function handleAcknowledgement(ack) {
    if (!ack) return;
    const timeout = pendingCommands.get(ack.commandId);
    if (timeout) clearTimeout(timeout);
    pendingCommands.delete(ack.commandId);
    if (ack.status === "rejected") {
      setSessionMode("standby", `Player rejected the cue: ${ack.errorCode}. Live was disarmed.`);
      return;
    }
  }

  function updateReadiness() {
    const readiness = computeReadiness(presence, revision);
    const summary = readiness.ready
      ? "Ready"
      : readiness.connected && !readiness.version
        ? "Update required"
        : readiness.connected
          ? presence?.stateLabel || "Needs attention"
          : "Not connected";
    elements.playerSummary.textContent = summary;
    elements.triggerPlayerStatus.textContent = summary;
    elements.triggerPlayerStatus.closest(".trigger-readiness").classList.toggle("is-ready", readiness.ready);
    elements.readinessButton.classList.toggle("is-ready", readiness.ready);
    elements.liveToggle.disabled = !readiness.ready && runtime.mode !== "live";
    elements.readinessLive.disabled = !readiness.ready;
    elements.readinessLive.textContent = runtime.mode === "live" ? "Open Trigger View" : "Enter Live & Trigger View";

    const details = {
      connected: [readiness.connected, readiness.connected ? "Local controller link active" : "Waiting for the Player window"],
      version: [readiness.version, readiness.version ? `Both windows use ${APP_VERSION}` : readiness.connected ? "Reload both windows so their app versions match" : "Waiting for the Player app version"],
      audio: [readiness.audio, readiness.audio ? "AudioContext is running" : "Requires a click on the playback computer"],
      revision: [readiness.revision, readiness.revision ? revision?.id : revision ? "Player is preparing the published board" : "Publish a board revision"],
      visible: [readiness.visible, readiness.visible ? "Player page is visible" : "Player must remain in the foreground"],
    };
    for (const [name, [ready, detail]] of Object.entries(details)) {
      const item = elements.readinessPopover.querySelector(`[data-check="${name}"]`);
      item.classList.toggle("is-ready", ready);
      item.querySelector("small").textContent = detail;
    }
  }

  function updatePresenceFreshness() {
    if (presence && Date.now() - presence.seenAt >= 8_000) {
      releasePrimaryPlayer(runtime.mode === "live" ? "Player connection timed out. Session returned to Standby." : null);
    }
  }

  function releasePrimaryPlayer(reason) {
    presence = null;
    primaryDeviceId = null;
    runtime.primaryDeviceId = null;
    for (const timeout of pendingCommands.values()) clearTimeout(timeout);
    pendingCommands.clear();
    if (runtime.mode === "live") setSessionMode("standby", reason || "Player readiness was lost.");
    else updateReadiness();
  }

  function toggleReadiness(force) {
    const open = typeof force === "boolean" ? force : elements.readinessPopover.hidden;
    elements.readinessPopover.hidden = !open;
    elements.readinessButton.setAttribute("aria-expanded", String(open));
  }

  function openPlayerWindow() {
    const url = new URL("./", location.href);
    url.searchParams.set("view", "player");
    url.searchParams.set("room", roomCode);
    const opened = window.open(url, "sync-stone-soundboard-public-player-v1", "popup,width=1180,height=760");
    if (!opened) toast("The browser blocked the Player window. Allow pop-ups, then try again.", "error");
  }

  function syncMaster(db) {
    const value = clampNumber(db, -60, 6, 0);
    const label = formatDb(value);
    elements.masterLevel.value = String(value);
    elements.mobileMasterLevel.value = String(value);
    elements.triggerMasterLevel.value = String(value);
    elements.masterOutput.textContent = label;
    elements.mobileMasterOutput.textContent = label;
    elements.triggerMasterOutput.textContent = label;
    postToPlayer({ type: "master.set", db: value });
  }

  function releaseHeldPad(padId) {
    const pad = getPerformancePad(padId);
    if (runtime.mode === "live" && pad?.asset && pad.triggerMode === "hold") sendPadCommand(pad, "release");
  }

  function releaseAllHeldPads() {
    const padIds = new Set([...heldPointers.values(), ...heldKeys.values()]);
    clearHeldInputs();
    for (const padId of padIds) releaseHeldPad(padId);
  }

  function clearHeldInputs() {
    heldPointers.clear();
    heldKeys.clear();
  }

  function requestControllerFullscreen({ announce = false } = {}) {
    if (document.fullscreenElement) {
      updateTriggerFullscreenControl();
      return Promise.resolve(true);
    }
    const supported = typeof document.documentElement.requestFullscreen === "function" && document.fullscreenEnabled !== false;
    if (!supported) {
      updateTriggerFullscreenControl(false);
      if (announce) toast("Fullscreen is unavailable here. Trigger View still fills the browser viewport.", "error");
      return Promise.resolve(false);
    }
    return document.documentElement.requestFullscreen({ navigationUI: "hide" })
      .then(() => {
        updateTriggerFullscreenControl(true);
        return true;
      })
      .catch(() => {
        updateTriggerFullscreenControl(false);
        if (announce) toast("Fullscreen was blocked. Use Full screen in the Trigger View toolbar to retry.", "error");
        return false;
      });
  }

  function enterTriggerView({ requestFullscreen = true } = {}) {
    if (!revision) return toast("Publish a board revision before opening Trigger View.", "error");
    if (runtime.mode !== "live") {
      const readiness = computeReadiness(presence, revision);
      if (!readiness.ready) {
        toggleReadiness(true);
        return toast("Connect and prepare the Player before opening Trigger View.", "error");
      }
      if (requestFullscreen) requestControllerFullscreen({ announce: true });
      setSessionMode("live");
    } else if (requestFullscreen) {
      requestControllerFullscreen({ announce: true });
    }
    triggerView = true;
    triggerViewEnteredFullscreen = Boolean(document.fullscreenElement);
    document.body.classList.add("trigger-view");
    elements.triggerToolbar.hidden = false;
    elements.triggerToolbar.setAttribute("aria-hidden", "false");
    updateTriggerFullscreenControl();
    if (workspaceMode !== "perform") setWorkspaceMode("perform");
    toggleReadiness(false);
    requestAnimationFrame(() => {
      fitTriggerGrid();
      elements.boardGrid.querySelector(".sound-pad:not(.is-empty)")?.focus({ preventScroll: true });
    });
  }

  function exitTriggerView({ exitFullscreen = true } = {}) {
    if (!triggerView) return;
    releaseAllHeldPads();
    triggerView = false;
    triggerViewEnteredFullscreen = false;
    document.body.classList.remove("trigger-view");
    elements.triggerToolbar.hidden = true;
    elements.triggerToolbar.setAttribute("aria-hidden", "true");
    document.documentElement.style.removeProperty("--trigger-cell");
    if (exitFullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    elements.triggerViewToggle.focus({ preventScroll: true });
  }

  function fitTriggerGrid() {
    if (!triggerView) return;
    const bounds = elements.boardGrid.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(elements.boardGrid).columnGap) || 8;
    const cell = Math.max(52, Math.min((bounds.width - gap * 3) / 4, (bounds.height - gap * 3) / 4));
    document.documentElement.style.setProperty("--trigger-cell", `${Math.round(cell)}px`);
  }

  function updateTriggerFullscreenControl(fullscreen = Boolean(document.fullscreenElement)) {
    const supported = typeof document.documentElement.requestFullscreen === "function" && document.fullscreenEnabled !== false;
    elements.triggerFullscreen.hidden = fullscreen;
    elements.triggerFullscreen.disabled = !supported;
    elements.triggerFullscreen.textContent = supported ? "Full screen" : "Browser view";
    elements.triggerFullscreen.setAttribute("aria-label", supported ? "Enter fullscreen Trigger View" : "Fullscreen is unavailable; Trigger View fills the browser viewport");
  }

  addEventListener("resize", () => requestAnimationFrame(fitTriggerGrid));
  globalThis.visualViewport?.addEventListener("resize", () => requestAnimationFrame(fitTriggerGrid));
  if ("ResizeObserver" in globalThis) new ResizeObserver(() => requestAnimationFrame(fitTriggerGrid)).observe(elements.boardGrid);
  document.addEventListener("fullscreenchange", () => {
    if (triggerView && document.fullscreenElement) triggerViewEnteredFullscreen = true;
    else if (triggerView && triggerViewEnteredFullscreen) exitTriggerView({ exitFullscreen: false });
    updateTriggerFullscreenControl();
    requestAnimationFrame(fitTriggerGrid);
  });

  function postToPlayer(message) {
    if (!channel || !primaryDeviceId) return;
    channel.postMessage({ ...message, appVersion: APP_VERSION, targetDeviceId: primaryDeviceId });
  }

  function getPerformancePad(padId) {
    if (!revision) return getPad(board, padId);
    return revision.banks.flatMap((bank) => bank.pads || []).find((pad) => pad.id === padId) || null;
  }

  function assetIsReferenced(assetId) {
    const draftUsesAsset = board.banks.some((bank) => bank.pads.some((pad) => pad.asset?.id === assetId));
    const publishedUsesAsset = revision?.banks?.some((bank) => bank.pads.some((pad) => pad.asset?.id === assetId));
    return draftUsesAsset || Boolean(publishedUsesAsset);
  }
}

function initPlayer() {
  document.querySelector("#app").hidden = true;
  document.querySelector(".skip-link").hidden = true;
  const playerView = document.querySelector("#player-view");
  playerView.hidden = false;

  const deviceKey = `${APP_NAMESPACE}:player-device-id`;
  const deviceId = sessionStorage.getItem(deviceKey) || createId("device");
  sessionStorage.setItem(deviceKey, deviceId);
  let revision = loadRevision();
  let audioEnabled = false;
  let assetsPrepared = false;
  let wakeLock = null;
  let preparing = false;
  let prepareGeneration = 0;
  let controllerSeenAt = 0;
  let controllerVersion = null;
  const seenEvents = new Set();
  const runtime = {
    mode: "standby",
    epoch: 1,
    stopGeneration: 0,
    revisionId: revision?.id || null,
    primaryDeviceId: deviceId,
  };

  const elements = mapElements({
    stone: "#readiness-stone",
    title: "#player-title",
    message: "#player-message",
    enable: "#enable-player",
    speakerTest: "#speaker-test",
    fullscreen: "#fullscreen-player",
    cueList: "#player-cue-list",
    pairCode: "#pair-code",
    revision: "#player-revision",
    clock: "#player-clock",
  });

  const engine = new AudioEngine({
    onVoicesChange: (voices) => {
      renderPlayerVoices(voices);
      channel?.postMessage({ type: "voices", deviceId, voices, seenAt: Date.now() });
      sendPresence();
    },
  });

  addEventListener(APP_UPDATE_EVENT, async () => {
    runtime.mode = "standby";
    runtime.epoch += 1;
    runtime.stopGeneration += 1;
    await engine.stopAll(0.03);
    renderPlayerState();
    sendPresence();
  });

  addEventListener("pagehide", () => {
    channel?.postMessage({ type: "player.offline", deviceId, sentAt: Date.now() });
  });

  elements.pairCode.textContent = roomCode.match(/.{1,4}/g)?.join(" ") || roomCode;
  elements.revision.textContent = revision ? `${revision.id} waiting` : "No revision prepared";
  setPlayerCheck("network", false);
  setInterval(() => {
    elements.clock.textContent = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
  }, 1_000);
  setInterval(() => {
    renderPlayerState();
    sendPresence();
  }, 2_000);

  channel?.addEventListener("message", async ({ data }) => {
    if (!data || typeof data !== "object") return;
    if (data.targetDeviceId && data.targetDeviceId !== deviceId) return;
    if (data.type === "controller.presence") {
      controllerSeenAt = Date.now();
      controllerVersion = data.appVersion || null;
      renderPlayerState();
      return;
    }
    if (["revision.prepare", "session.set", "master.set", "runtime.stop-all", "runtime.fade-all", "command"].includes(data.type)) {
      controllerSeenAt = Date.now();
      controllerVersion = data.appVersion || null;
    }
    if (data.type === "revision.prepare") {
      const generation = ++prepareGeneration;
      revision = data.revision;
      saveRevision(revision);
      runtime.revisionId = revision.id;
      assetsPrepared = false;
      elements.revision.textContent = `${revision.id} queued`;
      if (audioEnabled) await prepareCurrentRevision(revision, generation);
      else renderPlayerState();
    }
    if (data.type === "session.set") {
      Object.assign(runtime, data.runtime);
      if (runtime.mode !== "live") await engine.stopAll(0.03);
      renderPlayerState();
      sendPresence();
    }
    if (data.type === "master.set") engine.setMasterDb(data.db);
    if (data.type === "runtime.stop-all") {
      runtime.stopGeneration = Number(data.stopGeneration) || runtime.stopGeneration + 1;
      await engine.stopAll(0.03);
      sendPresence();
    }
    if (data.type === "runtime.fade-all") {
      runtime.stopGeneration = Number(data.stopGeneration) || runtime.stopGeneration + 1;
      await engine.fadeAll(Number(data.seconds) || 1);
      sendPresence();
    }
    if (data.type === "command") await handleCommand(data.command);
  });

  elements.enable.addEventListener("click", async () => {
    const fullscreenAttempt = requestFullscreen();
    elements.enable.disabled = true;
    elements.title.textContent = "Enabling Player";
    elements.message.textContent = "Starting the audio engine and checking local storage…";
    elements.stone.dataset.state = "syncing";
    try {
      await engine.enable();
      engine.context.addEventListener("statechange", () => {
        audioEnabled = engine.state === "running";
        renderPlayerState();
        sendPresence();
      });
      audioEnabled = engine.state === "running";
      setPlayerCheck("audio", audioEnabled);
      await requestPersistentStorage().catch(() => ({ persisted: false }));
      await requestWakeLock();
      await fullscreenAttempt;
      await engine.speakerTest();
      elements.speakerTest.disabled = false;
      elements.fullscreen.hidden = Boolean(document.fullscreenElement);
      elements.enable.hidden = true;
      if (revision) await prepareCurrentRevision(revision, ++prepareGeneration);
      else renderPlayerState();
    } catch (error) {
      audioEnabled = false;
      elements.enable.disabled = false;
      elements.title.textContent = "Audio could not start";
      elements.message.textContent = error.message;
      elements.stone.dataset.state = "needs-activation";
      sendPresence(error.message);
    }
  });

  elements.speakerTest.addEventListener("click", () => engine.speakerTest().catch((error) => {
    elements.message.textContent = error.message;
  }));
  elements.fullscreen.addEventListener("click", async () => {
    await requestFullscreen();
    elements.fullscreen.hidden = Boolean(document.fullscreenElement);
    sendPresence();
  });
  document.addEventListener("fullscreenchange", () => {
    elements.fullscreen.hidden = Boolean(document.fullscreenElement) || !audioEnabled;
    sendPresence();
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible" && audioEnabled && !wakeLock) await requestWakeLock();
    renderPlayerState();
    sendPresence();
  });

  channel?.postMessage({ type: "player.request-state", roomCode, version: APP_VERSION, appVersion: APP_VERSION, deviceId });
  renderPlayerState();
  sendPresence();

  async function prepareCurrentRevision(targetRevision = revision, generation = prepareGeneration) {
    if (!targetRevision || preparing) return;
    preparing = true;
    assetsPrepared = false;
    elements.stone.dataset.state = "syncing";
    elements.title.textContent = "Preparing revision";
    elements.message.textContent = "Decoding each Instant cue before readiness is reported.";
    setPlayerCheck("revision", false);
    sendPresence();
    try {
      const result = await engine.prepareRevision(targetRevision);
      if (generation !== prepareGeneration || revision?.id !== targetRevision.id) return;
      assetsPrepared = result.failed.length === 0;
      if (!assetsPrepared) {
        const first = result.failed[0];
        elements.title.textContent = "Revision incomplete";
        elements.message.textContent = `${first.label}: ${first.reason}`;
      }
      elements.revision.textContent = assetsPrepared ? `${targetRevision.id} prepared` : `${targetRevision.id} incomplete`;
      setPlayerCheck("revision", assetsPrepared);
    } catch (error) {
      if (generation !== prepareGeneration || revision?.id !== targetRevision.id) return;
      assetsPrepared = false;
      elements.title.textContent = "Preparation failed";
      elements.message.textContent = error.message;
    } finally {
      preparing = false;
      if (generation !== prepareGeneration && revision) {
        queueMicrotask(() => prepareCurrentRevision(revision, prepareGeneration));
      } else {
        renderPlayerState();
        sendPresence();
      }
    }
  }

  async function handleCommand(command) {
    const receivedAt = Date.now();
    const eligibility = isCommandEligible(command, runtime, receivedAt);
    if (!eligibility.ok) return rejectCommand(command, eligibility.code, receivedAt);
    if (controllerVersion !== APP_VERSION) return rejectCommand(command, "VERSION_MISMATCH", receivedAt);
    if (!audioEnabled || engine.state !== "running") return rejectCommand(command, "AUDIO_LOCKED", receivedAt);
    if (document.visibilityState !== "visible") return rejectCommand(command, "PLAYER_HIDDEN", receivedAt);
    if (!assetsPrepared || revision?.id !== command.revisionId) return rejectCommand(command, "NOT_READY", receivedAt);
    if (seenEvents.has(command.eventId)) return rejectCommand(command, "DUPLICATE", receivedAt);

    seenEvents.add(command.eventId);
    if (seenEvents.size > 512) seenEvents.delete(seenEvents.values().next().value);
    const pad = revision.banks.flatMap((bank) => bank.pads).find((candidate) => candidate.id === command.padId);
    if (!pad) return rejectCommand(command, "ASSET_MISSING", receivedAt);

    try {
      const result = await engine.trigger(pad, command.action);
      channel?.postMessage({
        type: "command.ack",
        deviceId,
        ack: {
          v: 1,
          commandId: command.eventId,
          status: result.status === "stopped" ? "stopped" : "scheduled",
          label: pad.label,
          padId: pad.id,
          issuedAt: command.issuedAt,
          receivedAt,
          scheduledAt: result.scheduledAt,
          revisionId: revision.id,
          audioContextState: engine.state,
          errorCode: null,
        },
      });
    } catch (error) {
      rejectCommand(command, "DECODE_FAILED", receivedAt, error.message);
    }
  }

  function rejectCommand(command, errorCode, receivedAt, detail) {
    channel?.postMessage({
      type: "command.ack",
      deviceId,
      ack: {
        commandId: command?.eventId,
        status: "rejected",
        label: command?.label || "Cue",
        issuedAt: command?.issuedAt,
        receivedAt,
        errorCode,
        detail,
      },
    });
  }

  function readiness() {
    return controllerConnected() && controllerVersion === APP_VERSION && audioEnabled && engine.state === "running" && assetsPrepared && revision?.id === runtime.revisionId && document.visibilityState === "visible";
  }

  function controllerConnected() {
    return Boolean(channel) && Date.now() - controllerSeenAt < 7_000;
  }

  function renderPlayerState() {
    const isReady = readiness();
    const isArmed = isReady && runtime.mode === "live";
    setPlayerCheck("network", controllerConnected());
    setPlayerCheck("version", controllerVersion === APP_VERSION);
    setPlayerCheck("audio", audioEnabled && engine.state === "running");
    setPlayerCheck("revision", assetsPrepared && revision?.id === runtime.revisionId);
    setPlayerCheck("wake", Boolean(wakeLock));

    if (!controllerConnected()) {
      elements.stone.dataset.state = "syncing";
      elements.title.textContent = "Waiting for controller";
      elements.message.textContent = "Open the paired Control Studio in this browser profile.";
      return;
    }

    if (controllerVersion !== APP_VERSION) {
      elements.stone.dataset.state = "needs-activation";
      elements.title.textContent = "App update required";
      elements.message.textContent = "Reload the Control Studio and this Player so both windows use the same Sync Stone version.";
      return;
    }

    if (!audioEnabled) {
      elements.stone.dataset.state = "needs-activation";
      elements.title.textContent = "Needs activation";
      elements.message.textContent = "Enable audio with a click on this Player. Browsers require a local user gesture.";
      return;
    }
    if (preparing) return;
    if (!revision) {
      elements.stone.dataset.state = "syncing";
      elements.title.textContent = "Awaiting revision";
      elements.message.textContent = "Publish a board from the Control Studio. This Player will prepare it automatically.";
      return;
    }
    if (!assetsPrepared) {
      elements.stone.dataset.state = "needs-activation";
      elements.title.textContent = "Revision not ready";
      elements.message.textContent = "One or more cues could not be prepared. Re-add missing local audio from the controller.";
      return;
    }
    if (revision?.id !== runtime.revisionId) {
      elements.stone.dataset.state = "syncing";
      elements.title.textContent = "Revision mismatch";
      elements.message.textContent = "Waiting for the Control Studio to prepare the active published revision.";
      return;
    }
    if (document.visibilityState !== "visible") {
      elements.stone.dataset.state = "needs-activation";
      elements.title.textContent = "Player hidden";
      elements.message.textContent = "Keep this page visible. Hidden Players reject new triggers.";
      return;
    }
    elements.stone.dataset.state = isArmed ? "armed" : "ready";
    elements.title.textContent = isArmed ? "Armed & live" : "Ready in standby";
    elements.message.textContent = isArmed
      ? "The published revision is prepared. Incoming cues are accepted now."
      : "The Player is prepared and listening. Enter Live from the Control Studio.";
  }

  function renderPlayerVoices(voices) {
    if (!voices.length) {
      elements.cueList.innerHTML = "<p>Silence</p>";
      return;
    }
    elements.cueList.innerHTML = voices.map((voice) => `<article class="player-cue-card">${escapeHtml(voice.label)}<small>${escapeHtml(voice.state)}</small></article>`).join("");
  }

  function buildPresence(error) {
    return {
      deviceId,
      appVersion: APP_VERSION,
      state: readiness() ? (runtime.mode === "live" ? "armed" : "ready") : audioEnabled ? "degraded" : "needs_activation",
      stateLabel: readiness() ? (runtime.mode === "live" ? "Armed" : "Ready") : audioEnabled ? "Needs attention" : "Needs activation",
      visibility: document.visibilityState,
      fullscreen: Boolean(document.fullscreenElement),
      wakeLock: Boolean(wakeLock),
      audioContextState: engine.state,
      revisionId: revision?.id || null,
      assetsPrepared,
      activeVoiceCount: engine.getVoices().length,
      error: error || null,
      sentAt: Date.now(),
    };
  }

  function sendPresence(error) {
    channel?.postMessage({ type: "presence", presence: buildPresence(error) });
  }

  function setPlayerCheck(name, ready) {
    const check = document.querySelector(`[data-player-check="${name}"]`);
    if (!check) return;
    check.classList.toggle("is-ready", Boolean(ready));
    check.setAttribute("aria-label", `${check.textContent.trim()}: ${ready ? "ready" : "not ready"}`);
  }

  async function requestWakeLock() {
    if (!navigator.wakeLock?.request || document.visibilityState !== "visible") return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
        setPlayerCheck("wake", false);
        sendPresence();
      }, { once: true });
    } catch {
      wakeLock = null;
    }
  }

  async function requestFullscreen() {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen().catch(() => {});
    }
  }
}

function setupAppUpdateUi() {
  const panel = document.querySelector("#app-update");
  const message = document.querySelector("#app-update-message");
  const action = document.querySelector("#app-update-action");
  if (!panel || !message || !action) return;

  channel?.addEventListener("message", ({ data }) => {
    if (data?.type === "app.update-ready") presentAppUpdate(data.version, { broadcast: false });
  });

  action.addEventListener("click", async () => {
    action.disabled = true;
    action.textContent = "Reloading…";
    channel?.postMessage({ type: "app.update-ready", version: pendingAppUpdateVersion, sentAt: Date.now() });
    try {
      const registration = await navigator.serviceWorker?.getRegistration(new URL("../", import.meta.url));
      registration?.waiting?.postMessage({ type: "sync-stone.skip-waiting" });
      await registration?.update();
    } catch {
      // Reload still uses the newest activated offline shell when the network is unavailable.
    }
    location.reload();
  });
}

function presentAppUpdate(version, { broadcast = true } = {}) {
  if (!version || version === APP_VERSION) return;
  const firstNotice = pendingAppUpdateVersion !== version;
  pendingAppUpdateVersion = version;
  const panel = document.querySelector("#app-update");
  const message = document.querySelector("#app-update-message");
  const action = document.querySelector("#app-update-action");
  if (!panel || !message || !action) return;

  message.textContent = isPlayer
    ? "Reload this Player, then enable audio again. Reload the Control Studio before returning to Live."
    : "Live is disarmed. Reload this Control Studio and the Player before returning to Live; local boards and audio stay on this device.";
  action.textContent = isPlayer ? "Reload Player" : "Reload Control Studio";
  action.disabled = false;
  panel.hidden = false;
  document.documentElement.dataset.updateReady = "true";

  if (!firstNotice) return;
  dispatchEvent(new CustomEvent(APP_UPDATE_EVENT, { detail: { version } }));
  if (broadcast) channel?.postMessage({ type: "app.update-ready", version, sentAt: Date.now() });
}

function registerOfflineShell() {
  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;

  const requestShellVersion = () => {
    navigator.serviceWorker.controller?.postMessage({ type: "sync-stone.shell-version.request" });
  };
  navigator.serviceWorker.addEventListener("message", ({ data }) => {
    if (["sync-stone.shell-active", "sync-stone.shell-version"].includes(data?.type)) presentAppUpdate(data.version);
  });
  navigator.serviceWorker.addEventListener("controllerchange", requestShellVersion);
  addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(new URL("../sw.js", import.meta.url));
      await registration.update();
      requestShellVersion();
    } catch (error) {
      console.warn("Sync Stone offline shell could not register.", error);
    }
  });
}

function drawWaveform(canvas, peaks = [], color = "slate", synth = false) {
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = "#292d35";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, height / 2 + .5);
  context.lineTo(width, height / 2 + .5);
  context.stroke();

  const palette = { cobalt: "#6f8edb", teal: "#58a4a8", emerald: "#58a080", amber: "#bd8e45", coral: "#b96b65", plum: "#987096", slate: "#7f899a" };
  context.strokeStyle = palette[color] || palette.slate;
  context.lineWidth = 2;
  const values = peaks.length ? peaks : synth ? Array.from({ length: 72 }, (_, index) => Math.sin(index * .72) ** 2 * (1 - index / 100)) : [];
  if (!values.length) return;
  const step = width / values.length;
  context.beginPath();
  values.forEach((value, index) => {
    const x = index * step + step / 2;
    const amplitude = Math.max(1.5, Math.min(height * .46, Number(value) * height * .46));
    context.moveTo(x, height / 2 - amplitude);
    context.lineTo(x, height / 2 + amplitude);
  });
  context.stroke();
}

function mapElements(selectors) {
  return Object.fromEntries(Object.entries(selectors).map(([name, selector]) => [name, document.querySelector(selector)]));
}

function modeShortLabel(mode) {
  return ({ "play-stop": "TOGGLE", overlap: "OVERLAP", restart: "RESTART", hold: "HOLD", "loop-stop": "LOOP" })[mode] || "TOGGLE";
}

function formatDb(db) {
  return Number(db) <= -60 ? "−∞" : `${Number(db) > 0 ? "+" : ""}${Number(db)} dB`;
}

function isTypingTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message, type = "info") {
  const region = document.querySelector("#toast-region");
  const item = document.createElement("div");
  item.className = `toast ${type === "error" ? "is-error" : type === "success" ? "is-success" : ""}`;
  item.textContent = message;
  region.append(item);
  setTimeout(() => item.remove(), 4_200);
}
