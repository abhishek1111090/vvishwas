import { View, StyleSheet } from 'react-native';
import { TriangleAlert } from 'lucide-react-native';
import { BottomSheet } from '../../components/BottomSheet';
import { PrimaryButton, SecondaryButton, VText } from '../../components/ui';
import { useTheme, spacing } from '../../theme/theme';

// SOSConfirmSheet — mirrors SOSConfirmSheet.swift. The only path with a
// confirmation; triple-tap triggers immediately.

export function SOSConfirmSheet({ isOpen, onClose, contactCount, onConfirm }) {
  const { colors } = useTheme();
  const who = contactCount > 0
    ? `${contactCount} emergency contact${contactCount === 1 ? '' : 's'}`
    : 'your emergency contacts (none saved yet)';
  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} testID="sos-confirm">
      <View style={styles.wrap}>
        <TriangleAlert size={40} color={colors.emergency} />
        <VText variant="title">Trigger Emergency?</VText>
        <VText variant="subheadline" secondary style={{ textAlign: 'center' }}>
          This starts audio + video recording and live location, and prepares an alert to {who}. The emergency screen shows exactly which alerts were sent.
        </VText>
        <PrimaryButton destructive onPress={onConfirm}>Yes — Send Alert</PrimaryButton>
        <SecondaryButton onPress={onClose}>Cancel</SecondaryButton>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.md },
});
