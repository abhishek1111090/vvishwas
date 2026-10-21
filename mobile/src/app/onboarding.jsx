import { useEffect, useRef, useState } from 'react';
import { View, ScrollView, Pressable, useWindowDimensions, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence, Easing, cancelAnimation } from 'react-native-reanimated';
import { ShieldCheck, Siren, LocateFixed, ArrowRight, ChevronLeft, RefreshCw } from 'lucide-react-native';
import { useAppState } from '../context/AppStateContext';
import { usePermissions } from '../context/PermissionsContext';
import { PermissionsList, PERMISSION_ITEMS } from '../features/permissions/PermissionsList';
import { PermissionStatus } from '../services/permissionsService';
import { haptics } from '../services/hapticService';
import { PrimaryButton, VText } from '../components/ui';
import { useTheme, radius, spacing } from '../theme/theme';

// Onboarding — 3 swipeable intro slides + the permissions setup page
// (mirrors OnboardingView.swift's paging TabView). Copy is unchanged.

const SLIDES = [
  {
    id: 'purpose',
    icon: ShieldCheck,
    tone: 'ink',
    title: 'Your Safety,\nOne Tap Away',
    subtitle: 'VISHWAS instantly alerts the people you trust the moment you need help — no fumbling through apps in a crisis.',
  },
  {
    id: 'features',
    icon: Siren,
    tone: 'danger',
    title: 'Built For\nReal Emergencies',
    subtitle: 'One trigger starts audio, video, and GPS evidence collection automatically, and alerts your contacts with your live location.',
  },
  {
    id: 'location',
    icon: LocateFixed,
    tone: 'ink',
    title: 'Live Location,\nShared Securely',
    subtitle: 'Your trusted contacts get your exact location in the emergency alert — only when you trigger SOS.',
  },
];

const TOTAL = SLIDES.length + 1;

function FloatingIcon({ icon: Icon, tone }) {
  const { colors } = useTheme();
  const float = useSharedValue(0);
  const ring = useSharedValue(0);
  useEffect(() => {
    float.value = withRepeat(withSequence(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 1800, easing: Easing.inOut(Easing.sin) })), -1, false);
    ring.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.out(Easing.quad) }), -1, false);
    return () => { cancelAnimation(float); cancelAnimation(ring); };
  }, [float, ring]);
  const floatStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -8 * float.value }] }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: (1 - ring.value) * 0.5, transform: [{ scale: 1 + ring.value * 0.35 }] }));
  const bg = tone === 'danger' ? colors.danger : colors.ink;
  return (
    <View style={styles.iconStage}>
      <Animated.View style={[styles.ring, { borderColor: bg }, ringStyle]} />
      <View style={[styles.halo, { backgroundColor: colors.surfaceMuted }]} />
      <Animated.View style={[styles.iconTile, { backgroundColor: bg }, floatStyle]}>
        <Icon size={54} color={tone === 'danger' ? '#fff' : colors.onInk} strokeWidth={1.9} />
      </Animated.View>
    </View>
  );
}

