const clockEl = document.getElementById("clock");
const clockBarEl = document.getElementById("clock-bar");
const installEl = document.getElementById("install");
const addEl = document.getElementById("add");
const playEl = document.getElementById("play");
const playIconEl = document.getElementById("play-icon");
const stopEl = document.getElementById("stop");

let kind = "white";
const DEFAULT_PRESET_MS = 43_200_000;
let presetMs = DEFAULT_PRESET_MS;
let durationMs = DEFAULT_PRESET_MS;
let sessionTotalMs = DEFAULT_PRESET_MS;
let endsAt = 0;
let playing = false;
let paused = false;
let ctx;
let gain;
let source;
let workletReady = false;
let tickId = 0;
let installEvent = null;

function buzz() {
  try {
    navigator.vibrate?.(12);
  } catch {
    /* ignore */
  }
}

function formatTime(ms) {
  if (!ms) return "∞";
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function remainingMs() {
  if (playing && endsAt) return Math.max(0, endsAt - Date.now());
  return durationMs;
}

function render() {
  const left = remainingMs();
  const total = sessionTotalMs || durationMs || DEFAULT_PRESET_MS;
  const ratio = total ? Math.max(0, Math.min(1, left / total)) : 1;
  clockEl.textContent = formatTime(left);
  clockBarEl.style.transform = `scaleX(${ratio})`;
  document.body.classList.toggle("is-playing", playing);

  document.querySelectorAll(".type").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.type === kind);
  });

  playEl.classList.toggle("is-on", true);
  if (playIconEl) {
    playIconEl.src = playing ? "./icons/pause.png" : "./icons/play.png";
  }
  playEl.setAttribute("aria-label", playing ? "Pause" : "Play");
}

async function ensureAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
  }
  if (ctx.state === "suspended") await ctx.resume();
  if (workletReady) return;

  try {
    await ctx.audioWorklet.addModule("./noise-worklet.js");
    source = new AudioWorkletNode(ctx, "noise-processor");
    source.port.postMessage({ kind });
    source.connect(gain);
    workletReady = true;
  } catch {
    const bufferSize = 4096;
    const node = ctx.createScriptProcessor(bufferSize, 0, 1);
    let brown = 0;
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    node.onaudioprocess = (event) => {
      const out = event.outputBuffer.getChannelData(0);
      for (let i = 0; i < out.length; i++) {
        const white = Math.random() * 2 - 1;
        let sample = white * 0.45;
        if (kind === "brown") {
          brown += white * 0.02;
          brown *= 0.996;
          sample = Math.max(-1, Math.min(1, brown * 3.5));
        } else if (kind === "pink") {
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.969 * b2 + white * 0.153852;
          b3 = 0.8665 * b3 + white * 0.3104856;
          b4 = 0.55 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.016898;
          sample = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
          b6 = white * 0.115926;
        }
        out[i] = sample;
      }
    };
    source = node;
    source.connect(gain);
    workletReady = true;
  }
}

function setMediaSession() {
  if (!navigator.mediaSession) return;
  const title = `${kind[0].toUpperCase()}${kind.slice(1)} noise`;
  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist: "Noise",
    artwork: [
      { src: "./icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "./icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  });
  navigator.mediaSession.playbackState = playing ? "playing" : "paused";
}

function fadeTo(value, seconds) {
  if (!gain || !ctx) return;
  const now = ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(value, now + seconds);
}

function restorePreset() {
  presetMs = DEFAULT_PRESET_MS;
  durationMs = presetMs;
  sessionTotalMs = durationMs;
  endsAt = 0;
}

async function start() {
  await ensureAudio();
  if (!paused) sessionTotalMs = durationMs;
  if (durationMs) {
    endsAt = Date.now() + durationMs;
  } else {
    endsAt = 0;
  }
  playing = true;
  paused = false;
  fadeTo(0.85, 0.45);
  setMediaSession();
  render();
}

async function pause({ fade = 0.4 } = {}) {
  if (!playing) return;
  if (endsAt) durationMs = Math.max(0, endsAt - Date.now());
  playing = false;
  paused = true;
  endsAt = 0;
  fadeTo(0, fade);
  if (ctx && fade) {
    const wait = fade;
    window.setTimeout(() => {
      if (!playing && ctx.state === "running") ctx.suspend();
    }, wait * 1000 + 40);
  }
  setMediaSession();
  render();
}

async function stop({ fade = 0.6, reset = false } = {}) {
  playing = false;
  paused = false;
  fadeTo(0, fade);
  if (ctx && fade) {
    const wait = fade;
    window.setTimeout(() => {
      if (!playing && ctx.state === "running") ctx.suspend();
    }, wait * 1000 + 40);
  }
  endsAt = 0;
  if (reset) restorePreset();
  setMediaSession();
  render();
}

