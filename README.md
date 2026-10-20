# VISHWAS — React Web App (Phase 1)

A complete React port of the VISHWAS Phase 1 SwiftUI iOS app. Every screen,
service, and design-system component has been converted 1:1 from Swift into
production-grade React, with inline comments throughout each file explaining
exactly how the SwiftUI concept maps to the React equivalent.

**Build status: ✅ passes `npm run build` and `npm run lint` with zero errors.**

---

## Folder structure

```
src/
├── app/
│   ├── App.jsx               ← mirrors VISHWASApp.swift (@main entry + providers)
│   └── RootRouter.jsx        ← mirrors RootRouterView.swift (onboarding/auth/home branching)
├── components/               ← shared UI components used across multiple pages
│   ├── BottomSheet.jsx/css   ← mirrors .sheet(isPresented:) / .presentationDetents([.medium])
│   ├── ComingSoonModal.jsx   ← placeholder for Phase 2–4 quick-action features
│   ├── LabeledField.jsx      ← mirrors LabeledField in SignUpView.swift
│   ├── ProtectedRoute.jsx    ← auth/onboarding guard (mirrors RootRouterView.swift branching)
│   └── SheetHeader.jsx       ← mirrors .navigationTitle + .toolbar { ToolbarItem(.cancellationAction) }
├── context/
│   ├── AppStateContext.jsx   ← mirrors AppState.swift (onboarding flag)
│   ├── AuthContext.jsx       ← mirrors AppState.swift (user/session) + AuthViewModel.swift
│   ├── ContactsContext.jsx   ← mirrors SwiftData @Query reactivity for ContactsListView
│   ├── EmergencyContext.jsx  ← mirrors @Environment(EmergencyManager.self)
│   └── PermissionsContext.jsx← mirrors PermissionsManager.swift (@Observable singleton)
├── design-system/
│   ├── theme.css             ← CSS custom properties mirroring VTheme color/spacing/radius tokens
│   ├── theme.js              ← JS-readable mirror of the same tokens (for inline styles)
│   ├── typography.css        ← utility classes mirroring VFont's Dynamic Type scale
│   └── components/
│       ├── Button.jsx/css    ← mirrors PrimaryButtonStyle / SecondaryButtonStyle
│       ├── Card.jsx/css      ← mirrors CardContainer.swift
│       └── StatusPill.jsx/css← mirrors StatusPill + IconBadge
├── pages/
│   ├── auth/
│   │   ├── WelcomePage.jsx   ← mirrors WelcomeAuthView.swift
│   │   ├── SignUpSheet.jsx   ← mirrors SignUpView.swift
│   │   ├── SignInSheet.jsx   ← mirrors SignInView.swift
│   │   └── ForgotPasswordSheet.jsx ← mirrors ForgotPasswordView.swift
│   ├── contacts/
│   │   ├── ContactsListPage.jsx    ← mirrors ContactsListView.swift
│   │   ├── ContactRow.jsx          ← mirrors ContactRow.swift
│   │   ├── AddEditContactModal.jsx ← mirrors AddEditContactView.swift
│   │   └── ImportContactsModal.jsx ← mirrors ContactPickerView.swift
│   ├── home/
│   │   ├── HomePage.jsx            ← mirrors HomeView.swift
│   │   ├── SafetyStatusCard.jsx    ← mirrors SafetyStatusCard.swift
│   │   ├── QuickActionsGrid.jsx    ← mirrors QuickActionsGrid.swift
│   │   └── RecentActivityList.jsx  ← mirrors RecentActivityList.swift
│   ├── onboarding/
│   │   ├── OnboardingFlow.jsx      ← mirrors OnboardingView.swift (TabView paging)
│   │   ├── OnboardingPageView.jsx  ← mirrors OnboardingPageView struct
│   │   ├── PermissionsSetupView.jsx← mirrors PermissionsSetupView.swift
│   │   └── onboardingData.js       ← mirrors OnboardingPage.pages static array
│   └── sos/
│       ├── SOSButton.jsx           ← mirrors SOSButton.swift (pulsing rings, presentational)
│       ├── SOSConfirmModal.jsx     ← mirrors SOSConfirmSheet.swift
│       └── EmergencyActiveOverlay.jsx ← mirrors EmergencyActiveView.swift
├── services/
│   ├── authService.js        ← mirrors AuthService.swift (local Phase 1 stub, SHA-256 via Web Crypto)
│   ├── contactsService.js    ← mirrors PersistenceController.swift + EmergencyContact @Model
│   ├── emergencyManager.js   ← mirrors EmergencyManager.swift (THE canonical trigger)
│   ├── hapticService.js      ← mirrors HapticManager.swift (Vibration API where available)
│   └── permissionsService.js ← mirrors PermissionsManager.swift's platform wrappers
└── utils/
    ├── constants.js          ← mirrors KeychainKey + scattered UserDefaults string keys
    ├── formatDate.js         ← mirrors Swift Date.FormatStyle usage
    ├── storage.js            ← thin localStorage JSON helper (replaces UserDefaults + SwiftData)
    ├── useBattery.js         ← mirrors UIDevice.current.batteryLevel + 30s Timer
    ├── useTripleTap.js       ← mirrors TripleTapTrigger.swift's ViewModifier
    └── validation.js         ← mirrors AuthViewModel's isValidEmail, password-length guard
```

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle → dist/
npm run lint       # zero warnings, zero errors
```

---

## Key architecture decisions

### SwiftUI → React conversion map

| SwiftUI | React equivalent |
|---|---|
| `@Observable` class | `useSyncExternalStore` (EmergencyManager) or `useState` + Context |
| `@Environment(..)` | React Context + custom hook (`useEmergency()`, `useAuth()`, …) |
| `@Query` (SwiftData) | `ContactsContext` — shared state array updated on every mutation |
| `NavigationStack` / `NavigationLink` | React Router `<Routes>` + `<Link>` + `useNavigate()` |
| `.sheet(isPresented:)` | `<BottomSheet isOpen={…}>` rendered conditionally |
| `.fullScreenCover(isPresented:)` | `position: fixed` `<EmergencyActiveOverlay>` with no close button |
| `ViewModifier` (TripleTapTrigger) | `useTripleTap()` custom hook |
| SwiftData `ModelContainer` | `localStorage` via `contactsService.js` |
| `Keychain` | `localStorage` *(see security note below)* |
| `UserDefaults` | `localStorage` |
| `UIDevice.current.batteryLevel` + `Timer` | `useBattery()` (Battery Status API, event-driven) |
| `AVFoundation` / `CoreLocation` permissions | `permissionsService.js` (browser Permissions API) |
| `UIFeedbackGenerator` (Taptic Engine) | `hapticService.js` (Vibration API, Android Chrome only) |
| `Dynamic Type` | `rem` units + `prefers-reduced-motion` |
| `Color.primary` / `systemBackground` | CSS custom properties with `prefers-color-scheme` |
| `@main` struct | `main.jsx` + `App.jsx` |

### The ONE canonical SOS trigger

`emergencyManager.trigger(source)` in `src/services/emergencyManager.js` is
the **only** path that starts an emergency session. Every entry point routes
through it:

- **Manual SOS button** → user confirms in `SOSConfirmModal` → calls
  `emergency.trigger('button')`
- **Triple-tap anywhere on home screen** → bypasses confirmation, calls
  `emergency.trigger('tripleTap')` directly via `useTripleTap()`
- **Phase 2+** voice, watch, Siri equivalent → will also call
  `emergencyManager.trigger(source)` directly, bypassing confirmation

This mirrors the exact architecture lesson from the companion React (Node/Express)
app in this project: a second trigger path that doesn't go through the same
state machine as the button was the root cause of a real voice-activation bug
found and fixed during development. The pattern is intentional.

---

## Important notes

### Auth is a Phase 1 local stub

`authService.js` hashes passwords with SHA-256 (via the browser's built-in
`crypto.subtle` — the JS equivalent of CryptoKit) and stores everything in
`localStorage`. There is no server. When you add the Phase 3 FastAPI backend,
every function in `authService.js` gets rewired to call it instead. The public
shape (`signUp`, `signIn`, `signOut`, `sendPasswordReset`) is unchanged, so
nothing in the UI layer needs updating. Comments marking every spot are labelled
`// TODO: Phase 3`.

