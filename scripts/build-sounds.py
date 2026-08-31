#!/usr/bin/env python3
"""Build seamless, loud, phone-friendly loops. Requires numpy."""

from __future__ import annotations

import os
import wave

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RAW = os.path.join(ROOT, "sounds", "raw")
OUT = os.path.join(ROOT, "sounds")
SR = 32000
TARGET_RMS = 10 ** (-14.5 / 20)  # ~0.188, audible on phone speakers
PEAK = 0.91
HP_HZ = 85  # drop sub-bass phones can't play (rattle + "quiet")
LP_HZ = 12000


def biquad(x, b0, b1, b2, a1, a2):
    y = np.empty_like(x)
    z1 = 0.0
    z2 = 0.0
    for i, v in enumerate(x):
        out = b0 * v + z1
        z1 = b1 * v - a1 * out + z2
        z2 = b2 * v - a2 * out
        y[i] = out
    return y


def rbj(kind, fc, sr, q=0.7071):
    w0 = 2 * np.pi * fc / sr
    alpha = np.sin(w0) / (2 * q)
    c = np.cos(w0)
    if kind == "hp":
        b0, b1, b2 = (1 + c) / 2, -(1 + c), (1 + c) / 2
    else:
        b0, b1, b2 = (1 - c) / 2, 1 - c, (1 - c) / 2
    a0 = 1 + alpha
    a1 = -2 * c
    a2 = 1 - alpha
    return b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0


def filter_hp_lp(x, sr):
    x = biquad(x, *rbj("hp", HP_HZ, sr))
    x = biquad(x, *rbj("hp", HP_HZ, sr))
    x = biquad(x, *rbj("lp", LP_HZ, sr))
    return x


def read_wav(path):
    with wave.open(path, "r") as w:
        nch, sw, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    if sw != 2:
        raise SystemExit(f"expected 16-bit wav: {path}")
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float64) / 32768.0
    if nch == 2:
        x = x.reshape(-1, 2).mean(axis=1)
    return x, sr


def write_wav(path, sr, x):
    pcm = np.clip(x, -1, 1)
    pcm = (pcm * 32767.0).astype(np.int16)
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def resample(x, sr_in, sr_out):
    if sr_in == sr_out:
        return x
    n_out = int(round(len(x) * sr_out / sr_in))
    t_in = np.linspace(0.0, 1.0, len(x), endpoint=False)
    t_out = np.linspace(0.0, 1.0, n_out, endpoint=False)
    return np.interp(t_out, t_in, x)


def seamless(x, sr, fade=0.45):
    n = int(sr * fade)
    n = min(n, len(x) // 4)
    fade_in = np.sin(np.linspace(0, np.pi / 2, n))
    fade_out = np.cos(np.linspace(0, np.pi / 2, n))
    out = x[:-n].copy()
    out[:n] = x[:n] * fade_in + x[-n:] * fade_out
    return out


def loud(x):
    rms = np.sqrt(np.mean(x * x) + 1e-12)
    x = x * (TARGET_RMS / rms)
    peak = np.max(np.abs(x))
    if peak > PEAK:
        x *= PEAK / peak
    return x


def pink(white):
    s = np.zeros(7)
    out = np.empty_like(white)
    for i, w in enumerate(white):
        s[0] = 0.99886 * s[0] + w * 0.0555179
        s[1] = 0.99332 * s[1] + w * 0.0750759
        s[2] = 0.969 * s[2] + w * 0.153852
        s[3] = 0.8665 * s[3] + w * 0.3104856
        s[4] = 0.55 * s[4] + w * 0.5329522
        s[5] = -0.7616 * s[5] - w * 0.016898
        out[i] = (s[0] + s[1] + s[2] + s[3] + s[4] + s[5] + s[6] + w * 0.5362) * 0.11
        s[6] = w * 0.115926
    return out


def finish(x, sr_in, extra_trim=0.35):
    x = resample(x, sr_in, SR)
    trim = int(SR * extra_trim)
    if trim * 2 < len(x):
        x = x[trim:]
    x = filter_hp_lp(x, SR)
    x = x[int(SR * 0.2) :]  # drop filter settle
    x = seamless(x, SR)
    return loud(x)


def generated():
    rng = np.random.default_rng(20260831)
    n = int(SR * 18)
    extra = int(SR * 1.2)
    white = rng.standard_normal(n + extra)
    w = finish(white, SR, extra_trim=0.8)
    write_wav(os.path.join(OUT, "white.wav"), SR, w)

    p = finish(pink(white), SR, extra_trim=0.8)
    write_wav(os.path.join(OUT, "pink.wav"), SR, p)

    brown = np.cumsum(white)
    brown -= np.mean(brown)
    b = finish(brown, SR, extra_trim=0.8)
    write_wav(os.path.join(OUT, "brown.wav"), SR, b)


def from_recording(src, dest):
    x, sr = read_wav(src)
    x = finish(x, sr, extra_trim=0.15)
    write_wav(os.path.join(OUT, dest), SR, x)


def stats(path):
    x, sr = read_wav(path)
    rms = np.sqrt(np.mean(x * x))
    print(
        f"{os.path.basename(path):12} {len(x)/sr:5.1f}s  rms {rms:.3f}  "
        f"{20*np.log10(rms):6.1f} dBFS  peak {np.max(np.abs(x)):.3f}"
    )


def main():
    os.makedirs(OUT, exist_ok=True)
    generated()
    from_recording(os.path.join(RAW, "fan-floor.wav"), "fan.wav")
    from_recording(os.path.join(RAW, "soft-heater.wav"), "soft.wav")
    from_recording(os.path.join(RAW, "ac-window.wav"), "ac.wav")
    print("built:")
    for name in ("white", "brown", "pink", "fan", "soft", "ac"):
        stats(os.path.join(OUT, f"{name}.wav"))


if __name__ == "__main__":
    main()
