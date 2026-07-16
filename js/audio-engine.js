import { createId } from "./core.js";
import { getAsset } from "./storage.js";

const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
const MAX_DECODED_PCM_BYTES = 256 * 1024 * 1024;
const MAX_SINGLE_DECODED_PCM_BYTES = 96 * 1024 * 1024;
const PCM_BYTES_PER_SAMPLE = Float32Array.BYTES_PER_ELEMENT;

export class AudioEngine {
  constructor({ onVoicesChange } = {}) {
    this.context = null;
    this.masterGain = null;
    this.limiter = null;
    this.buffers = new Map();
    this.voices = new Map();
    this.onVoicesChange = onVoicesChange || (() => {});
    this.masterDb = 0;
  }

  get state() {
    return this.context?.state || "closed";
  }

  async enable() {
    if (!AudioContextClass) throw new Error("Web Audio is not supported in this browser.");
    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContextClass({ latencyHint: "interactive" });
      this.masterGain = this.context.createGain();
      this.limiter = this.context.createDynamicsCompressor();
      this.limiter.threshold.value = -3;
      this.limiter.knee.value = 8;
      this.limiter.ratio.value = 12;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.25;
      this.masterGain.connect(this.limiter).connect(this.context.destination);
      this.setMasterDb(this.masterDb);
    }
    if (this.context.state !== "running") await this.context.resume();
    return this.context;
  }

  async speakerTest() {
    await this.enable();
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(440, now);
    oscillator.frequency.exponentialRampToValueAtTime(660, now + 0.28);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.13, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.46);
    oscillator.connect(gain).connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + 0.48);
  }

  async prepareRevision(revision) {
    await this.enable();
    const pads = revision?.banks?.flatMap((bank) => bank.pads || []) || [];
    const referencedAssetIds = new Set(pads.filter((pad) => pad?.asset).map((pad) => pad.asset.id));

    for (const assetId of this.buffers.keys()) {
      if (!referencedAssetIds.has(assetId)) this.buffers.delete(assetId);
    }

    const failed = [];
    let prepared = 0;
    for (const pad of pads) {
      try {
        await this.preparePad(pad);
        prepared += 1;
      } catch (error) {
        failed.push({ padId: pad.id, label: pad.label, reason: error?.message || "Decode failed" });
      }
    }
    return { total: pads.length, prepared, failed };
  }

  async preparePad(pad) {
    if (!pad?.asset) throw new Error("Cue has no audio asset.");
    if (this.buffers.has(pad.asset.id)) return this.buffers.get(pad.asset.id);
    let buffer;
    if (pad.asset.kind === "synth") {
      buffer = createSynthBuffer(this.context, pad.asset.preset, pad.asset.duration);
    } else {
      const stored = await getAsset(pad.asset.id);
      if (!stored?.blob) throw new Error("The local audio file is missing. Add it again from the controller.");
      buffer = await this.context.decodeAudioData(await stored.blob.arrayBuffer());
    }
    const decodedPcmBytes = getDecodedPcmBytes(buffer);
    const cachedPcmBytes = Array.from(this.buffers.values())
      .reduce((total, cachedBuffer) => total + getDecodedPcmBytes(cachedBuffer), 0);
    if (cachedPcmBytes + decodedPcmBytes > MAX_DECODED_PCM_BYTES) {
      throw new Error("Preparing this cue would exceed the 256 MiB decoded-audio memory limit. Remove or shorten cues and try again.");
    }
    this.buffers.set(pad.asset.id, buffer);
    return buffer;
  }

  async trigger(pad, action = "press") {
    await this.enable();
    await this.preparePad(pad);
    const active = this.getPadVoices(pad.id);

    if (action === "release") {
      await Promise.all(active.map((voice) => this.stopVoice(voice, Number(pad.fadeOut) || 0)));
      return { status: "stopped", scheduledAt: performance.now(), voiceId: null };
    }

    switch (pad.triggerMode) {
      case "play-stop":
        if (active.length) {
          await Promise.all(active.map((voice) => this.stopVoice(voice, Number(pad.fadeOut) || 0)));
          return { status: "stopped", scheduledAt: performance.now(), voiceId: null };
        }
        break;
      case "restart":
        await Promise.all(active.map((voice) => this.stopVoice(voice, 0.01)));
        break;
      case "loop-stop":
        if (active.length) {
          await Promise.all(active.map((voice) => this.stopVoice(voice, Number(pad.fadeOut) || 0)));
          return { status: "stopped", scheduledAt: performance.now(), voiceId: null };
        }
        break;
      case "hold":
        if (active.length) return { status: "already-playing", scheduledAt: performance.now(), voiceId: active[0].id };
        break;
      case "overlap":
        if (active.length >= 8) await this.stopVoice(active[0], 0.01);
        break;
      default:
        break;
    }

    const voice = this.startVoice(pad);
    return { status: "scheduled", scheduledAt: voice.scheduledAt, voiceId: voice.id };
  }

  startVoice(pad) {
    const buffer = this.buffers.get(pad.asset.id);
    if (!buffer) throw new Error("Cue is not prepared.");

    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    const startsAt = now + 0.012;
    const fadeIn = Math.min(Number(pad.fadeIn) || 0, Math.max(0, buffer.duration / 2));
    const loop = pad.triggerMode === "loop-stop";
    source.buffer = buffer;
    source.loop = loop;
    gain.gain.setValueAtTime(fadeIn ? 0.0001 : 1, startsAt);
    if (fadeIn) gain.gain.exponentialRampToValueAtTime(1, startsAt + fadeIn);
    source.connect(gain).connect(this.masterGain);

    const voice = {
      id: createId("voice"),
      padId: pad.id,
      label: pad.label,
      source,
      gain,
      loop,
      duration: buffer.duration,
      startedAt: performance.now() + 12,
      scheduledAt: performance.timeOrigin + performance.now() + 12,
      state: loop ? "looping" : "playing",
      stopping: false,
    };

    const list = this.voices.get(pad.id) || [];
    list.push(voice);
    this.voices.set(pad.id, list);
    source.addEventListener("ended", () => this.removeVoice(voice), { once: true });
    source.start(startsAt);
    this.emitVoices();
    return voice;
  }

  async stopVoice(voice, fadeSeconds = 0) {
    if (!voice || voice.stopping) return;
    voice.stopping = true;
    voice.state = fadeSeconds > 0.03 ? "fading" : "stopping";
    const now = this.context.currentTime;
    const fade = Math.max(0.005, Math.min(10, Number(fadeSeconds) || 0.005));
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + fade);
    try { voice.source.stop(now + fade + 0.01); } catch { this.removeVoice(voice); }
    this.emitVoices();
  }

  async stopAll(fadeSeconds = 0.03) {
    const voices = this.getVoices();
    await Promise.all(voices.map((voice) => this.stopVoice(voice, fadeSeconds)));
  }

  async fadeAll(fadeSeconds = 1) {
    return this.stopAll(fadeSeconds);
  }

  setMasterDb(db) {
    this.masterDb = Math.min(6, Math.max(-60, Number(db) || 0));
    if (!this.masterGain || !this.context) return;
    const linear = this.masterDb <= -60 ? 0.0001 : 10 ** (this.masterDb / 20);
    this.masterGain.gain.setTargetAtTime(linear, this.context.currentTime, 0.015);
  }

  getPadVoices(padId) {
    return (this.voices.get(padId) || []).filter((voice) => !voice.stopping);
  }

  getVoices() {
    return Array.from(this.voices.values()).flat();
  }

  removeVoice(voice) {
    const list = (this.voices.get(voice.padId) || []).filter((candidate) => candidate.id !== voice.id);
    if (list.length) this.voices.set(voice.padId, list);
    else this.voices.delete(voice.padId);
    this.emitVoices();
  }

  emitVoices() {
    this.onVoicesChange(this.getVoices().map(({ source, gain, ...voice }) => voice));
  }
}