### localStorage vs Keychain

`localStorage` is not encrypted at rest. `KeychainService.swift` in the iOS
app stored credentials in the Secure Enclave. The Phase 3 backend adds proper
JWT sessions, at which point only a short-lived token — not a password hash —
ever lives in the browser, which is the correct web-equivalent security posture.
**Do not ship Phase 1's auth to real users.**

### Apple Sign In

The "Sign in with Apple" button calls `authService.signInWithApplePlaceholder()`
which creates a local demo user — exactly the same Phase 1 stub as the iOS
version. A real implementation needs Apple's
[Sign in with Apple JS](https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_js)
SDK plus a registered Services ID and redirect URI. The button is wired and
styled correctly; only the SDK call needs to be swapped in.

### Haptic feedback

`hapticService.js` uses the Vibration API, which only works on Android Chrome
(over HTTPS, in response to a user gesture). iOS Safari doesn't expose it. All
calls are silent no-ops everywhere else — same "call it unconditionally, let
the platform decide" approach as the Swift `HapticManager`.

---

## What's not here yet (later phases)

| Phase | Features |
|---|---|
| 2 | Live location sharing (Geolocation watchPosition, map view), audio/video evidence recording (MediaRecorder), push/SMS/email alert sending, media encryption |
| 3 | FastAPI + PostgreSQL + Redis + S3 + WebSocket backend, JWT auth (replaces local stub), real Apple Sign In with backend token exchange |
| 4 | Siri Shortcuts equivalent (Web Share API / PWA shortcuts), safety timer, fake call, check-in, safe route, searchable emergency history, Face ID equivalent (WebAuthn), analytics |
