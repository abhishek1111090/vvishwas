// formatDate.js
// -------------
// CONVERSION NOTE: mirrors the various `.formatted(date: .omitted, time: .shortened)`
// / `.standard` calls scattered through RecentActivityList.swift and
// EmergencyActiveView.swift. Intl.DateTimeFormat is the web's locale-aware
// equivalent of Swift's Date.FormatStyle.

const shortTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

const standardTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});

/** e.g. "9:41 AM" — mirrors `.formatted(date: .omitted, time: .shortened)` */
export function formatShortTime(date) {
  return shortTimeFormatter.format(new Date(date));
}

/** e.g. "9:41:07 AM" — mirrors `.formatted(date: .omitted, time: .standard)` */
export function formatStandardTime(date) {
  return standardTimeFormatter.format(new Date(date));
}

const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
});

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** e.g. "20 Oct" */
export function formatShortDate(date) {
  return shortDateFormatter.format(new Date(date));
}

/** e.g. "20 Oct 2026, 9:41 AM" */
export function formatDateTime(date) {
  return dateTimeFormatter.format(new Date(date));
}

/** e.g. "4m 12s" between two ISO timestamps */
export function formatDuration(startIso, endIso) {
  const ms = Math.max(0, new Date(endIso) - new Date(startIso));
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
