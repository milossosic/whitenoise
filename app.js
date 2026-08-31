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
    gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
  }
  if (ctx.state === "suspended") await ctx.resume();
  if (workletReady) return;

  try {
    await ctx.audioWorklet.addModule("./noise-worklet.js?v=23");
    source = new AudioWorkletNode(ctx, "noise-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    source.port.postMessage({ kind });
    source.connect(gain);
    workletReady = true;
  } catch {
    // Continuous fallback (same models as the worklet); never buffer-loops.
    const bufferSize = 4096;
    const node = ctx.createScriptProcessor(bufferSize, 0, 1);
    const rate = ctx.sampleRate;
    const hz = (f) => 1 - Math.exp((-2 * Math.PI * f) / rate);
    const a20 = hz(20);
    const a80 = hz(80);
    const a160 = hz(160);
    const a350 = hz(350);
    const a800 = hz(800);
    const a1k5 = hz(1500);
    const a3k = hz(3000);
    const a6k = hz(6000);
    const a11k = hz(11000);
    let seed = (Math.random() * 0xffffffff) >>> 0 || 1;
    let phase = 0;
    let slow = 0;
    const mk = () => ({
      brown: 0,
      dc: 0,
      b0: 0,
      b1: 0,
      b2: 0,
      b3: 0,
      b4: 0,
      b5: 0,
      b6: 0,
      lp1: 0,
      lp2: 0,
      lp3: 0,
      lp4: 0,
      air: 0,
    });
    const states = {
      white: mk(),
      brown: mk(),
      pink: mk(),
      fan: mk(),
      soft: mk(),
      ac: mk(),
    };
    let activeKind = kind;
    let fadeFrom = kind;
    let xfade = 1;
    const xfadeInc = 1 / (rate * 0.1);

    const rand = () => {
      let s = seed | 0;
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      seed = s >>> 0;
      return ((s >>> 0) / 4294967296) * 2 - 1;
    };
    const limit = (x) => {
      const t = 0.86;
      if (x > t) return t + Math.tanh(x - t) * 0.12;
      if (x < -t) return -t + Math.tanh(x + t) * 0.12;
      return x;
    };
    const lp = (st, key, x, a) => {
      st[key] += a * (x - st[key]);
      return st[key];
    };
    const pink = (st, white) => {
      st.b0 = 0.99886 * st.b0 + white * 0.0555179;
      st.b1 = 0.99332 * st.b1 + white * 0.0750759;
      st.b2 = 0.969 * st.b2 + white * 0.153852;
      st.b3 = 0.8665 * st.b3 + white * 0.3104856;
      st.b4 = 0.55 * st.b4 + white * 0.5329522;
      st.b5 = -0.7616 * st.b5 - white * 0.016898;
      const o = (st.b0 + st.b1 + st.b2 + st.b3 + st.b4 + st.b5 + st.b6 + white * 0.5362) * 0.11;
      st.b6 = white * 0.115926;
      return o;
    };
    const brown = (st, white) => {
      st.brown += white * 0.016;
      st.brown *= 0.995;
      st.dc += a20 * (st.brown - st.dc);
      return (st.brown - st.dc) * 4.2;
    };
    const sample = (k, white) => {
      const st = states[k] || states.white;
      if (k === "white") return lp(st, "lp1", white, a11k) * 0.7;
      if (k === "brown") return limit(brown(st, white) * 1.2);
      if (k === "pink") return limit(pink(st, white) * 2.1);
      const p = pink(st, white);
      const b = brown(st, white);
      if (k === "fan") {
        const low = lp(st, "lp1", p, a160);
        const mid = lp(st, "lp2", p, a800);
        const body = mid - low;
        const presence = lp(st, "lp3", p, a3k) - mid;
        const blades = 1 + 0.1 * Math.sin(phase * 23) + 0.035 * Math.sin(phase * 46);
        const motor = Math.sin(phase * 96) * (0.028 + 0.012 * low);
        return limit((low * 0.4 + body * 0.95 + presence * 0.22 + b * 0.2 + motor) * blades * 2.25);
      }
      if (k === "soft") {
        const mix = p * 0.5 + b * 0.5;
        const a = lp(st, "lp1", mix, a160);
        const d = lp(st, "lp2", a, a160);
        const far = lp(st, "lp3", d, a350);
        return limit(far * (1 + 0.14 * Math.sin(phase * 5.2)) * 2.45);
      }
      const deep = lp(st, "lp1", b, a80);
      const duct = lp(st, "lp3", lp(st, "lp2", p, a160), a350);
      const smooth = lp(st, "air", white, a6k);
      const hiss = smooth - lp(st, "lp4", smooth, a1k5);
      const pump = 1 + 0.08 * Math.sin(slow);
      const hum = Math.sin(phase * 58) * (0.032 + 0.01 * deep);
      return limit((deep * 0.85 + duct * 0.28 + hiss * 0.32 + hum) * pump * 1.85);
    };

    node.onaudioprocess = (event) => {
      if (kind !== activeKind) {
        fadeFrom = activeKind;
        activeKind = kind;
        xfade = 0;
      }
      const out = event.outputBuffer.getChannelData(0);
      const phaseStep = (Math.PI * 2) / rate;
      const slowStep = (Math.PI * 2 * 0.28) / rate;
      for (let i = 0; i < out.length; i++) {
        phase += phaseStep;
        if (phase > Math.PI * 2) phase -= Math.PI * 2;
        slow += slowStep;
        if (slow > Math.PI * 2) slow -= Math.PI * 2;
        const white = rand();
        let v = sample(activeKind, white);
        if (xfade < 1) {
          const p = sample(fadeFrom, white);
          v = p + (v - p) * xfade;
          xfade = Math.min(1, xfade + xfadeInc);
        }
        out[i] = v;
      }
    };
    source = node;
    source.connect(gain);
    workletReady = true;
  }
}

const KIND_TITLE = {
  white: "White noise",
  brown: "Brown noise",
  pink: "Pink noise",
  fan: "Fan",
  soft: "Soft fan",
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
  if (source && source.port) source.port.postMessage({ kind });
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
