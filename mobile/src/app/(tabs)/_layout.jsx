import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withSequence, Easing } from 'react-native-reanimated';
import { House, Users } from 'lucide-react-native';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useContacts } from '../../context/ContactsContext';
import { useEmergency } from '../../context/EmergencyContext';
import { useTripleTap } from '../../utils/useTripleTap';
import { haptics } from '../../services/hapticService';
import { EmergencyOverlay } from '../../features/sos/EmergencyOverlay';
import { useTheme, fonts } from '../../theme/theme';
import { FloatingTabBar } from '../../components/FloatingTabBar';
import { usePermissions } from '../../context/PermissionsContext';
import { PermissionStatus } from '../../services/permissionsService';

// Signed-in shell (mirrors AppShell + BottomNav in the web app):
//  • guards: onboarding + sign-in required
//  • bottom tabs: Home, Contacts, Account (History is a stacked screen),
//    drawn as a floating glass pill (FloatingTabBar)
//  • THE global triple-tap SOS handler
//  • the full-screen emergency overlay — an absolutely positioned layer
//    above the tabs (not a Modal, so it can't clash with a closing sheet on
//    iOS); it blocks the Android back button itself

/** Icon that pops (overshoot + settle, with a tiny tilt) when its tab becomes active. */
function TabIcon({ icon: Icon, color, focused }) {
  const scale = useSharedValue(1);
  const tilt = useSharedValue(0);
  useEffect(() => {
    if (!focused) return;
    scale.value = withSequence(withSpring(1.22, { damping: 8, stiffness: 340 }), withSpring(1, { damping: 12 }));
    tilt.value = withSequence(withSpring(-8, { damping: 10, stiffness: 400 }), withSpring(0, { damping: 9 }));
  }, [focused, scale, tilt]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }, { rotate: `${tilt.value}deg` }] }));
  return (
    <Animated.View style={style}>
      <Icon size={26} color={color} strokeWidth={focused ? 2.5 : 2} />
    </Animated.View>
  );
}

/** Account tab: the person's initials in a circle, ringed when selected (like a profile photo). */
function AvatarIcon({ name, focused }) {
  const { colors } = useTheme();
  const scale = useSharedValue(1);
  useEffect(() => {
    if (focused) scale.value = withSequence(withSpring(1.18, { damping: 8, stiffness: 340 }), withSpring(1, { damping: 12 }));
  }, [focused, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const initials = (name ?? 'V').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  return (
    <Animated.View style={[styles.avatarRing, { borderColor: focused ? colors.onInk : 'transparent' }, style]}>
      <View style={[styles.avatar, { backgroundColor: colors.danger }]}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
    </Animated.View>
  );
}

export default function TabsLayout() {
  const { colors } = useTheme();
  const { hasCompletedOnboarding } = useAppState();
  const { isAuthenticated } = useAuth();
  const { contacts } = useContacts();
  const { currentUser } = useAuth();
  const { statuses } = usePermissions();
  const emergency = useEmergency();
  const needsPermissions = statuses.location !== PermissionStatus.granted || statuses.microphone !== PermissionStatus.granted;

  const tripleTap = useTripleTap(() => {
    if (emergency.isActive) return;
    emergency.trigger('tripleTap');
  });

  if (!hasCompletedOnboarding) return <Redirect href="/onboarding" />;
  if (!isAuthenticated) return <Redirect href="/auth" />;

  return (
    <View style={styles.fill} onTouchStart={tripleTap.onTouchStart} onTouchEnd={tripleTap.onTouchEnd} testID="app-shell">
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11 },
          sceneStyle: { backgroundColor: colors.background },
          // Fluid tab switch: the new screen shifts in and fades (300 ms, ease-in-out).
          animation: 'shift',
          transitionSpec: { animation: 'timing', config: { duration: 300, easing: Easing.inOut(Easing.cubic) } },
        }}
        screenListeners={{ tabPress: () => haptics.selection() }}
      >
        <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: (p) => <TabIcon icon={House} {...p} /> }} />
        <Tabs.Screen
          name="contacts"
          options={{
            title: 'Contacts',
            // Red dot = needs attention: nobody to alert yet.
            tabBarBadge: contacts.length === 0 ? '!' : undefined,
            tabBarAccessibilityLabel: contacts.length === 0 ? 'Contacts, none added yet' : `Contacts, ${contacts.length}`,
            tabBarIcon: (p) => <TabIcon icon={Users} {...p} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Account',
            // Red dot = a permission SOS needs (location / microphone) is off.
            tabBarBadge: needsPermissions ? '!' : undefined,
            tabBarIcon: (p) => <AvatarIcon name={currentUser?.fullName} focused={p.focused} />,
          }}
        />
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
  avatarRing: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 27, height: 27, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontFamily: fonts.bold, fontSize: 11 },
});
