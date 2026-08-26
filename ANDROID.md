# Android (Capacitor)

Native wrap so noise keeps playing with the screen locked via a **mediaPlayback foreground service** (lock-screen / notification controls).

## Build / install

```bash
npm install
npm run apk
# APK: android/app/build/outputs/apk/release/app-release.apk
```

Phone via USB:

```bash
npm run apk:debug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Release signing uses `android/key.properties` + `android/release.keystore` (gitignored). Copy from `key.properties.example`.

## After install (important on Android)

1. Allow **notifications** when prompted (needed for the media foreground service).
2. Settings → Apps → Noise → Battery → **Unrestricted** (or no restrictions). Xiaomi/Samsung/Huawei often kill media apps otherwise.
3. Press Play — you should see a media notification; lock the phone and audio should continue.

## Web vs Android

| | GitHub Pages PWA | This APK |
|---|---|---|
| Install | Chrome → Install app | APK / Android Studio |
| Locked screen | Often dies in ~5–10 min | Foreground media service |
| Battery | Worse (Chrome + Doze fight) | Better when unrestricted |

Rebuild web assets into the app after UI changes:

```bash
npm run sync
```
