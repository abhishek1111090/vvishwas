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
