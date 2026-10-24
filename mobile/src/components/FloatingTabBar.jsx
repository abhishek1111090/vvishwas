import { useEffect, useState } from 'react';
import { View, Pressable, Platform, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { PulseDot } from './motion';
import { useTheme } from '../theme/theme';

// FloatingTabBar — a light frosted-glass pill that floats above the content;
// the selected tab sits on a black pill (the reference video's black buttons).
//  • a soft highlight pill slides to the selected tab on a spring and
//    briefly stretches while it travels ("liquid" feel)
//  • the pressed tab squishes, the newly selected icon pops
//  • a red dot (tabBarBadge) marks something that needs attention
//  • the bar rises into place when the app opens
// Screens add TAB_BAR_SPACE to their bottom padding so nothing hides behind it.

export const TAB_BAR_SPACE = 104;
const BAR_HEIGHT = 64;
const PILL_INSET = 6;
const SPRING = { damping: 18, stiffness: 210, mass: 0.9 };

function TabButton({ label, focused, onPress, onLongPress, onLayout, children, dot, testID }) {
  const { colors } = useTheme();
  const press = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => press.set(withSpring(0.86, { damping: 15, stiffness: 400 }))}
      onPressOut={() => press.set(withSpring(1, { damping: 12, stiffness: 260 }))}
      onLayout={onLayout}
      style={styles.tab}
      testID={testID}
    >
      <Animated.View style={[styles.iconWrap, pressStyle]}>
        {children}
        {dot ? (
          <View style={styles.dot}>
            <PulseDot color={colors.danger} size={9} active />
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

// Expo Router 58 hands custom tab bars `emitter` + `navigateToTab`; older versions passed `navigation`.
export function FloatingTabBar({ state, descriptors, emitter, navigateToTab, navigation, insets }) {
  const { colors } = useTheme();
  const emit = (event) => (emitter ?? navigation).emit(event);
  const goTo = (route) => (navigateToTab ? navigateToTab(route.key) : navigation.navigate(route.name, route.params));
  const [layouts, setLayouts] = useState({});
  const x = useSharedValue(0);
  const width = useSharedValue(0);
  const stretch = useSharedValue(1);
  const shown = useSharedValue(0);

  const routes = state.routes.filter((r) => descriptors[r.key]?.options?.href !== null);

  useEffect(() => {
    const target = layouts[state.routes[state.index]?.key];
    if (!target) return;
    const first = shown.value === 0;
    shown.value = 1;
    const tx = target.x + PILL_INSET;
    const tw = target.width - PILL_INSET * 2;
    if (first) {
      x.value = tx;
      width.value = tw;
      return;
    }
    x.value = withSpring(tx, SPRING);
    width.value = withSpring(tw, SPRING);
    stretch.value = withSequence(
      withTiming(1.18, { duration: 140, easing: Easing.out(Easing.quad) }),
      withSpring(1, { damping: 12, stiffness: 220 })
    );
  }, [state.index, state.routes, layouts, x, width, stretch, shown]);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: shown.value,
    width: width.value,
    transform: [{ translateX: x.value }, { scaleX: stretch.value }],
  }));

  return (
    <Animated.View
      entering={FadeInDown.springify().damping(16).delay(120)}
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: Math.max(insets.bottom, 12) + 6 }]}
    >
      <View style={styles.bar}>
        {Platform.OS === 'ios' ? (
          <BlurView intensity={55} tint="light" style={StyleSheet.absoluteFill} />
        ) : null}
        <View style={[StyleSheet.absoluteFill, styles.glass]} />
        <View style={[StyleSheet.absoluteFill, styles.sheen]} pointerEvents="none" />
        <Animated.View pointerEvents="none" style={[styles.pill, pillStyle]} />

        {routes.map((route) => {
          const { options } = descriptors[route.key];
          const focused = state.routes[state.index]?.key === route.key;
          const color = focused ? colors.onInk : 'rgba(11,11,11,0.62)';
          const label = options.tabBarAccessibilityLabel ?? options.title ?? route.name;
          return (
            <TabButton
              key={route.key}
              label={label}
              focused={focused}
              dot={!!options.tabBarBadge}
              testID={options.tabBarButtonTestID}
              onLayout={(e) => {
                const { x: lx, width: lw } = e.nativeEvent.layout;
                setLayouts((prev) => (prev[route.key]?.x === lx && prev[route.key]?.width === lw ? prev : { ...prev, [route.key]: { x: lx, width: lw } }));
              }}
              onPress={() => {
                const event = emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) goTo(route);
              }}
              onLongPress={() => emit({ type: 'tabLongPress', target: route.key })}
            >
              {options.tabBarIcon?.({ focused, color, size: 26 })}
            </TabButton>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 22, right: 22, alignItems: 'stretch' },
  bar: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.9)',
    shadowColor: '#2F4A1E',
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },
  glass: { backgroundColor: Platform.OS === 'ios' ? 'rgba(255,255,255,0.45)' : 'rgba(248,251,245,0.96)' },
  sheen: { borderRadius: BAR_HEIGHT / 2, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.95)' },
  pill: {
    position: 'absolute',
    left: 0,
    top: PILL_INSET,
    bottom: PILL_INSET,
    borderRadius: (BAR_HEIGHT - PILL_INSET * 2) / 2,
    backgroundColor: '#0B0B0B',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.9)',
  },
  tab: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center' },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', right: -4, bottom: -2, padding: 2, borderRadius: 8, borderWidth: 0 },
});