function getDecodedPcmBytes(buffer) {
  const channels = Math.max(0, Number(buffer?.numberOfChannels) || 0);
  const samplesPerChannel = Math.max(0, Number(buffer?.length) || 0);
  return channels * samplesPerChannel * PCM_BYTES_PER_SAMPLE;
}

export async function inspectAudioFile(file) {
  if (!AudioContextClass) throw new Error("Web Audio is not supported in this browser.");
  const metadata = await readMediaMetadata(file);
  if (metadata.duration > 45) throw new Error("Use a cue no longer than 45 seconds in this feasibility build.");
  const context = new AudioContextClass();
  try {
    let buffer;
    try {
      buffer = await context.decodeAudioData(await file.arrayBuffer());
    } catch {
      throw new Error("This browser could not decode that file. The static build verifies real browser support; server conversion is not active here.");
    }
    if (getDecodedPcmBytes(buffer) > MAX_SINGLE_DECODED_PCM_BYTES) {
      throw new Error("That cue expands beyond the 96 MiB single-file decoded-audio safety limit.");
    }
    return {
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      peaks: extractPeaks(buffer, 96),
    };
  } finally {
    await context.close().catch(() => {});
  }
}

function readMediaMetadata(file) {
  if (!globalThis.document || !globalThis.URL?.createObjectURL) {
    return Promise.reject(new Error("Browser media metadata is unavailable."));
  }
  const objectUrl = URL.createObjectURL(file);
  const media = document.createElement("audio");
  media.preload = "metadata";
  media.muted = true;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("The browser could not safely determine this file's duration.")), 10_000);
    const finish = (error, duration = null) => {
      clearTimeout(timeout);
      media.removeAttribute("src");
      media.load();
      URL.revokeObjectURL(objectUrl);
      if (error) reject(error);
      else resolve({ duration });
    };
    media.addEventListener("loadedmetadata", () => {
      if (!Number.isFinite(media.duration) || media.duration <= 0) {
        finish(new Error("The browser could not safely determine this file's duration."));
        return;
      }
      finish(null, media.duration);
    }, { once: true });
    media.addEventListener("error", () => finish(new Error("This browser could not recognize that file as decodable audio.")), { once: true });
    media.src = objectUrl;
    media.load();
  });
}

