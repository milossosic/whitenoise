import { Capacitor } from "@capacitor/core";
import { MediaSession } from "@jofr/capacitor-media-session";

if (!Capacitor.isNativePlatform()) {
  // Web / PWA keeps using navigator.mediaSession in app.js
} else {
  const artwork = [
    { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
  ];

  window.NoiseNativeMedia = {
    async update({ title, playing, paused }) {
      const playbackState = playing ? "playing" : paused ? "paused" : "none";
      await MediaSession.setMetadata({
        title: title || "Noise",
        artist: "Noise",
        album: "Noise",
        artwork,
      });
      await MediaSession.setPlaybackState({ playbackState });
    },
  };

  MediaSession.setActionHandler({ action: "play" }, () => {
    window.dispatchEvent(new CustomEvent("noise-media", { detail: { action: "play" } }));
  });
  MediaSession.setActionHandler({ action: "pause" }, () => {
    window.dispatchEvent(new CustomEvent("noise-media", { detail: { action: "pause" } }));
  });
  MediaSession.setActionHandler({ action: "stop" }, () => {
    window.dispatchEvent(new CustomEvent("noise-media", { detail: { action: "stop" } }));
  });
}
