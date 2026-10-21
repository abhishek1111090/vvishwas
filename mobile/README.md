# VISHWAS — React Native (Expo) app

The VISHWAS women's-safety app rebuilt in **React Native with Expo SDK 58**
so it runs natively on iPhone and Android — and can be tested on an iPhone
from a Windows PC with **Expo Go** (no Mac, no cable, no paid Apple account).

Same features, flows, copy and design as the original React app; the SOS
logic (`emergencyManager.trigger(source)` as the single trigger, honest
alert/recording status, persisted history) is carried over unchanged in
spirit and largely in code.

## Run it on your iPhone with Expo Go

1. Install **Expo Go** from the App Store (it must support SDK 58).
2. Put the iPhone and this PC on the **same Wi-Fi**.
3. In this folder:
   ```bash
   npm install
   npx expo start
   ```
4. Scan the QR code with the iPhone **Camera** app → "Open in Expo Go".

If the phone can't connect (public/campus Wi-Fi often blocks it), use a
tunnel instead: `npx expo start --tunnel`. If Windows Firewall asks about
Node.js, allow it on private networks.

## Scripts

```bash
npm test          # Jest (jest-expo): services + Expo Router UI flows
npm run lint      # ESLint (eslint-config-expo)
npx expo-doctor   # dependency/config health check
```

## Structure

```
src/app/                 Expo Router routes
  _layout.jsx            loads storage + session, providers
  index.jsx              onboarding → auth → home redirect
  onboarding.jsx, auth.jsx
  (tabs)/_layout.jsx     tab bar, global triple-tap SOS, emergency overlay
  (tabs)/home|contacts|profile|history.jsx
src/features/            auth sheets, contacts, permissions, SOS UI
src/context/             AppState, Auth, Permissions, Contacts, Emergency
src/services/            emergencyManager, emergencyController, recording,
                         location, alerts, notifications, permissions, auth, contacts
src/components/ src/theme/ src/utils/
src/__tests__/           Jest tests
```

## Device features (all available in Expo Go)

| Feature | Module | Notes |
|---|---|---|
| Live location | expo-location | foreground only |
| Video evidence | expo-camera `recordAsync` | live preview on the SOS screen |
| Audio evidence | expo-audio recorder | |
| Private recording storage | expo-file-system | moved to app Documents/recordings |
| SMS alert | expo-sms | opens Messages prefilled — see below |
| Status notification | expo-notifications (local) | |
| Haptics, battery | expo-haptics, expo-battery | |
| Secure storage | expo-secure-store | password hashes + session in Keychain/Keystore |
| Contact picker, photo | expo-contacts, expo-image-picker | |

### What the SMS alert can and can't confirm

iOS never lets an app send SMS silently. On **iPhone**, when SOS triggers
VISHWAS opens Messages **automatically** (as a sheet — recording keeps
running) with every contact and your location filled in; you press Send.
iOS tells the app whether you sent or cancelled, and the SOS screen shows
exactly that. On **Android** the SMS app is opened from a "Text contacts"
button and VISHWAS can only say it was opened, not that it was sent.
Automatic alerts need a server (`EXPO_PUBLIC_VISHWAS_API_URL`, see
`.env.example`), which reports "Accepted by server", never "Delivered".

## Known limitations

- Accounts are **device-local** (no auth server yet); password reset needs the server.
- **Foreground only**: iOS stops camera/microphone/location when the app is
  in the background. Background modes need a development build and are not set up.
- A video in progress lives in the cache until the SOS ends; if the app is
  killed mid-emergency the partial video may be lost (audio likewise).
- Expo Go can't add custom native code (e.g. Android's automatic `SEND_SMS`
  from the Capacitor version). A development build (`eas build`) would allow it.
- Safety Timer, Fake Call, Check In, Safe Route remain "coming soon".

## Physical-device checklist (iPhone)

1. Onboarding → each permission card shows the iOS prompt; deny one → "Blocked" → Settings opens VISHWAS.
2. Home shows real battery % and "Location OK" (outdoors) / "No Location" (Location Services off).
3. SOS → confirm → camera preview + Audio/Video "Recording" → GPS fix → Messages opens with the alert.
4. Press Send → contact shows "Sent from Messages"; Cancel → "Not sent — SMS cancelled".
5. "I'm Safe" → History → audio and video play back.
6. Triple-tap anywhere → instant SOS; triple-tap again → no second session.
7. Kill the app mid-SOS → reopen → session restored, "Restart recording" works.
8. Small (iPhone SE) and large screens, dark mode, keyboard on Sign Up / Add Contact.
