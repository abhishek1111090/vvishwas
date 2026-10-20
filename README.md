# VISHWAS — Women's Safety & Emergency Response (Android + iOS)

VISHWAS is a React + Vite app packaged as a **native Android and iOS app with
Capacitor 8**. One React codebase runs inside the native WebView; device
features (GPS, camera, microphone, notifications, haptics, battery, SMS,
private file storage) go through Capacitor plugins plus a small app-local
native plugin (`VishwasNative`).

- App name: **VISHWAS**
- App ID / bundle ID: **`com.vishwas.safety`**
- Android: minSdk 24 (Android 7.0), target/compile SDK 36
- iOS: 15.0+ (Swift Package Manager, no CocoaPods)

---

## Building

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22+ | Capacitor 8 CLI requirement |
| JDK | 21 | Android Gradle Plugin requirement (JDK 25 is too new) |
| Android SDK | platform 36, build-tools 36 | Android Studio, or command-line tools |
| Xcode | 16+ on macOS | iOS only |

### Web build + tests

```bash
npm install
npm run lint        # ESLint
npm test            # Vitest (unit + UI flow tests, jsdom)
npm run build       # production bundle → dist/
npm run dev         # browser preview at http://localhost:5173 (development only)
```

### Android debug APK

```bash
npm run build
npx cap sync android
cd android
gradlew assembleDebug          # Windows (./gradlew on macOS/Linux)
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`.
Install on a phone with USB debugging: `adb install -r app/build/outputs/apk/debug/app-debug.apk`,
or open the `android/` folder in Android Studio and press Run.

`android/local.properties` must point at your SDK (`sdk.dir=…`); Android Studio
writes it automatically. Set `JAVA_HOME` to a JDK 21.

**Release build:** create a keystore (`keytool -genkey -v -keystore vishwas.jks …`),
add a `signingConfigs.release` block in `android/app/build.gradle` that reads
the passwords from environment variables (never commit them), then
`gradlew bundleRelease` for a Play Store `.aab`.

### iOS (macOS + Xcode required)

```bash
npm run build
npx cap sync ios
npx cap open ios               # opens ios/App/App.xcodeproj
```

In Xcode: select the **App** target → Signing & Capabilities → choose your
Team → run on a device or simulator. Product → Archive for an IPA.
The iOS project, Info.plist permission strings and the Swift plugin are
configured, but **the iOS app has not been compiled** (this project was
prepared on Windows).

### Optional server

Copy `.env.example` to `.env.local` and set `VITE_VISHWAS_API_URL` (HTTPS)
before `npm run build` to enable server-side alert delivery and password
reset. Without it those features say "not configured" — they never fake success.

---

## Architecture

```
src/
├── app/            App.jsx (providers), RootRouter.jsx (routes + Android back button)
├── platform/       platform.js (native/web detection), vishwasNative.js (native plugin JS API),
│                   backButton.js + useAndroidBackButton.js
├── context/        AppState, Auth, Permissions, Contacts, Emergency
├── services/
│   ├── emergencyManager.js     SOS state machine — emergencyManager.trigger(source) is THE trigger
│   ├── emergencyController.js  orchestrates recording, GPS, alerts, notification, teardown
│   ├── recordingService.js     getUserMedia + MediaRecorder (audio & video, separately)
│   ├── recordingStore.js       streams chunks into app-private files (native) / memory (web)
│   ├── locationService.js      @capacitor/geolocation watch + one-shot, error classification
│   ├── alertService.js         alert payload; server → Android SMS → SMS composer fallback
│   ├── notificationService.js  ongoing "emergency active" notification
│   ├── permissionsService.js   native + browser permission checks/requests
│   ├── authService.js          device-local accounts, PBKDF2 password hashing
│   ├── contactsService.js      validated contact CRUD
│   ├── apiClient.js            optional HTTPS server client (env-configured)
│   └── hapticService.js        @capacitor/haptics (Vibration API fallback)
├── pages/          onboarding, auth, home, contacts, sos, history, profile
└── test/           Vitest setup + fakes

android/app/src/main/java/com/vishwas/safety/VishwasNativePlugin.java
ios/App/App/VishwasNativePlugin.swift
```

