import { useEffect, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInUp, FadeOutUp, Easing } from 'react-native-reanimated';
import { CircleCheck, CircleAlert, Info } from 'lucide-react-native';
import { fonts } from '../theme/theme';

// Toast — short confirmations ("Asha added") that slide in from the top on a
// soft spring and fade out after a few seconds. One at a time; a new toast
// replaces the old. Purely informative: nothing ever waits for a toast.
//   toast.show('Contact saved')            → success
//   toast.show('Couldn’t save', 'error')

const DURATION_MS = 2600;
let current = null;
let timer = null;
let seq = 0;
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

export const toast = {
  show(message, tone = 'success') {
    clearTimeout(timer);
    seq += 1;
    current = { id: seq, message, tone };
    emit();
    timer = setTimeout(() => { current = null; emit(); }, DURATION_MS);
  },
  hide() {
    clearTimeout(timer);
    current = null;
    emit();
  },
};

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const getSnapshot = () => current;

const TONE = {
  success: { icon: CircleCheck, color: '#2E9E3F' },
  error: { icon: CircleAlert, color: '#FF2E3A' },
  info: { icon: Info, color: '#0B0B0B' },
};

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const item = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => () => clearTimeout(timer), []);
  if (!item) return null;
  const { icon: Icon, color } = TONE[item.tone] ?? TONE.info;
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 8 }]}>
      <Animated.View
        key={item.id}
        entering={FadeInUp.springify().damping(16).stiffness(220)}
        exiting={FadeOutUp.duration(250).easing(Easing.in(Easing.cubic))}
        style={styles.toast}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
      >
        <Icon size={18} color={color} />
        <Text style={styles.text} numberOfLines={2}>{item.message}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 1000, elevation: 1000 },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 420,
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.96)', borderWidth: 1, borderColor: 'rgba(11,14,8,0.06)',
    shadowColor: '#2F4A1E', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  text: { fontFamily: fonts.semibold, fontSize: 14, color: '#0B0B0B', flexShrink: 1 },
});
