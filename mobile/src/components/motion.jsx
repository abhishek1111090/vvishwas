import { useEffect, useState } from 'react';
import { Pressable, View, StyleSheet, AccessibilityInfo } from 'react-native';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  withDelay,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { RadialGlow } from './Glow';

// motion.jsx — the animation vocabulary of the app. Small, purposeful
// motion only: things enter softly, pressed things give, live things
// breathe. Reanimated honours the OS "Reduce motion" setting by default;
// purely decorative loops (ambient background, SOS halo) also switch off.
//
// Timings (ms): tap 150 · icon 250 · card 300 · screen 300 · page 450 ·
// ambient drift 8000. Curves: ease-in-out / ease-out + soft springs.

export const MOTION = {
  tap: 150,
  icon: 250,
  card: 300,
  screen: 300,
  page: 450,
  ambient: 8000,
  ease: Easing.inOut(Easing.cubic),
  easeOut: Easing.out(Easing.cubic),
  spring: { damping: 14, stiffness: 260, mass: 0.7 },
};

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** True while the OS "Reduce motion" accessibility setting is on (live-updating). */
export function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { if (alive) setReduce(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => setReduce(!!v));
    return () => { alive = false; sub?.remove?.(); };
  }, []);
  return reduce;
}

/** Card/panel that fades in with a slight upward slide (300 ms); `index` staggers siblings. */
export function Enter({ index = 0, children, style }) {
  return (
    <Animated.View entering={FadeInDown.duration(MOTION.card).delay(40 + Math.min(index, 8) * 50).easing(MOTION.easeOut)} style={style}>
      {children}
    </Animated.View>
  );
}

/** Whole-page content on first load: fade in + slight rise (450 ms). */
export function PageEnter({ children, style }) {
  return (
    <Animated.View entering={FadeInDown.duration(MOTION.page).easing(MOTION.easeOut).withInitialValues({ opacity: 0, transform: [{ translateY: 14 }] })} style={[{ flex: 1 }, style]}>
      {children}
    </Animated.View>
  );
}

/** Pressable that springs down slightly while pressed. */
export function PressableScale({ children, style, scaleTo = 0.97, disabled, onPressIn, onPressOut, ...rest }) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressableBase
      disabled={disabled}
      onPressIn={(e) => {
        // Quick 150 ms press-down; the action itself never waits for it.
        scale.set(withTiming(scaleTo, { duration: MOTION.tap, easing: Easing.out(Easing.quad) }));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.set(withSpring(1, MOTION.spring));
        onPressOut?.(e);
      }}
      style={[style, animated]}
      {...rest}
    >
      {children}
    </AnimatedPressableBase>
  );
}

/** A status dot with a soft expanding halo (live / active states). */
export function PulseDot({ color, size = 8, active = true }) {
  const halo = useSharedValue(0);
  useEffect(() => {
    if (!active) {
      cancelAnimation(halo);
      halo.value = 0;
      return undefined;
    }
    halo.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(halo);
  }, [active, halo]);
  const haloStyle = useAnimatedStyle(() => ({
    opacity: (1 - halo.value) * 0.55,
    transform: [{ scale: 1 + halo.value * 1.6 }],
  }));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: size, backgroundColor: color }, haloStyle]} />
      <View style={{ width: size, height: size, borderRadius: size, backgroundColor: color }} />
    </View>
  );
}

/** Blinking recording indicator. */
export function RecDot({ color, size = 8, active = true }) {
  const o = useSharedValue(1);
  useEffect(() => {
    if (!active) {
      cancelAnimation(o);
      o.value = 1;
      return undefined;
    }
    o.value = withRepeat(withSequence(withTiming(0.2, { duration: 600 }), withTiming(1, { duration: 600 })), -1, false);
    return () => cancelAnimation(o);
  }, [active, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: size, height: size, borderRadius: size, backgroundColor: color }, style]} />;
}

