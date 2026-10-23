import { useEffect, useState } from 'react';
import { View, Switch, Linking, StyleSheet } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { Mic, MicOff, CircleCheck } from 'lucide-react-native';
import { useEmergency } from '../../context/EmergencyContext';
import { VoiceStatus, validatePhrase } from '../../services/voiceActivationService';
import { LabeledField } from '../../components/LabeledField';
import { VText, IconTile, PrimaryButton, SecondaryButton } from '../../components/ui';
import { PulseDot } from '../../components/motion';
import { useTheme, radius } from '../../theme/theme';
import { toast } from '../../components/Toast';

// Voice SOS settings: the person's own wake phrase, on/off, permission,
// and a practice mode that shows when the phrase is recognised WITHOUT
// starting an SOS.

const STATUS_TEXT = {
  [VoiceStatus.unavailable]: 'Not available in this app build',
  [VoiceStatus.off]: 'Off',
  [VoiceStatus.needsPhrase]: 'Set a phrase to start',
  [VoiceStatus.needsPermission]: 'Microphone / speech permission needed',
  [VoiceStatus.starting]: 'Starting…',
  [VoiceStatus.listening]: 'Listening while VISHWAS is open',
  [VoiceStatus.paused]: 'Paused (SOS active or app in background)',
  [VoiceStatus.error]: 'Problem listening — retrying',
};

export function VoiceSetup() {
  const { colors } = useTheme();
  const { voice, voiceAvailable, saveVoice, requestVoicePermission, setVoiceTestMode } = useEmergency();
  const [phrase, setPhrase] = useState(voice.phrase ?? '');
  const [enabled, setEnabled] = useState(!!voice.enabled);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [practice, setPractice] = useState(false);

  // Leaving the sheet always ends practice mode, so a real phrase triggers SOS again.
  useEffect(() => () => setVoiceTestMode(false), [setVoiceTestMode]);

  const dirty = phrase.trim() !== (voice.phrase ?? '') || enabled !== !!voice.enabled;
  const tone = voice.status === VoiceStatus.listening ? colors.safe : voice.status === VoiceStatus.error || voice.status === VoiceStatus.needsPermission ? colors.warning : colors.textSecondary;

  function save() {
    const problem = saveVoice({ enabled, phrase });
    setError(problem);
    setSaved(!problem);
    if (!problem) toast.show(enabled ? `Voice SOS on — say “${phrase.trim()}”` : 'Voice SOS off', enabled ? 'success' : 'info');
    if (!problem) setTimeout(() => setSaved(false), 1800);
  }

  function togglePractice(on) {
    setPractice(on);
    setVoiceTestMode(on);
  }

  if (!voiceAvailable) {
    return (
      <View style={{ gap: 12, paddingBottom: 12 }}>
        <View style={styles.head}>
          <IconTile icon={MicOff} tone="warning" size={44} />
          <View style={{ flex: 1, gap: 4 }}>
            <VText variant="headline">Voice SOS needs the VISHWAS app build</VText>
            <VText variant="caption" secondary>
              Speech recognition isn’t included in Expo Go. Install the custom VISHWAS build (the same one used for front + back video) to set your phrase here.
            </VText>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ gap: 14, paddingBottom: 12 }}>
      <View style={styles.head}>
        <IconTile icon={Mic} tone="danger" size={44} />
        <View style={{ flex: 1, gap: 4 }}>
          <VText variant="headline">Say your phrase to send SOS</VText>
          <VText variant="caption" secondary>
            Like “Hey Siri”, but for SOS. When VISHWAS hears your exact phrase it starts the same emergency as the SOS button: alerts to all contacts, live location and recording.
          </VText>
        </View>
      </View>

      <LabeledField
        label="Your activation phrase"
        value={phrase}
        onChangeText={(t) => { setPhrase(t); setError(null); }}
        maxLength={60}
        error={error}
        testID="voice-phrase"
        returnKeyType="done"
        onSubmitEditing={save}
      />
      <VText variant="caption" tertiary>Use 2–6 words you wouldn’t say by accident, e.g. “Anshu activate” or “Vishwas help me now”.</VText>

      <View style={[styles.row, { borderColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <VText variant="headline">Voice SOS</VText>
          <VText variant="caption" secondary>{enabled ? 'On — listens while the app is open' : 'Off'}</VText>
        </View>
        <Switch accessibilityLabel="Voice SOS on or off" value={enabled} onValueChange={(v) => { setEnabled(v); setError(null); }} trackColor={{ true: colors.safe }} />
      </View>

      <PrimaryButton onPress={save} disabled={!dirty || (enabled && !!validatePhrase(phrase))}>
        {saved ? 'Saved ✓' : 'Save'}
      </PrimaryButton>

      <View style={[styles.status, { backgroundColor: colors.surfaceMuted }]}>
        <PulseDot color={tone} size={8} active={voice.status === VoiceStatus.listening} />
        <View style={{ flex: 1, gap: 2 }}>
          <VText variant="subheadline" weight="semibold" color={tone}>{STATUS_TEXT[voice.status] ?? voice.status}</VText>
          {voice.error ? <VText variant="caption" color={colors.warning}>{voice.error}</VText> : null}
          {voice.heard && voice.status === VoiceStatus.listening ? (
            <VText variant="caption" secondary numberOfLines={2}>Heard: “{voice.heard}”</VText>
          ) : null}
        </View>
      </View>

      {voice.status === VoiceStatus.needsPermission ? (
        <View style={{ gap: 8 }}>
          <SecondaryButton onPress={requestVoicePermission}>Allow microphone & speech</SecondaryButton>
          <SecondaryButton onPress={() => Linking.openSettings()}>Open Settings</SecondaryButton>
        </View>
      ) : null}

      {voice.enabled && voice.phrase ? (
        <View style={[styles.row, { borderColor: practice ? colors.safe : colors.border }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <VText variant="headline">Practice mode</VText>
            <VText variant="caption" secondary>Say your phrase to check it’s recognised. No SOS is sent while this is on.</VText>
            {practice && voice.testHeard ? (
              <Animated.View entering={ZoomIn.springify()} style={styles.heard}>
                <CircleCheck size={16} color={colors.safe} />
                <VText variant="subheadline" weight="bold" color={colors.safe}>Heard “{voice.phrase}” — this would start SOS</VText>
              </Animated.View>
            ) : practice ? (
              <Animated.View entering={FadeIn}>
                <VText variant="caption" color={colors.warning}>Listening… say “{voice.phrase}”</VText>
              </Animated.View>
            ) : null}
          </View>
          <Switch accessibilityLabel="Practice mode" value={practice} onValueChange={togglePractice} trackColor={{ true: colors.safe }} />
        </View>
      ) : null}

      <VText variant="caption" tertiary>
        Listening pauses when VISHWAS goes to the background or the screen locks; phones don’t let apps keep speech recognition running there. It resumes when you return. Triple-tap and the SOS button always work.
      </VText>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: radius.medium, padding: 14 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.medium, padding: 12 },
  heard: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
});
