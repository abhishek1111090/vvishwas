import { Text, Pressable, View, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme, withAlpha, radius, spacing, font } from '../theme/theme';

// ui.jsx — VISHWAS design-system primitives (mirrors the web app's
// Button / Card / StatusPill / IconBadge and the VFont text scale).

/** Text in one of the VFont styles: display | title | headline | body | subheadline | caption. */
export function VText({ variant = 'body', color, secondary = false, style, ...rest }) {
  const { colors } = useTheme();
  return (
    <Text
      style={[font[variant], { color: color ?? (secondary ? colors.textSecondary : colors.textPrimary) }, style]}
      {...rest}
    />
  );
}

export function PrimaryButton({ children, onPress, disabled = false, loading = false, destructive = false, icon: Icon, style, accessibilityLabel }) {
  const { colors } = useTheme();
  const bg = destructive ? colors.emergency : colors.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (typeof children === 'string' ? children : undefined)}
      accessibilityState={{ disabled: disabled || loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color="#fff" /> : Icon ? <Icon size={18} color="#fff" strokeWidth={2.25} /> : null}
      <Text style={[font.headline, styles.buttonText, { color: '#fff' }]}>{children}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ children, onPress, disabled = false, icon: Icon, color, style, accessibilityLabel }) {
  const { colors } = useTheme();
  const tint = color ?? colors.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (typeof children === 'string' ? children : undefined)}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { borderWidth: 1.5, borderColor: colors.separator, backgroundColor: 'transparent', opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
        style,
      ]}
    >
      {Icon ? <Icon size={18} color={tint} strokeWidth={2.25} /> : null}
      <Text style={[font.headline, styles.buttonText, { color: tint }]}>{children}</Text>
    </Pressable>
  );
}

export function Card({ children, style }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.backgroundSecondary, shadowColor: colors.shadow }, style]}>
      {children}
    </View>
  );
}

export function StatusPill({ text, color, icon: Icon }) {
  return (
    <View style={[styles.pill, { backgroundColor: withAlpha(color, 0.14) }]}>
      {Icon ? <Icon size={14} color={color} strokeWidth={2.4} /> : <View style={[styles.dot, { backgroundColor: color }]} />}
      <Text style={[font.caption, { color, fontWeight: '700' }]}>{text}</Text>
    </View>
  );
}

export function IconBadge({ icon: Icon, tint, size = 40 }) {
  return (
    <View style={[styles.badge, { width: size, height: size, backgroundColor: withAlpha(tint, 0.15) }]}>
      <Icon size={size * 0.5} color={tint} strokeWidth={2.2} />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: radius.medium,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    alignSelf: 'stretch',
  },
  buttonText: { textAlign: 'center' },
  card: {
    borderRadius: radius.large,
    padding: spacing.md,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badge: { borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