export default function Onboarding() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { completeOnboarding } = useAppState();
  const { statuses, refreshAllStatuses } = usePermissions();
  const scrollRef = useRef(null);
  const [page, setPage] = useState(0);

  const isPermissions = page === SLIDES.length;
  const allGranted = PERMISSION_ITEMS.every((i) => [PermissionStatus.granted, PermissionStatus.unavailable].includes(statuses[i.kind]));

  function goTo(index) {
    const target = Math.max(0, Math.min(index, TOTAL - 1));
    haptics.selection();
    setPage(target);
    scrollRef.current?.scrollTo({ x: target * width, animated: true });
  }

  function finish() {
    haptics.success();
    completeOnboarding();
    router.replace('/auth');
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.topbar}>
        <View style={styles.brand}>
          <View style={[styles.logo, { backgroundColor: colors.ink }]}>
            <ShieldCheck size={16} color={colors.onInk} strokeWidth={2.4} />
          </View>
          <VText variant="headline" weight="heavy" style={{ letterSpacing: 0.4 }}>VISHWAS</VText>
        </View>
        <View style={[styles.stepPill, { backgroundColor: colors.surfaceMuted }]}>
          <VText variant="caption" weight="semibold" secondary>{page + 1} of {TOTAL}</VText>
        </View>
        {isPermissions ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back to intro" hitSlop={10} onPress={() => goTo(SLIDES.length - 1)} style={styles.topAction}>
            <ChevronLeft size={16} color={colors.textPrimary} />
            <VText variant="subheadline" weight="semibold">Back</VText>
          </Pressable>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel="Skip to permissions setup" hitSlop={10} onPress={() => goTo(SLIDES.length)} style={styles.topAction}>
            <VText variant="subheadline" weight="semibold" secondary>Skip</VText>
          </Pressable>
        )}
      </View>

      <View style={styles.progress}>
        {Array.from({ length: TOTAL }).map((_, i) => (
          <Pressable
            key={i}
            accessibilityRole="tab"
            accessibilityLabel={`Go to slide ${i + 1}`}
            accessibilityState={{ selected: i === page }}
            onPress={() => goTo(i)}
            hitSlop={8}
            style={[styles.bar, { backgroundColor: i <= page ? colors.ink : colors.border }]}
          />
        ))}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={!isPermissions}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
        style={styles.pager}
      >
        {SLIDES.map((slide) => (
          <View key={slide.id} style={[styles.slide, { width }]}>
            <FloatingIcon icon={slide.icon} tone={slide.tone} />
            <VText variant="display" style={styles.slideTitle}>{slide.title}</VText>
            <VText variant="body" secondary style={styles.slideBody}>{slide.subtitle}</VText>
          </View>
        ))}

        <ScrollView style={{ width }} contentContainerStyle={styles.permissions} showsVerticalScrollIndicator={false}>
          <View style={styles.permHeader}>
            <VText variant="title">Set Up Protection</VText>
            <Pressable accessibilityRole="button" accessibilityLabel="Refresh permission statuses" onPress={refreshAllStatuses} hitSlop={10} style={[styles.refresh, { backgroundColor: colors.surfaceMuted }]}>
              <RefreshCw size={15} color={colors.textPrimary} />
            </Pressable>
          </View>
          <VText variant="subheadline" secondary>
            VISHWAS needs these to capture evidence and alert your emergency contacts in a crisis. You choose each one.
          </VText>
          <PermissionsList />
          <VText variant="caption" secondary style={{ textAlign: 'center' }}>
            {allGranted ? 'All available protections are enabled.' : 'You can continue now and grant the rest anytime in Account → Permissions.'}
          </VText>
          <PrimaryButton onPress={finish} icon={ArrowRight}>{allGranted ? 'Finish Setup & Continue' : 'Continue to VISHWAS'}</PrimaryButton>
        </ScrollView>
      </ScrollView>

      {!isPermissions && (
        <View style={styles.footer}>
          {page > 0 ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Previous slide" onPress={() => goTo(page - 1)} style={styles.prev} hitSlop={8}>
              <VText variant="headline" secondary>Back</VText>
            </Pressable>
          ) : (
            <View style={styles.prev} />
          )}
          <PrimaryButton
            onPress={() => goTo(page + 1)}
            icon={ArrowRight}
            style={styles.next}
            accessibilityLabel={page === SLIDES.length - 1 ? 'Get Started' : 'Next'}
          >
            {page === SLIDES.length - 1 ? 'Get Started' : 'Next'}
          </PrimaryButton>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, minHeight: 48 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  stepPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  topAction: { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 56, justifyContent: 'flex-end', minHeight: 44 },
  progress: { flexDirection: 'row', gap: 6, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  bar: { flex: 1, height: 4, borderRadius: 2 },
  pager: { flex: 1 },
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, gap: spacing.lg },
  iconStage: { width: 240, height: 240, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  ring: { position: 'absolute', width: 200, height: 200, borderRadius: 100, borderWidth: 1.5 },
  halo: { position: 'absolute', width: 200, height: 200, borderRadius: 100 },
  iconTile: { width: 116, height: 116, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  slideTitle: { textAlign: 'center' },
  slideBody: { textAlign: 'center', maxWidth: 340 },
  permissions: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  permHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  refresh: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  prev: { minWidth: 64, minHeight: 54, justifyContent: 'center' },
  next: { flex: 1 },
});
