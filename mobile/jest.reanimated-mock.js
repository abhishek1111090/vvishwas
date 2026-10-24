// Minimal Reanimated stand-in for Jest: animations finish instantly.
// (Reanimated 4.7's own mock needs the native/JS runtime, which Jest lacks.)
const React = require('react');

// react-native is required lazily: expo-router's test helpers load Reanimated while react-native is still loading.
const lazyAnimated = (resolve) =>
  React.forwardRef(({ entering, exiting, layout, ...props }, ref) => React.createElement(resolve(), { ...props, ref }));
const animated = (Component) => lazyAnimated(() => Component);
const rn = (name) => lazyAnimated(() => require('react-native')[name]);

// Layout-animation builders: every chained call (.duration(), .delay(), .springify()…) returns the builder.
const builder = new Proxy(function () {}, { get: (_, key) => (key === 'build' ? () => ({}) : () => builder) });

const ease = (t) => t;
const Easing = new Proxy({}, { get: () => (...args) => (typeof args[0] === 'function' ? args[0] : ease) });

const Animated = {
  View: rn('View'),
  Text: rn('Text'),
  Image: rn('Image'),
  ScrollView: rn('ScrollView'),
  FlatList: rn('FlatList'),
  createAnimatedComponent: animated,
};

module.exports = {
  __esModule: true,
  default: Animated,
  ...Animated,
  useSharedValue: (initial) =>
    React.useRef({ value: initial, get() { return this.value; }, set(v) { this.value = typeof v === 'function' ? v(this.value) : v; } }).current,
  useAnimatedStyle: (fn) => fn(),
  useAnimatedProps: (fn) => fn(),
  useDerivedValue: (fn) => ({ value: fn() }),
  useReducedMotion: () => false,
  withTiming: (to, _cfg, cb) => { cb?.(true); return to; },
  withSpring: (to, _cfg, cb) => { cb?.(true); return to; },
  withDelay: (_ms, value) => value,
  withRepeat: (value) => value,
  withSequence: (...values) => values[values.length - 1],
  cancelAnimation: () => {},
  interpolate: (_v, _input, output) => output[0],
  runOnJS: (fn) => fn,
  runOnUI: (fn) => fn,
  Easing,
  FadeIn: builder, FadeInDown: builder, FadeInUp: builder, FadeOut: builder, FadeOutUp: builder,
  ZoomIn: builder, SlideInUp: builder, LinearTransition: builder,
};
