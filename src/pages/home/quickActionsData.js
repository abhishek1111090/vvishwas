import { Timer, PhoneIncoming, BadgeCheck, Map } from 'lucide-react';

// quickActionsData.js
// ---------------------
// CONVERSION NOTE: mirrors the `QuickAction` enum in QuickActionsGrid.swift.
// All four are Phase 2 features per the original's own header comment —
// Phase 1 wires up the navigation shell with "coming soon" placeholders so
// Home's layout doesn't change later, only the destination views get filled in.

export const quickActions = [
  {
    id: 'safetyTimer',
    title: 'Safety Timer',
    subtitle: "Auto-SOS if you don't check in",
    icon: Timer,
    tint: 'var(--color-warning)',
  },
  {
    id: 'fakeCall',
    title: 'Fake Call',
    subtitle: 'Simulate an incoming call',
    icon: PhoneIncoming,
    tint: '#af52de',
  },
  {
    id: 'checkIn',
    title: 'Check In',
    subtitle: "Tell contacts you're safe",
    icon: BadgeCheck,
    tint: 'var(--color-safe)',
  },
  {
    id: 'safeRoute',
    title: 'Safe Route',
    subtitle: 'Find a well-lit, busy path',
    icon: Map,
    tint: '#0a84ff',
  },
];