/** Circular progress ring; `progress` is a 0..1 number (animated on change). */
export function ProgressRing({ size = 56, stroke = 5, progress = 0, color, trackColor, children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(Math.max(0, Math.min(1, progress)), { duration: 900, easing: Easing.out(Easing.cubic) });
  }, [progress, p]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: c * (1 - p.value) }));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${c} ${c}`}
          animatedProps={props}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

/** Concentric "radar" pings around a point — used for live location. */
export function RadarPing({ color, size = 120, active = true }) {
  const rings = [useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  useEffect(() => {
    rings.forEach((v, i) => {
      if (!active) {
        cancelAnimation(v);
        v.value = 0;
        return;
      }
      v.value = withDelay(i * 650, withRepeat(withTiming(1, { duration: 1950, easing: Easing.out(Easing.quad) }), -1, false));
    });
    return () => rings.forEach((v) => cancelAnimation(v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {rings.map((v, i) => (
        <RadarRing key={i} value={v} color={color} size={size} />
      ))}
      <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: color, borderWidth: 3, borderColor: '#fff' }} />
    </View>
  );
}

function RadarRing({ value, color, size }) {
  const style = useAnimatedStyle(() => ({
    opacity: (1 - value.value) * 0.5,
    transform: [{ scale: 0.15 + value.value * 0.85 }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: color }, style]}
    />
  );
}

/**
 * Slow-moving lime light behind a screen, like the reference video: two
 * large soft green blobs and a white highlight drift on 8–10 s ease-in-out
 * loops. Decorative: static when the OS "Reduce motion" setting is on.
 */
export function AmbientBackground({ color = '#9BE36A', accent = '#C9F2A4', highlight = '#FFFFFF' }) {
  const reduce = useReduceMotion();
  const t = useSharedValue(0);
  const u = useSharedValue(0);
  useEffect(() => {
    if (reduce) return undefined;
    t.value = withRepeat(withTiming(1, { duration: MOTION.ambient, easing: Easing.inOut(Easing.sin) }), -1, true);
    u.value = withRepeat(withTiming(1, { duration: MOTION.ambient * 1.25, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => { cancelAnimation(t); cancelAnimation(u); };
  }, [reduce, t, u]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: -70 + t.value * 90 }, { translateY: -30 + t.value * 70 }, { scale: 1 + t.value * 0.12 }] }));
  const b = useAnimatedStyle(() => ({ transform: [{ translateX: 50 - u.value * 80 }, { translateY: 20 - u.value * 90 }, { scale: 1.08 - u.value * 0.1 }] }));
  const c = useAnimatedStyle(() => ({ opacity: 0.55 + u.value * 0.35, transform: [{ translateX: -20 + t.value * 40 }] }));
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[{ position: 'absolute', top: -140, left: -160 }, a]}>
        <RadialGlow size={520} color={color} opacity={0.75} />
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', top: '38%', right: -200 }, b]}>
        <RadialGlow size={560} color={accent} opacity={0.9} />
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', bottom: -160, left: -60 }, c]}>
        <RadialGlow size={480} color={highlight} opacity={0.85} />
      </Animated.View>
    </View>
  );
}

/**
 * Gently floating element (the reference video's hovering product):
 * ±`distance` px bob with a whisper of tilt on a 4 s ease-in-out loop.
 * Still when "Reduce motion" is on.
 */
export function Float({ children, distance = 5, duration = 4000, style }) {
  const reduce = useReduceMotion();
  const v = useSharedValue(0);
  useEffect(() => {
    if (reduce) return undefined;
    v.value = withRepeat(withTiming(1, { duration: duration / 2, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(v);
  }, [reduce, v, duration]);
  const anim = useAnimatedStyle(() => ({ transform: [{ translateY: -distance + v.value * distance * 2 }, { rotate: `${-0.8 + v.value * 1.6}deg` }] }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}
