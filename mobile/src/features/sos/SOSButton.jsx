import { useEffect, useState } from 'react';
import { Animated, Pressable, View, Text, StyleSheet, Easing } from 'react-native';
import { AudioWaveform, TriangleAlert } from 'lucide-react-native';
import { haptics } from '../../services/hapticService';
import { useTheme, font } from '../../theme/theme';

// SOSButton — mirrors SOSButton.swift: purely presentational (pulsing rings
// + press). It does NOT trigger an emergency itself; the Home screen decides
// whether a confirmation step comes first.

const RINGS = [0, 1, 2];

export function SOSButton({ isActive = false, onPress }) {
  const { colors } = useTheme();
  const [pulse] = useState(() => RINGS.map(() => new Animated.Value(0)));

  useEffect(() => {
    const loops = pulse.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 300),
          Animated.timing(v, { toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [pulse]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isActive ? 'Emergency active' : 'Send SOS emergency alert'}
      onPress={() => { haptics.medium(); onPress(); }}
      style={styles.wrap}
    >
      {RINGS.map((i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={[
            styles.ring,
            {
              width: 170 + i * 40,
              height: 170 + i * 40,
              borderRadius: (170 + i * 40) / 2,
              borderColor: colors.emergency,
              opacity: pulse[i].interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
              transform: [{ scale: pulse[i].interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }],
            },
          ]}
        />
      ))}
      <View style={[styles.core, { backgroundColor: colors.emergency, shadowColor: colors.emergency }]}>
        {isActive ? <AudioWaveform size={32} color="#fff" strokeWidth={2.25} /> : <TriangleAlert size={32} color="#fff" strokeWidth={2.25} />}
        <Text style={[font.sosLabel, { color: '#fff' }]}>{isActive ? 'ACTIVE' : 'SOS'}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 250, height: 250, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderWidth: 1.5 },
  core: {
    width: 152,
    height: 152,
    borderRadius: 76,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
});
