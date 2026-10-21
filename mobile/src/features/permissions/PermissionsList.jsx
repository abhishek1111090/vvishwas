import { View, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { MapPin, Video, Mic, Bell, CheckCircle2, AlertCircle, MinusCircle } from 'lucide-react-native';
import { usePermissions } from '../../context/PermissionsContext';
import { PermissionStatus } from '../../services/permissionsService';
import { haptics } from '../../services/hapticService';
import { Card, VText } from '../../components/ui';
import { useTheme, withAlpha, radius } from '../../theme/theme';

/**
 * PermissionsList — one card per permission (onboarding + Account).
 * Explains WHY, shows the real OS status, offers the right action:
 *   not asked → Allow (OS dialog) · denied → Retry · blocked → Settings
 */

export const PERMISSION_ITEMS = [
  {
    kind: 'location',
    icon: MapPin,
    tint: '#0a84ff',
    title: 'Live GPS Location',
    purpose: 'Puts your exact coordinates in the alert to your trusted contacts while an emergency is active. Not used in the background.',
  },
  {
    kind: 'camera',
    icon: Video,
    tint: '#af52de',
    title: 'Evidence Camera',
    purpose: 'Records video evidence when SOS triggers. Recordings stay in VISHWAS’s private storage on this phone.',
  },
  {
    kind: 'microphone',
    icon: Mic,
    tint: '#ff9500',
    title: 'Evidence Microphone',
    purpose: 'Records ambient audio evidence during an emergency. Never used outside an active SOS.',
  },
  {
    kind: 'notifications',
    icon: Bell,
    tint: '#e0203a',
    title: 'Emergency Status Alerts',
    purpose: 'Shows an "emergency active" notification so you can get back to the SOS screen in one tap.',
  },
];

function PermissionCard({ item, status, onRequest, onOpenSettings }) {
  const { colors } = useTheme();
  const { icon: Icon, tint, title, purpose } = item;
  const granted = status === PermissionStatus.granted;
  const requesting = status === PermissionStatus.requesting;
  const denied = status === PermissionStatus.denied;
  const blocked = status === PermissionStatus.blocked;
  const unavailable = status === PermissionStatus.unavailable;

  let actionLabel = 'Allow';
  if (denied) actionLabel = 'Retry';
  if (blocked) actionLabel = 'Settings';

  async function handlePress() {
    haptics.light();
    if (blocked) await onOpenSettings();
    else await onRequest();
  }

  return (
    <Card>
      <View style={styles.row}>
        <View style={[styles.iconWrap, { backgroundColor: withAlpha(tint, 0.12) }]}>
          <Icon size={20} color={tint} strokeWidth={2.2} />
        </View>
        <View style={styles.copy}>
          <View style={styles.header}>
            <VText variant="headline" style={styles.title}>{title}</VText>
            {granted && <Tag icon={CheckCircle2} text="Granted" color={colors.safe} />}
            {(denied || blocked) && <Tag icon={AlertCircle} text="Blocked" color={colors.emergency} />}
            {unavailable && <Tag icon={MinusCircle} text="Not available" color={colors.textSecondary} />}
          </View>
          <VText variant="caption" secondary>{purpose}</VText>
          {blocked && (
            <VText variant="caption" color={colors.emergency}>
              Your phone won’t ask again. Tap Settings and allow it for VISHWAS.
            </VText>
          )}
          {denied && <VText variant="caption" color={colors.emergency}>Denied. Tap Retry to be asked again.</VText>}
        </View>
        {!granted && !unavailable && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${actionLabel} ${title} permission`}
            onPress={handlePress}
            disabled={requesting}
            style={[styles.action, { backgroundColor: blocked || denied ? withAlpha(colors.emergency, 0.12) : colors.accent }]}
          >
            {requesting ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <VText variant="caption" color={blocked || denied ? colors.emergency : '#fff'} style={{ fontWeight: '700' }}>
                {actionLabel}
              </VText>
            )}
          </Pressable>
        )}
      </View>
    </Card>
  );
}

function Tag({ icon: Icon, text, color }) {
  return (
    <View style={[styles.tag, { backgroundColor: withAlpha(color, 0.12) }]}>
      <Icon size={12} color={color} strokeWidth={2.5} />
      <VText variant="caption" color={color} style={{ fontSize: 11, fontWeight: '700' }}>{text}</VText>
    </View>
  );
}

export function PermissionsList() {
  const { statuses, request, openAppSettings, lastError } = usePermissions();
  const { colors } = useTheme();
  return (
    <View style={styles.list}>
      {PERMISSION_ITEMS.map((item) => (
        <PermissionCard
          key={item.kind}
          item={item}
          status={statuses[item.kind]}
          onRequest={() => request(item.kind)}
          onOpenSettings={openAppSettings}
        />
      ))}
      {lastError ? <VText variant="caption" color={colors.emergency}>{lastError}</VText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 4 },
  header: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  title: { flexShrink: 1 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill },
  action: { minWidth: 72, minHeight: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, alignSelf: 'center' },
});
