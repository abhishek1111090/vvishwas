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
import { RadialGlow, SphereFill } from '../../components/Glow';
import { useReduceMotion } from '../../components/motion';

// SOSButton — press & hold to send SOS (the hold IS the confirmation).
//   • at rest: a lit red sphere in a soft glow, breathing rings and a
//     slowly turning dashed orbit
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

const PULSE_MS = 1800;

function BreathRing({ delay, color }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(delay, withRepeat(withTiming(1, { duration: PULSE_MS, easing: Easing.out(Easing.quad) }), -1, false));
    return () => cancelAnimation(v);
  }, [delay, v]);
  const style = useAnimatedStyle(() => ({
    opacity: (1 - v.value) * 0.28,
    transform: [{ scale: 1 + v.value * 0.32 }],
  }));
  return <Animated.View pointerEvents="none" style={[styles.breath, { backgroundColor: color }, style]} />;
}

const GLOW = RING + 150;

/** Dashed orbit that turns once every 14 s. */
function Orbit({ color }) {
  const turn = useSharedValue(0);
  useEffect(() => {
    turn.value = withRepeat(withTiming(1, { duration: 14000, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(turn);
  }, [turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }));
  const r = SIZE / 2 + 30;
  return (
    <Animated.View pointerEvents="none" style={[styles.orbit, style]}>
      <Svg width={r * 2 + 4} height={r * 2 + 4}>
        <Circle cx={r + 2} cy={r + 2} r={r} stroke={color} strokeOpacity={0.35} strokeWidth={1.2} strokeDasharray="2 9" strokeLinecap="round" fill="none" />
        <Circle cx={r + 2} cy={2} r={2.6} fill={color} />
      </Svg>
    </Animated.View>
  );
}

/** Glow that brightens and dims slowly. */
function Halo({ color, boosted }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withRepeat(withTiming(1, { duration: PULSE_MS / 2, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(v);
  }, [v]);
  const style = useAnimatedStyle(() => ({ opacity: 0.65 + v.value * 0.35, transform: [{ scale: 0.94 + v.value * 0.08 }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.glow, style]}>
      <RadialGlow size={GLOW} color={color} opacity={boosted ? 0.75 : 0.5} />
    </Animated.View>
  );
}

/** Quick ripple shown the instant SOS fires. */
function Ripple({ color }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withTiming(1, { duration: 550, easing: Easing.out(Easing.cubic) });
  }, [v]);
  const style = useAnimatedStyle(() => ({ opacity: (1 - v.value) * 0.7, transform: [{ scale: 1 + v.value * 0.9 }] }));
  return <Animated.View pointerEvents="none" style={[styles.ripple, { borderColor: color }, style]} />;
}

export function SOSButton({ isActive = false, onTrigger, onAccessibleActivate }) {
  const { colors } = useTheme();
  const progress = useSharedValue(0);
  const press = useSharedValue(1);
  const timer = useRef(null);
  const [ripple, setRipple] = useState(0);
  const reduce = useReduceMotion();
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
      onTrigger(); // SOS starts now; the ripple below is only feedback
      setRipple((k) => k + 1);
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
        <Halo color={colors.danger} boosted={!!hint && hint.startsWith('Keep')} />
        {!isActive && !reduce && [0, PULSE_MS / 3, (PULSE_MS * 2) / 3].map((d) => <BreathRing key={d} delay={d} color={colors.danger} />)}
        {ripple > 0 && !reduce ? <Ripple key={ripple} color={colors.danger} /> : null}
        {!isActive && !reduce && <Orbit color={colors.danger} />}

        <Svg width={RING} height={RING} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Circle cx={RING / 2} cy={RING / 2} r={R} stroke="rgba(255,46,58,0.16)" strokeWidth={STROKE} fill="none" />
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
            <SphereFill size={SIZE} light="#FF6A72" mid="#F0222E" deep="#8E0A13" />
            <View style={[styles.innerRing, { borderColor: 'rgba(255,255,255,0.22)' }]} />
            <View style={[styles.rim, { borderColor: 'rgba(255,255,255,0.10)' }]} />
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
  glow: { position: 'absolute', width: GLOW, height: GLOW, left: (RING - GLOW) / 2, top: (RING - GLOW) / 2 },
  ripple: { position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 3 },
  orbit: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  rim: { position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 1 },
  breath: { position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2 },
  core: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    shadowOpacity: 0.7,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  innerRing: { position: 'absolute', width: SIZE - 18, height: SIZE - 18, borderRadius: (SIZE - 18) / 2, borderWidth: 1.5 },
  label: { color: '#fff', marginTop: 2 },
  sub: { color: 'rgba(255,255,255,0.85)', fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 1.6 },
  hint: { textAlign: 'center' },
});
