import { useEffect } from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
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

// motion.jsx — the animation vocabulary of the app. Small, purposeful
// motion only: things enter softly, pressed things give, live things
// breathe. Reanimated honours the OS "Reduce motion" setting by default.

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Content that fades up into place; `index` staggers siblings. */
export function Enter({ index = 0, children, style }) {
  return (
    <Animated.View entering={FadeInDown.duration(420).delay(60 + index * 70).easing(Easing.out(Easing.cubic))} style={style}>
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
        scale.set(withSpring(scaleTo, { damping: 18, stiffness: 320 }));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.set(withSpring(1, { damping: 14, stiffness: 260 }));
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
