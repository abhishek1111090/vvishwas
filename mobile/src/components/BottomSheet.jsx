import { Modal, View, Pressable, KeyboardAvoidingView, ScrollView, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useTheme, radius, spacing } from '../theme/theme';
import { VText } from './ui';

// BottomSheet — the one reusable equivalent of SwiftUI's
// `.sheet(isPresented:)` (sign in/up, forgot password, add contact, SOS
// confirm, coming soon). A transparent Modal that slides up:
//  • Android back button closes it (onRequestClose) when dismissible
//  • KeyboardAvoidingView keeps focused fields above the keyboard
//  • content scrolls on small screens

export function BottomSheet({ isOpen, onClose, onDismissed, dismissible = true, children, testID }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="slide"
      onRequestClose={() => { if (dismissible) onClose?.(); }}
      onDismiss={onDismissed}
      statusBarTranslucent
    >
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.fill}>
        <Pressable
          style={[styles.fill, { backgroundColor: colors.scrim }]}
          onPress={dismissible ? onClose : undefined}
          accessibilityLabel="Close"
          accessible={false}
        />
        <View
          testID={testID}
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, paddingBottom: spacing.lg + insets.bottom, maxHeight: '92%' },
          ]}
        >
          {dismissible && <View style={[styles.grabber, { backgroundColor: colors.border }]} />}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function SheetHeader({ title, onClose, closeLabel = 'Cancel' }) {
  const { colors } = useTheme();
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        hitSlop={12}
        style={[styles.close, { backgroundColor: colors.surfaceMuted }]}
      >
        <X size={16} color={colors.textPrimary} />
        <VText variant="caption" weight="semibold">{closeLabel}</VText>
      </Pressable>
      <VText variant="headline" style={styles.title} numberOfLines={1}>{title}</VText>
      <View style={styles.spacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
  },
  grabber: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginTop: 10, marginBottom: 10 },
  content: { gap: 14, paddingTop: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  close: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
  spacer: { width: 80 },
  title: { flex: 1, textAlign: 'center' },
});
