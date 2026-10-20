import { ShieldCheck, ShieldAlert, LocateFixed } from 'lucide-react';
import { VTheme } from '../../design-system/theme';

// onboardingData.js
// ------------------
// CONVERSION NOTE: mirrors `OnboardingPage.pages` in OnboardingPage.swift.
// SF Symbol names become lucide-react icon components; everything else —
// copy, tint colors — is carried over verbatim.

export const onboardingPages = [
  {
    id: 'purpose',
    icon: ShieldCheck,
    title: 'Your Safety,\nOne Tap Away',
    subtitle:
      'VISHWAS instantly alerts the people you trust the moment you need help — no fumbling through apps in a crisis.',
    tint: VTheme.colors.accent,
  },
  {
    id: 'features',
    icon: ShieldAlert,
    title: 'Built For\nReal Emergencies',
    subtitle:
      'One trigger starts audio, video, and GPS evidence collection automatically, and alerts your contacts with your live location.',
    tint: VTheme.colors.emergency,
  },
  {
    id: 'location',
    icon: LocateFixed,
    title: 'Live Location,\nShared Securely',
    subtitle:
      'Trusted contacts see your real-time location on a map through a private link — only while you choose to share it.',
    tint: '#0a84ff',
  },
];
