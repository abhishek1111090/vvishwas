import { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, RadialGradient, LinearGradient, Stop, Rect, Circle } from 'react-native-svg';

// Glow.jsx — soft light and gradient fills drawn with SVG (no extra native
// module needed in Expo Go). Both are decorative: pointerEvents none.

/** A round radial glow, strongest in the middle, fading to nothing. */
export function RadialGlow({ size, color, opacity = 0.55, style }) {
  const id = `g${useId().replace(/:/g, '')}`;
  return (
    <Svg width={size} height={size} pointerEvents="none" style={style}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={opacity} />
          <Stop offset="0.45" stopColor={color} stopOpacity={opacity * 0.35} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
    </Svg>
  );
}

/** Fills its parent with a diagonal two-stop gradient (parent sets the radius + overflow). */
export function GradientFill({ from, to, angle = 'diagonal' }) {
  const id = `l${useId().replace(/:/g, '')}`;
  const end = angle === 'vertical' ? { x2: '0', y2: '1' } : { x2: '1', y2: '1' };
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" {...end}>
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

/** The SOS disc: a lit red centre deepening towards the rim. */
export function SphereFill({ size, light, mid, deep }) {
  const id = `s${useId().replace(/:/g, '')}`;
  return (
    <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient id={id} cx="42%" cy="36%" r="70%">
          <Stop offset="0" stopColor={light} />
          <Stop offset="0.55" stopColor={mid} />
          <Stop offset="1" stopColor={deep} />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
    </Svg>
  );
}