function extractPeaks(buffer, count) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const block = Math.max(1, Math.floor(buffer.length / count));
  return Array.from({ length: count }, (_, peakIndex) => {
    const start = peakIndex * block;
    const end = Math.min(buffer.length, start + block);
    let max = 0;
    for (let sample = start; sample < end; sample += Math.max(1, Math.floor(block / 120))) {
      for (const channel of channels) max = Math.max(max, Math.abs(channel[sample] || 0));
    }
    return Number(max.toFixed(4));
  });
}

function createSynthBuffer(context, preset = "arrival", requestedDuration = 2) {
  const duration = Math.max(0.25, Math.min(12, Number(requestedDuration) || 2));
  const sampleRate = context.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = context.createBuffer(2, length, sampleRate);
  let seed = preset.split("").reduce((total, character) => total + character.charCodeAt(0), 1);

  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  for (let channelIndex = 0; channelIndex < 2; channelIndex += 1) {
    const channel = buffer.getChannelData(channelIndex);
    for (let index = 0; index < length; index += 1) {
      const time = index / sampleRate;
      const progress = time / duration;
      let sample = 0;

      if (preset === "room") {
        const envelope = Math.min(1, time * 3) * Math.min(1, (duration - time) * 3);
        sample = (((random() * 2 - 1) * 0.018) + Math.sin(2 * Math.PI * 73 * time) * 0.006) * envelope;
      } else if (preset === "attention") {
        const envelope = Math.sin(Math.PI * Math.min(1, progress)) ** 1.3;
        const frequency = time < 0.68 ? 523.25 : 659.25;
        sample = Math.sin(2 * Math.PI * frequency * time) * envelope * 0.18;
      } else if (preset === "shift") {
        const frequency = 190 + 620 * progress;
        const envelope = Math.sin(Math.PI * progress) ** 1.8;
        sample = (Math.sin(2 * Math.PI * frequency * time) + Math.sin(2 * Math.PI * frequency * 1.502 * time) * 0.35) * envelope * 0.1;
      } else if (preset === "applause") {
        const burst = 0.45 + 0.55 * Math.sin(2 * Math.PI * (7 + channelIndex) * time) ** 2;
        const envelope = Math.sin(Math.PI * progress) ** 0.65;
        sample = (random() * 2 - 1) * burst * envelope * 0.065;
      } else if (preset === "confirm") {
        const frequency = time < duration * 0.46 ? 523.25 : 783.99;
        const local = time < duration * 0.46 ? time / (duration * 0.46) : (time - duration * 0.46) / (duration * 0.54);
        const envelope = Math.sin(Math.PI * Math.min(1, local)) ** 1.6;
        sample = (Math.sin(2 * Math.PI * frequency * time) + Math.sin(2 * Math.PI * frequency * 2 * time) * 0.18) * envelope * 0.13;
      } else if (preset === "impact") {
        const envelope = Math.exp(-6.5 * progress);
        const frequency = 78 - 30 * progress;
        sample = (Math.sin(2 * Math.PI * frequency * time) * 0.24 + (random() * 2 - 1) * 0.06) * envelope;
      } else if (preset === "countdown") {
        const pulseIndex = Math.min(2, Math.floor(time / (duration / 3)));
        const local = (time % (duration / 3)) / (duration / 3);
        const frequencies = [440, 440, 659.25];
        const envelope = Math.sin(Math.PI * local) ** 2.2;
        sample = Math.sin(2 * Math.PI * frequencies[pulseIndex] * time) * envelope * 0.16;
      } else if (preset === "curtain") {
        const frequency = 760 - 610 * progress;
        const envelope = Math.sin(Math.PI * progress) ** 1.3;
        sample = (Math.sin(2 * Math.PI * frequency * time) + Math.sin(2 * Math.PI * frequency * 0.5 * time) * 0.4) * envelope * 0.11;
      } else if (preset === "intermission") {
        const drift = Math.sin(2 * Math.PI * 0.125 * time) * 5;
        sample = (Math.sin(2 * Math.PI * (110 + drift) * time) * 0.035
          + Math.sin(2 * Math.PI * 164.81 * time) * 0.022
          + Math.sin(2 * Math.PI * 220 * time) * 0.014) * Math.min(1, time * 2, (duration - time) * 2);
      } else if (preset === "alert") {
        const gate = Math.sin(2 * Math.PI * 3.1 * time) > 0 ? 1 : 0;
        const envelope = Math.sin(Math.PI * progress) ** 0.7;
        sample = Math.sin(2 * Math.PI * 880 * time) * gate * envelope * 0.12;
      } else if (preset === "resolve") {
        const envelope = Math.sin(Math.PI * Math.min(1, progress)) ** 1.2;
        sample = ([261.63, 329.63, 392].reduce((sum, frequency, noteIndex) => sum
          + Math.sin(2 * Math.PI * frequency * time) * (0.075 - noteIndex * 0.01), 0)) * envelope;
      } else {
        const notes = [261.63, 392, 523.25];
        const noteIndex = Math.min(notes.length - 1, Math.floor(progress * notes.length));
        const local = (progress * notes.length) % 1;
        const envelope = Math.sin(Math.PI * local) ** 1.5 * (1 - progress * 0.28);
        sample = (Math.sin(2 * Math.PI * notes[noteIndex] * time) + Math.sin(2 * Math.PI * notes[noteIndex] * 2 * time) * 0.22) * envelope * 0.14;
      }

      channel[index] = sample * (channelIndex ? 0.96 : 1);
    }
  }
  return buffer;
}
