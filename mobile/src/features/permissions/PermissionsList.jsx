import { View, ActivityIndicator, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { MapPin, Video, Mic, Bell, CheckCircle2, AlertCircle, MinusCircle } from 'lucide-react-native';
import { usePermissions } from '../../context/PermissionsContext';
import { PermissionStatus } from '../../services/permissionsService';
import { haptics } from '../../services/hapticService';
import { Card, Badge, IconTile, VText } from '../../components/ui';
import { PressableScale } from '../../components/motion';
import { useTheme, radius } from '../../theme/theme';

/**
 * PermissionsList — one card per permission (onboarding + Account).
 * Explains WHY, shows the real OS status, offers the right action:
 *   not asked → Allow (OS dialog) · denied → Retry · blocked → Settings
 */

export const PERMISSION_ITEMS = [
  {
    kind: 'location',
    icon: MapPin,
    title: 'Live GPS Location',
    purpose: 'Puts your exact coordinates in the alert to your trusted contacts while an emergency is active. Not used in the background.',
  },
  {
    kind: 'camera',
    icon: Video,
    title: 'Evidence Camera',
    purpose: 'Records video evidence when SOS triggers. Recordings stay in VISHWAS’s private storage on this phone.',
  },
  {
    kind: 'microphone',
    icon: Mic,
    title: 'Evidence Microphone',
    purpose: 'Records ambient audio evidence during an emergency. Never used outside an active SOS.',
  },
  {
    kind: 'notifications',
    icon: Bell,
    title: 'Emergency Status Alerts',
    purpose: 'Shows an "emergency active" notification so you can get back to the SOS screen in one tap.',
  },
];

function PermissionCard({ item, status, index, onRequest, onOpenSettings }) {
  const { colors } = useTheme();
  const { icon, title, purpose } = item;
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
    <Animated.View entering={FadeInDown.duration(380).delay(80 + index * 70)}>
      <Card>
        <View style={styles.row}>
          <IconTile icon={icon} tone={granted ? 'ink' : denied || blocked ? 'danger' : 'muted'} size={42} />
          <View style={styles.copy}>
            <View style={styles.header}>
              <VText variant="headline" style={styles.title}>{title}</VText>
              {granted && <Badge text="Granted" tone="safe" icon={CheckCircle2} />}
              {(denied || blocked) && <Badge text="Blocked" tone="danger" icon={AlertCircle} />}
              {unavailable && <Badge text="Not available" tone="muted" icon={MinusCircle} />}
            </View>
            <VText variant="caption" secondary>{purpose}</VText>
            {blocked && <VText variant="caption" color={colors.danger}>Your phone won’t ask again. Tap Settings and allow it for VISHWAS.</VText>}
            {denied && <VText variant="caption" color={colors.danger}>Denied. Tap Retry to be asked again.</VText>}
          </View>
          {!granted && !unavailable && (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`${actionLabel} ${title} permission`}
              onPress={handlePress}
              disabled={requesting}
              scaleTo={0.92}
              style={[styles.action, { backgroundColor: blocked || denied ? colors.dangerTint : colors.ink }]}
            >
              {requesting ? (
                <ActivityIndicator size="small" color={colors.onInk} />
              ) : (
                <VText variant="caption" weight="bold" color={blocked || denied ? colors.danger : colors.onInk}>{actionLabel}</VText>
              )}
            </PressableScale>
          )}
        </View>
      </Card>
    </Animated.View>
  );
}

export function PermissionsList() {
  const { statuses, request, openAppSettings, lastError } = usePermissions();
  const { colors } = useTheme();
  return (
    <View style={styles.list}>
      {PERMISSION_ITEMS.map((item, i) => (
        <PermissionCard
          key={item.kind}
          index={i}
          item={item}
          status={statuses[item.kind]}
          onRequest={() => request(item.kind)}
          onOpenSettings={openAppSettings}
        />
      ))}
      {lastError ? <VText variant="caption" color={colors.danger}>{lastError}</VText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  copy: { flex: 1, gap: 4 },
  header: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  title: { flexShrink: 1 },
  action: { minWidth: 76, minHeight: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, alignSelf: 'center' },
});
