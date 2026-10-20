import { Component } from 'react';

// ErrorBoundary.jsx
// ------------------
// React error boundaries must be class components — hooks can't catch render
// errors. This wraps the entire app in App.jsx so that any future runtime
// error shows a helpful recovery screen instead of a blank white page.
//
// Without this: any unhandled render error unmounts the entire React tree
// (which is exactly what the getSnapshot bug caused — blank screen with no
// visible explanation). With this: the user sees an actionable message and
// the developer sees the error in the console.

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // In production, send to your error monitoring service here.
    console.error('[VISHWAS ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '24px',
          textAlign: 'center',
          fontFamily: '-apple-system, system-ui, sans-serif',
          background: 'var(--color-background, #fff)',
          color: 'var(--color-text-primary, #000)',
          gap: '16px',
        }}>
          <div style={{ fontSize: '48px' }}>⚠️</div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>
            Something went wrong
          </h1>
          <p style={{ margin: 0, color: 'rgba(60,60,67,0.6)', maxWidth: '320px' }}>
            VISHWAS hit an unexpected error. Tap below to reload and try again.
          </p>
          {this.state.error && (
            <pre style={{
              fontSize: '0.75rem',
              color: '#e0203a',
              background: 'rgba(224,32,58,0.08)',
              padding: '12px',
              borderRadius: '10px',
              maxWidth: '400px',
              overflow: 'auto',
              textAlign: 'left',
            }}>
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#5856d6',
              color: '#fff',
              border: 'none',
              borderRadius: '16px',
              padding: '14px 32px',
              fontSize: '1rem',
              fontWeight: 600,
              cursor: 'pointer',
              marginTop: '8px',
            }}
          >
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
