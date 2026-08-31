const clockEl = document.getElementById("clock");
const clockRingEl = document.getElementById("clock-ring");
const installEl = document.getElementById("install");
const addEl = document.getElementById("add");
const playEl = document.getElementById("play");
const stopEl = document.getElementById("stop");
const themeNameEl = document.getElementById("theme-name");

let kind = "white";
const KIND_KEY = "noise-kind";
const KINDS = new Set(["white", "brown", "pink", "fan", "soft", "ac"]);

function normalizeKind(value) {
  return KINDS.has(value) ? value : "white";
}

function getPreferredKind() {
  try {
    return normalizeKind(localStorage.getItem(KIND_KEY));
  } catch {
    return "white";
  }
}

function persistKind(value) {
  try {
    localStorage.setItem(KIND_KEY, value);
  } catch {
    /* ignore */
  }
}

kind = getPreferredKind();
document.documentElement.dataset.kind = kind;
const DEFAULT_PRESET_MS = 43_200_000;
let presetMs = DEFAULT_PRESET_MS;
let durationMs = DEFAULT_PRESET_MS;
let sessionTotalMs = DEFAULT_PRESET_MS;
let endsAt = 0;
let playing = false;
let paused = false;
const SAMPLE_URLS = {
  white: "./sounds/white.wav",
  brown: "./sounds/brown.wav",
  pink: "./sounds/pink.wav",
  fan: "./sounds/fan.wav",
  soft: "./sounds/soft.wav",
  ac: "./sounds/ac.wav",
};

let ctx;
let master;
let buffers = {};
let voice = null;
let audioReady = false;
let loadPromise = null;
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
  const total = sessionTotalMs || durationMs;
  const ratio = total ? Math.max(0, Math.min(1, left / total)) : 1;
  const infinite = playing ? !endsAt : !durationMs;
  clockEl.textContent = formatTime(left);
  clockEl.classList.toggle("is-inf", infinite);
  if (clockRingEl) {
    clockRingEl.style.strokeDashoffset = String(1 - ratio);
  }
  document.body.classList.toggle("is-playing", playing);
  document.documentElement.dataset.kind = kind;

  document.querySelectorAll(".type").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.type === kind);
  });

  const activeMs = playing || paused ? sessionTotalMs : durationMs;
  document.querySelectorAll(".preset").forEach((btn) => {
    const on = Number(btn.dataset.ms) === activeMs;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-checked", on ? "true" : "false");
  });

  playEl.classList.toggle("is-on", playing);
  playEl.setAttribute("aria-label", playing ? "Pause" : "Play");
}

async function ensureAudio() {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: "playback" });
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") await ctx.resume();
  if (audioReady) return;
  if (!loadPromise) {
    loadPromise = (async () => {
      const decoded = await Promise.all(
        Object.entries(SAMPLE_URLS).map(async ([key, url]) => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`sound ${key}: ${res.status}`);
          const data = await res.arrayBuffer();
          return [key, await ctx.decodeAudioData(data.slice(0))];
        }),
      );
      buffers = Object.fromEntries(decoded);
      audioReady = true;
    })().catch((err) => {
      loadPromise = null;
      throw err;
    });
  }
  await loadPromise;
}

function stopVoice(fade = 0.05) {
  if (!voice || !ctx) return;
  const now = ctx.currentTime;
  const old = voice;
  voice = null;
  try {
    old.gain.gain.cancelScheduledValues(now);
    old.gain.gain.setValueAtTime(old.gain.gain.value, now);
    old.gain.gain.linearRampToValueAtTime(0, now + fade);
    old.source.stop(now + fade + 0.03);
  } catch {
    /* already stopped */
  }
}

function startVoice(nextKind, fade = 0.4) {
  if (!ctx || !buffers[nextKind]) return;
  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = buffers[nextKind];
  source.loop = true;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(1, now + fade);
  source.connect(g);
  g.connect(master);
  source.start();
  if (voice) {
    const old = voice;
    old.gain.gain.cancelScheduledValues(now);
    old.gain.gain.setValueAtTime(Math.max(old.gain.gain.value, 0), now);
    old.gain.gain.linearRampToValueAtTime(0, now + fade);
    try {
      old.source.stop(now + fade + 0.03);
    } catch {
      /* already stopped */
    }
  }
  voice = { source, gain: g, kind: nextKind };
}

const KIND_TITLE = {
  white: "White noise",
  brown: "Brown noise",
  pink: "Pink noise",
  fan: "Fan",
  soft: "Soft heater",
  ac: "AC",
};

function isNativeApp() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform?.());
}

function setMediaSession() {
  const title = KIND_TITLE[kind] || "Noise";
  if (window.NoiseNativeMedia) {
    window.NoiseNativeMedia.update({ title, playing, paused }).catch(() => {});
    return;
  }
  if (!navigator.mediaSession) return;
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
  if (!master || !ctx) return;
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(value, now + seconds);
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
  if (!voice || voice.kind !== kind) startVoice(kind, 0.45);
  fadeTo(1, 0.45);
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
      if (!playing) {
        stopVoice(0.05);
        if (ctx.state === "running") ctx.suspend();
      }
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
      if (!playing) {
        stopVoice(0.05);
        if (ctx.state === "running") ctx.suspend();
      }
    }, wait * 1000 + 40);
  }
  endsAt = 0;
  if (reset) restorePreset();
  setMediaSession();
  render();
}

document.addEventListener("noise-media", (event) => {
  const action = event.detail?.action;
  if (action === "play") start();
  else if (action === "pause") pause();
  else if (action === "stop") stop({ reset: true });
});

function applyKind(next) {
  kind = normalizeKind(next);
  persistKind(kind);
  document.documentElement.dataset.kind = kind;
  if (playing && buffers[kind]) startVoice(kind, 0.35);
  setMediaSession();
  render();
}

function addTime(ms) {
  if (!durationMs && !playing) {
    durationMs = ms;
    sessionTotalMs = ms;
  } else {
    durationMs += ms;
    sessionTotalMs += ms;
  }
  if (playing) endsAt = (endsAt || Date.now()) + ms;
  render();
}

function setDuration(ms) {
  durationMs = ms;
  sessionTotalMs = ms;
  presetMs = ms;
  if (playing) endsAt = ms ? Date.now() + ms : 0;
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

document.querySelectorAll(".preset").forEach((btn) => {
  btn.setAttribute("role", "radio");
  btn.addEventListener("click", () => {
    buzz();
    setDuration(Number(btn.dataset.ms));
  });
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
  if (isNativeApp()) return;
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

if ("serviceWorker" in navigator && !isNativeApp()) {
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
  const current = THEMES.find((t) => t.id === next);
  if (themeNameEl && current) themeNameEl.textContent = current.label;
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
