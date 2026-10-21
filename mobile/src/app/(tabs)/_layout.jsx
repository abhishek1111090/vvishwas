import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withSequence } from 'react-native-reanimated';
import { Shield, Users, CircleUserRound } from 'lucide-react-native';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useContacts } from '../../context/ContactsContext';
import { useEmergency } from '../../context/EmergencyContext';
import { useTripleTap } from '../../utils/useTripleTap';
import { haptics } from '../../services/hapticService';
import { EmergencyOverlay } from '../../features/sos/EmergencyOverlay';
import { useTheme, fonts } from '../../theme/theme';

// Signed-in shell (mirrors AppShell + BottomNav in the web app):
//  • guards: onboarding + sign-in required
//  • bottom tabs: Home, Contacts, Account (History is a stacked screen)
//  • THE global triple-tap SOS handler
//  • the full-screen emergency overlay — an absolutely positioned layer
//    above the tabs (not a Modal, so it can't clash with a closing sheet on
//    iOS); it blocks the Android back button itself

function TabIcon({ icon: Icon, color, focused }) {
  const scale = useSharedValue(1);
  useEffect(() => {
    if (focused) scale.value = withSequence(withSpring(1.18, { damping: 9, stiffness: 320 }), withSpring(1, { damping: 12 }));
  }, [focused, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={style}>
      <Icon size={22} color={color} strokeWidth={focused ? 2.4 : 1.9} />
    </Animated.View>
  );
}

export default function TabsLayout() {
  const { colors } = useTheme();
  const { hasCompletedOnboarding } = useAppState();
  const { isAuthenticated } = useAuth();
  const { contacts } = useContacts();
  const emergency = useEmergency();

  const tripleTap = useTripleTap(() => {
    if (emergency.isActive) return;
    emergency.trigger('tripleTap');
  });

  if (!hasCompletedOnboarding) return <Redirect href="/onboarding" />;
  if (!isAuthenticated) return <Redirect href="/auth" />;

  return (
    <View style={styles.fill} onTouchStart={tripleTap.onTouchStart} onTouchEnd={tripleTap.onTouchEnd} testID="app-shell">
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.ink,
          tabBarInactiveTintColor: colors.textTertiary,
          tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11 },
          tabBarStyle: { backgroundColor: colors.navBg, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, elevation: 0 },
          tabBarBadgeStyle: { backgroundColor: colors.ink, color: colors.onInk, fontFamily: fonts.bold, fontSize: 10 },
          sceneStyle: { backgroundColor: colors.background },
        }}
        screenListeners={{ tabPress: () => haptics.selection() }}
      >
        <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: (p) => <TabIcon icon={Shield} {...p} /> }} />
        <Tabs.Screen
          name="contacts"
          options={{
            title: 'Contacts',
            tabBarBadge: contacts.length > 0 ? contacts.length : undefined,
            tabBarIcon: (p) => <TabIcon icon={Users} {...p} />,
          }}
        />
        <Tabs.Screen name="profile" options={{ title: 'Account', tabBarIcon: (p) => <TabIcon icon={CircleUserRound} {...p} /> }} />
      </Tabs>

      {emergency.isActive && (
        <View style={StyleSheet.absoluteFill}>
          <EmergencyOverlay />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
