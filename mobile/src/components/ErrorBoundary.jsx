import { Component } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

// ErrorBoundary — a render error shows a recovery screen instead of a
// blank app. Error boundaries must be class components.

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[VISHWAS ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.wrap}>
        <Text style={styles.icon}>⚠️</Text>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>VISHWAS hit an unexpected error. Tap below to try again.</Text>
        <Text style={styles.detail}>{String(this.state.error?.message ?? this.state.error)}</Text>
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => this.setState({ error: null })}>
          <Text style={styles.buttonText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12, backgroundColor: '#fff' },
  icon: { fontSize: 48 },
  title: { fontSize: 22, fontWeight: '700' },
  body: { fontSize: 15, color: 'rgba(60,60,67,0.6)', textAlign: 'center', maxWidth: 320 },
  detail: { fontSize: 12, color: '#e0203a', backgroundColor: 'rgba(224,32,58,0.08)', padding: 12, borderRadius: 10, maxWidth: 360 },
  button: { backgroundColor: '#5856d6', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 32, marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
