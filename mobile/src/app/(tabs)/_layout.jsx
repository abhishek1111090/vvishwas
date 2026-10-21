import { View, StyleSheet } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { Shield, Users, CircleUserRound } from 'lucide-react-native';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useContacts } from '../../context/ContactsContext';
import { useEmergency } from '../../context/EmergencyContext';
import { useTripleTap } from '../../utils/useTripleTap';
import { haptics } from '../../services/hapticService';
import { EmergencyOverlay } from '../../features/sos/EmergencyOverlay';
import { useTheme } from '../../theme/theme';

// Signed-in shell (mirrors AppShell + BottomNav in the web app):
//  • guards: onboarding + sign-in required
//  • bottom tabs: Home, Contacts, Account (History is a hidden tab)
//  • THE global triple-tap SOS handler
//  • the full-screen emergency overlay — an absolutely positioned layer
//    above the tabs (not a Modal, so it can't clash with a closing sheet on
//    iOS); it blocks the Android back button itself

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
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textSecondary,
          tabBarStyle: { backgroundColor: colors.navBg, borderTopColor: colors.separator },
          sceneStyle: { backgroundColor: colors.background },
        }}
        screenListeners={{ tabPress: () => haptics.selection() }}
      >
        <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: ({ color }) => <Shield size={22} color={color} /> }} />
        <Tabs.Screen
          name="contacts"
          options={{
            title: 'Contacts',
            tabBarBadge: contacts.length > 0 ? contacts.length : undefined,
            tabBarIcon: ({ color }) => <Users size={22} color={color} />,
          }}
        />
        <Tabs.Screen name="profile" options={{ title: 'Account', tabBarIcon: ({ color }) => <CircleUserRound size={22} color={color} /> }} />
        <Tabs.Screen name="history" options={{ href: null, title: 'History' }} />
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
