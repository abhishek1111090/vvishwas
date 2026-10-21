import { Text, View, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme, withAlpha, radius, spacing, font, fonts, elevation } from '../theme/theme';
import { PressableScale, PulseDot } from './motion';

// ui.jsx — VISHWAS design-system primitives ("Kinetic Sentinel"):
// ink-black pill buttons, white bordered cards, monochrome badges, and
// colour only for status (red danger, green safe, amber attention).

const WEIGHT = { regular: fonts.regular, medium: fonts.medium, semibold: fonts.semibold, bold: fonts.bold, heavy: fonts.heavy };

/** Text in a type style; optional `weight` swaps the Inter family. */
export function VText({ variant = 'body', color, secondary = false, tertiary = false, weight, style, ...rest }) {
  const { colors } = useTheme();
  const tone = color ?? (tertiary ? colors.textTertiary : secondary ? colors.textSecondary : colors.textPrimary);
  return <Text style={[font[variant], weight && { fontFamily: WEIGHT[weight] }, { color: tone }, style]} {...rest} />;
}

/** Filled pill — ink by default, red when destructive. */
export function PrimaryButton({ children, onPress, disabled = false, loading = false, destructive = false, inverted = false, icon: Icon, style, accessibilityLabel }) {
  const { colors } = useTheme();
  const bg = destructive ? colors.danger : inverted ? colors.onInk : colors.ink;
  const fg = destructive ? '#FFFFFF' : inverted ? colors.ink : colors.onInk;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (typeof children === 'string' ? children : undefined)}
      accessibilityState={{ disabled: disabled || loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={[styles.button, { backgroundColor: bg, opacity: disabled ? 0.4 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : Icon ? <Icon size={18} color={fg} strokeWidth={2.2} /> : null}
      <Text style={[font.headline, { color: fg }]}>{children}</Text>
    </PressableScale>
  );
}

/** Outlined pill. */
export function SecondaryButton({ children, onPress, disabled = false, icon: Icon, color, style, accessibilityLabel }) {
  const { colors } = useTheme();
  const tint = color ?? colors.textPrimary;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (typeof children === 'string' ? children : undefined)}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, { borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, opacity: disabled ? 0.4 : 1 }, style]}
    >
      {Icon ? <Icon size={18} color={tint} strokeWidth={2.2} /> : null}
      <Text style={[font.headline, { color: tint }]}>{children}</Text>
    </PressableScale>
  );
}

/** White card with a hairline border and a whisper of shadow. */
export function Card({ children, style, padded = true }) {
  const { colors, isDark } = useTheme();
  return (
    <View
      style={[
        styles.card,
        padded && { padding: spacing.md },
        { backgroundColor: colors.surface, borderColor: colors.border },
        !isDark && elevation.card,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Small pill label. tone: ink | outline | muted | safe | danger | warning */
export function Badge({ text, tone = 'ink', icon: Icon }) {
  const { colors } = useTheme();
  const map = {
    ink: { bg: colors.ink, fg: colors.onInk, border: colors.ink },
    outline: { bg: 'transparent', fg: colors.textPrimary, border: colors.border },
    muted: { bg: colors.surfaceMuted, fg: colors.textSecondary, border: colors.surfaceMuted },
    safe: { bg: colors.safeTint, fg: colors.safe, border: colors.safeTint },
    danger: { bg: colors.dangerTint, fg: colors.danger, border: colors.dangerTint },
    warning: { bg: colors.warningTint, fg: colors.warning, border: colors.warningTint },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: map.bg, borderColor: map.border }]}>
      {Icon ? <Icon size={11} color={map.fg} strokeWidth={2.6} /> : null}
      <Text style={[font.overline, { color: map.fg, fontSize: 10, letterSpacing: 0.8 }]}>{text}</Text>
    </View>
  );
}

/** Status pill with a live pulsing dot (e.g. "Active", "Setup needed"). */
export function StatusPill({ text, tone = 'safe', live = true }) {
  const { colors } = useTheme();
  const c = tone === 'safe' ? colors.safe : tone === 'danger' ? colors.danger : colors.warning;
  const bg = tone === 'safe' ? colors.safeTint : tone === 'danger' ? colors.dangerTint : colors.warningTint;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <PulseDot color={c} size={7} active={live} />
      <Text style={[font.caption, { color: c, fontFamily: fonts.semibold }]}>{text}</Text>
    </View>
  );
}

/** Square icon well — monochrome by default. */
export function IconTile({ icon: Icon, tone = 'muted', size = 40 }) {
  const { colors } = useTheme();
  const map = {
    muted: { bg: colors.surfaceMuted, fg: colors.textPrimary },
    ink: { bg: colors.ink, fg: colors.onInk },
    danger: { bg: colors.dangerTint, fg: colors.danger },
    safe: { bg: colors.safeTint, fg: colors.safe },
    warning: { bg: colors.warningTint, fg: colors.warning },
  }[tone];
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: size * 0.32, backgroundColor: map.bg }]}>
      <Icon size={size * 0.48} color={map.fg} strokeWidth={2} />
    </View>
  );
}

/** Round icon button (call, message, add …). */
export function IconButton({ icon: Icon, onPress, label, tone = 'muted', size = 40 }) {
  const { colors } = useTheme();
  const bg = tone === 'ink' ? colors.ink : tone === 'danger' ? colors.dangerTint : colors.surfaceMuted;
  const fg = tone === 'ink' ? colors.onInk : tone === 'danger' ? colors.danger : colors.textPrimary;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      scaleTo={0.9}
      style={[styles.iconBtn, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}
    >
      <Icon size={size * 0.42} color={fg} strokeWidth={2.2} />
    </PressableScale>
  );
}

/** Uppercase section label with optional right-hand accessory. */
export function SectionHeader({ title, right }) {
  return (
    <View style={styles.section}>
      <VText variant="overline" secondary>{title}</VText>
      {right}
    </View>
  );
}

/** Initials avatar. */
export function Avatar({ name, size = 44, tone = 'ink' }) {
  const { colors } = useTheme();
  const initials = (name ?? 'V').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const bg = tone === 'ink' ? colors.ink : colors.surfaceMuted;
  const fg = tone === 'ink' ? colors.onInk : colors.textPrimary;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: fonts.bold, fontSize: size * 0.36, color: fg }}>{initials}</Text>
    </View>
  );
}

export { withAlpha };

const styles = StyleSheet.create({
  button: {
    minHeight: 54,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    alignSelf: 'stretch',
  },
  card: { borderRadius: radius.large, borderWidth: StyleSheet.hairlineWidth },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill },
  tile: { alignItems: 'center', justifyContent: 'center' },
  iconBtn: { alignItems: 'center', justifyContent: 'center' },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
});
