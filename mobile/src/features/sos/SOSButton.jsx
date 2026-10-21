import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withRepeat,
  withTiming,
  withSpring,
  withDelay,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { Siren } from 'lucide-react-native';
import { haptics } from '../../services/hapticService';
import { useTheme, font, fonts } from '../../theme/theme';

// SOSButton — press & hold to send SOS (the hold IS the confirmation).
//   • at rest: soft breathing rings
//   • pressed: the button sinks and a red progress ring fills over HOLD_MS
//   • released early: the ring rewinds and a hint explains what to do
//   • screen readers: the "activate" action calls onAccessibleActivate,
//     which opens the confirmation sheet (holding is hard with VoiceOver)
// It never starts an emergency itself — onTrigger does, via the
// canonical emergencyManager.trigger('button').

export const HOLD_MS = 1500;
const SIZE = 196;
const RING = SIZE + 28;
const STROKE = 6;
const R = (RING - STROKE) / 2;
const C = 2 * Math.PI * R;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function BreathRing({ delay, color }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1, false));
    return () => cancelAnimation(v);
  }, [delay, v]);
  const style = useAnimatedStyle(() => ({
    opacity: (1 - v.value) * 0.28,
    transform: [{ scale: 1 + v.value * 0.32 }],
  }));
  return <Animated.View pointerEvents="none" style={[styles.breath, { backgroundColor: color }, style]} />;
}

export function SOSButton({ isActive = false, onTrigger, onAccessibleActivate }) {
  const { colors } = useTheme();
  const progress = useSharedValue(0);
  const press = useSharedValue(1);
  const timer = useRef(null);
  const [hint, setHint] = useState(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  function begin() {
    if (isActive) return;
    setHint('Keep holding…');
    haptics.light();
    press.set(withSpring(0.93, { damping: 15, stiffness: 260 }));
    progress.set(withTiming(1, { duration: HOLD_MS, easing: Easing.linear }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHint(null);
      press.set(withSpring(1));
      progress.set(withTiming(0, { duration: 400 }));
      onTrigger();
    }, HOLD_MS);
  }

  function end() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      setHint('Hold for 1.5 seconds to send SOS');
    }
    press.set(withSpring(1, { damping: 12, stiffness: 220 }));
    progress.set(withTiming(0, { duration: 260 }));
  }

  const coreStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: C * (1 - progress.value) }));

  return (
    <View style={styles.wrap}>
      <View style={styles.stage}>
        {!isActive && [0, 800, 1600].map((d) => <BreathRing key={d} delay={d} color={colors.danger} />)}

        <Svg width={RING} height={RING} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Circle cx={RING / 2} cy={RING / 2} r={R} stroke={colors.dangerTint} strokeWidth={STROKE} fill="none" />
          <AnimatedCircle
            cx={RING / 2}
            cy={RING / 2}
            r={R}
            stroke={colors.danger}
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${C} ${C}`}
            animatedProps={ringProps}
            transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
          />
        </Svg>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isActive ? 'Emergency active' : 'Send SOS emergency alert'}
          accessibilityHint="Press and hold for 1.5 seconds to send an SOS"
          accessibilityActions={[{ name: 'activate' }]}
          onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'activate') onAccessibleActivate?.(); }}
          onPressIn={begin}
          onPressOut={end}
          testID="sos-button"
        >
          <Animated.View style={[styles.core, { backgroundColor: colors.danger, shadowColor: colors.danger }, coreStyle]}>
            <View style={[styles.innerRing, { borderColor: 'rgba(255,255,255,0.22)' }]} />
            <Siren size={30} color="#fff" strokeWidth={2.2} />
            <Text style={[font.sosLabel, styles.label]}>{isActive ? 'ACTIVE' : 'SOS'}</Text>
            <Text style={styles.sub}>{isActive ? 'EMERGENCY ON' : 'PRESS & HOLD'}</Text>
          </Animated.View>
        </Pressable>
      </View>
      <Text style={[font.caption, styles.hint, { color: hint ? colors.danger : colors.textSecondary }]}>
        {hint ?? 'Hold to send SOS · Triple-tap anywhere for instant SOS'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 14 },
  stage: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  breath: { position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2 },
  core: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  innerRing: { position: 'absolute', width: SIZE - 18, height: SIZE - 18, borderRadius: (SIZE - 18) / 2, borderWidth: 1.5 },
  label: { color: '#fff', marginTop: 2 },
  sub: { color: 'rgba(255,255,255,0.85)', fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 1.6 },
  hint: { textAlign: 'center' },
});
