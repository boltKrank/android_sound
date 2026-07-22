# Soundboard (Capacitor / Android)

A push-button soundboard: define pads as name + sound-file pairs in the browser UI,
hit **Build**, and invalid pads (no name, no file, or a file that won't decode as
audio) get filtered out automatically. What's left renders as a grid of playable pads.

## Try it in a browser first

No build step needed to preview the front end:

```bash
cd www
python3 -m http.server 8080
# open http://localhost:8080
```

Add a few pads, pick sound files (mp3/wav/ogg — anything the browser can decode),
hit **Build soundboard**, and tap pads. Everything (pad list + audio) is saved
locally (localStorage + IndexedDB) so it survives a refresh.

## Two names, two different places

- **Page title** — set in the app's Settings panel, takes effect immediately, just changes
  the heading/tab title inside the app.
- **App / APK name** — the Android launcher icon's label. This is a *build-time*
  setting Capacitor bakes into the native project, so it has to be synced separately
  (see step 3 below).

## Turning this into an installable Android app

**1. Install Capacitor**

```bash
npm install
```

**2. Add the Android platform**

```bash
npx cap add android
```

This generates the `android/` folder using the `appName` / `appId` currently in
`capacitor.config.json`.

**3. Set your app name and package ID**

Either edit `capacitor.config.json` directly, or use the helper script:

```bash
node configure.js --name "Meme Blaster" --appId com.yourname.memeblaster
```

Run this *after* `cap add android` too (or re-run it) — it also patches
`android/app/src/main/res/values/strings.xml` so the launcher icon label matches.

You can also export your settings from the in-app **Export config.json** button and
point the script at it:

```bash
node configure.js --from www/config.json
```

**4. Sync web assets into the native project**

```bash
npx cap sync android
```

Run this any time you change files in `www/`.

**5. Build the APK**

```bash
npx cap open android
```

This opens the project in Android Studio — build a debug APK from there
(`Build > Build Bundle(s) / APK(s) > Build APK(s)`), or use `./gradlew assembleDebug`
inside `android/` if you'd rather stay on the command line.

## How validation works

On **Build**, each pad entry is checked for:
1. A non-empty name.
2. A sound file selected.
3. The file actually decoding via the Web Audio API (`decodeAudioData`) — this
   catches corrupt files or unsupported formats, not just missing ones.

Anything that fails is listed under the build button and left out of the board,
so a bad row never breaks the rest of the soundboard.

## Notes / next steps

- Audio playback uses the Web Audio API (decode once, play from an in-memory
  buffer) rather than `<audio>` tags, so repeated taps stay low-latency.
- Sound files currently live in IndexedDB inside the WebView. If you'd rather ship
  a fixed set of built-in sounds, drop files into `www/sounds/` and reference them
  by path instead of importing per-device.
- For a fully native (non-WebView) build, the "Option B" approach mentioned earlier
  — a Kotlin app using `SoundPool`, fed by the same name/sound JSON — would give
  slightly lower playback latency if that becomes a priority.
