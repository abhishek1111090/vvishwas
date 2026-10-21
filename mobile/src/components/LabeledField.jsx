import { View, TextInput, StyleSheet } from 'react-native';
import { useTheme, radius, font } from '../theme/theme';
import { VText } from './ui';

/**
 * Labeled text input used by the auth and contact forms (mirrors
 * LabeledField in SignUpView.swift). `kind` picks the right keyboard,
 * autofill and capitalization: text | name | email | password | newPassword | phone.
 */
const KIND_PROPS = {
  text: { autoCapitalize: 'sentences' },
  name: { autoCapitalize: 'words', autoComplete: 'name', textContentType: 'name' },
  email: { autoCapitalize: 'none', autoCorrect: false, keyboardType: 'email-address', autoComplete: 'email', textContentType: 'emailAddress' },
  password: { autoCapitalize: 'none', autoCorrect: false, secureTextEntry: true, autoComplete: 'current-password', textContentType: 'password' },
  newPassword: { autoCapitalize: 'none', autoCorrect: false, secureTextEntry: true, autoComplete: 'new-password', textContentType: 'newPassword' },
  phone: { keyboardType: 'phone-pad', autoComplete: 'tel', textContentType: 'telephoneNumber' },
};

export function LabeledField({ label, value, onChangeText, kind = 'text', error = null, maxLength, testID, onSubmitEditing, returnKeyType }) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <VText variant="caption" secondary>{label}</VText>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        maxLength={maxLength}
        placeholderTextColor={colors.textSecondary}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={returnKeyType}
        style={[
          styles.input,
          font.body,
          {
            color: colors.textPrimary,
            backgroundColor: colors.backgroundSecondary,
            borderColor: error ? colors.emergency : 'transparent',
          },
        ]}
        {...KIND_PROPS[kind]}
      />
      {error ? <VText variant="caption" color={colors.emergency} accessibilityRole="alert">{error}</VText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  input: { minHeight: 50, borderRadius: radius.small, paddingHorizontal: 14, borderWidth: 1.5 },
});