### SOS flow

```
SOS button → confirm sheet ─┐
Triple-tap anywhere ────────┴─► emergencyController.startEmergency(source)
                                  └─► emergencyManager.trigger(source)   (refuses if already active)
                                        ├─ recordingService.startAudio / startVideo
                                        ├─ locationService.start (high accuracy, foreground)
                                        ├─ notificationService.showEmergencyActive
                                        └─ alertService.sendAutomatic (after first GPS fix or 15 s)
"I'm Safe" / "False Alarm" ─► stop GPS → flush & stop recorders → clear notification
                              → record real outcomes → session moved to history
```

The active session is persisted on every change. If the app is killed
mid-emergency it is restored on next launch (location tracking resumes; the
overlay offers "Restart recording").

### Contact alerts — what is and isn't confirmed

| Channel | When | Reported status |
|---|---|---|
| VISHWAS server | `VITE_VISHWAS_API_URL` set | "Accepted by server" (not "delivered") |
| Android SMS (`SmsManager`) | Android + SEND_SMS granted | per contact: "Sent to carrier" / "Failed"; "Delivered" only if the carrier sends a delivery report |
| SMS composer | iOS, web, or SMS not granted | "SMS app opened — not confirmed sent" (the user must press Send) |

### Security & privacy

- No plaintext passwords: PBKDF2-HMAC-SHA256, 310 000 iterations, per-user
  random salt; legacy SHA-256 hashes are upgraded on sign-in.
- Same error for unknown email and wrong password.
- Recordings are written to the app's private data directory, never to the
  gallery, Downloads, or a public cache.
- Android backup and device-transfer are disabled (`allowBackup=false`,
  `data_extraction_rules.xml`) so data doesn't leave the phone.
- Cleartext HTTP disabled; the optional server must be HTTPS.
- No secrets in the bundle; `.env*` files are git-ignored.

---

## Known limitations

- **Accounts are device-local.** No auth server exists yet; an account lives
  on one phone. Password reset by email needs the server.
- **Sign in with Apple** is not configured (button shown on iOS only, says so).
- **Foreground only.** Location tracking and recording run while VISHWAS is in
  the foreground. Android 9+ and iOS block camera/microphone access for
  backgrounded apps; true background tracking needs a foreground service
  (Android) / background modes (iOS), which are not implemented.
- **iOS cannot send SMS automatically** — it opens Messages prefilled.
- **Google Play policy:** apps requesting `SEND_SMS` must be approved under
  Play's SMS permissions policy (or not request it). The debug APK works for
  sideloading; a Play release may need a server-side SMS provider instead.
- **Contact picker** uses the Web Contact Picker API, which the Android
  WebView does not provide → "Add Manually" in the app.
- Quick actions (Safety Timer, Fake Call, Check In, Safe Route) remain
  "coming soon", as in the original project.

## Physical-device tests still required

Automated tests run in jsdom with fakes; they do not prove hardware behaviour.
On a real Android phone (and later an iPhone):

1. Install, launch, onboarding → each permission prompt appears with the
   right text; deny one, confirm "Blocked" + **Settings** opens the app page;
   grant it there and return → status updates.
2. Home shows a real "Location OK"/battery %; turn Location off → "No Location".
3. SOS button → confirm → overlay; audio + video show **Recording**; GPS fix
   appears; contacts receive the SMS (check the phones), statuses match.
4. "I'm Safe" → History shows Audio/Video **Saved on device**; **Play** works.
5. Triple-tap → instant SOS; triple-tap again while active → no second session.
6. Airplane mode during SOS → SMS shows **Failed** (not sent).
7. Back button: closes sheets, does nothing on the SOS overlay, minimizes on Home.
8. Kill the app during an SOS → relaunch → session restored.
9. Incoming call / switch apps during SOS → note what recording does.
10. Keyboard on Add Contact / Sign Up keeps the field visible; small (5")
    and large screens; dark mode.
11. Notification "VISHWAS emergency active" appears during SOS and clears after.