function applyKind(next) {
  kind = next;
  if (source && source.port) source.port.postMessage({ kind });
  setMediaSession();
  render();
}

function addTime(ms) {
  durationMs += ms;
  sessionTotalMs += ms;
  if (playing) endsAt = (endsAt || Date.now()) + ms;
  render();
}

async function tapPlayPause() {
  if (playing) {
    await pause();
  } else {
    await start();
  }
}

function onTick() {
  if (!playing || !endsAt) return;
  if (Date.now() >= endsAt) {
    stop({ fade: 2.4, reset: true });
    return;
  }
  render();
}

document.querySelectorAll(".type").forEach((btn) => {
  btn.addEventListener("click", () => {
    buzz();
    applyKind(btn.dataset.type);
  });
});

addEl.addEventListener("click", () => {
  buzz();
  addTime(3_600_000);
});

playEl.addEventListener("click", () => {
  buzz();
  tapPlayPause();
});

stopEl.addEventListener("click", () => {
  buzz();
  stop({ reset: true });
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") render();
});

if (navigator.mediaSession) {
  navigator.mediaSession.setActionHandler("play", () => start());
  navigator.mediaSession.setActionHandler("pause", () => pause());
  navigator.mediaSession.setActionHandler("stop", () => stop({ reset: true }));
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installEvent = event;
  installEl.hidden = false;
});

installEl.addEventListener("click", async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  installEl.hidden = true;
});

window.addEventListener("appinstalled", () => {
  installEl.hidden = true;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

const THEME_KEY = "noise-theme";
const THEMES = [
  { id: "ember", label: "Ember", swatch: "#e2b56a", meta: "#121110" },
  { id: "ink", label: "Ink", swatch: "#e8a54b", meta: "#141210" },
  { id: "harbor", label: "Harbor", swatch: "#5ec4b2", meta: "#0f171c" },
  { id: "velvet", label: "Velvet", swatch: "#d4a0b4", meta: "#120e14" },
  { id: "pine", label: "Pine", swatch: "#8fbf9a", meta: "#141c18" },
  { id: "obsidian", label: "Obsidian", swatch: "#7eb8da", meta: "#0e1117" },
];
const THEME_IDS = new Set(THEMES.map((t) => t.id));
const THEME_META = Object.fromEntries(THEMES.map((t) => [t.id, t.meta]));

const gearBtn = document.getElementById("gear-btn");
const gearMenu = document.getElementById("gear-menu");
const swatchWrap = document.getElementById("theme-swatches");

function normalizeTheme(theme) {
  return THEME_IDS.has(theme) ? theme : "ember";
}

function getPreferredTheme() {
  try {
    const stored = normalizeTheme(localStorage.getItem(THEME_KEY));
    if (stored) return stored;
  } catch {
    /* ignore */
  }
  return "ember";
}

function applyTheme(theme) {
  const next = normalizeTheme(theme);
  const root = document.documentElement;
  root.classList.add("theme-crossfade");
  root.dataset.theme = next;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_META[next]);
  document.querySelectorAll(".theme-swatch").forEach((btn) => {
    btn.setAttribute("aria-checked", btn.dataset.theme === next ? "true" : "false");
  });
  window.setTimeout(() => root.classList.remove("theme-crossfade"), 280);
}

function persistTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

function closeGearMenu() {
  if (!gearMenu || gearMenu.hidden) return;
  gearMenu.hidden = true;
  gearBtn?.setAttribute("aria-expanded", "false");
}

function toggleGearMenu() {
  if (!gearMenu) return;
  const open = gearMenu.hidden;
  gearMenu.hidden = !open;
  gearBtn?.setAttribute("aria-expanded", open ? "true" : "false");
}

if (swatchWrap) {
  swatchWrap.innerHTML = "";
  THEMES.forEach((t) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-swatch";
    btn.dataset.theme = t.id;
    btn.title = t.label;
    btn.setAttribute("aria-label", t.label);
    btn.setAttribute("role", "radio");
    btn.style.setProperty("--swatch", t.swatch);
    btn.addEventListener("click", () => {
      buzz();
      persistTheme(t.id);
      applyTheme(t.id);
    });
    swatchWrap.appendChild(btn);
  });
  applyTheme(getPreferredTheme());
}

if (gearBtn && gearMenu) {
  gearBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    buzz();
    toggleGearMenu();
  });

  document.addEventListener("click", (event) => {
    if (gearMenu.hidden) return;
    if (gearMenu.contains(event.target) || gearBtn.contains(event.target)) return;
    closeGearMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeGearMenu();
  });
}

tickId = window.setInterval(onTick, 250);
render();
