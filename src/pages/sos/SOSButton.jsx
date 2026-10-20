import { useEffect, useState } from 'react';
import { AudioWaveform, TriangleAlert } from 'lucide-react';
import { VFont } from '../../design-system/theme';
import { haptics } from '../../services/hapticService';
import './sos.css';

// SOSButton.jsx
// --------------
// CONVERSION NOTE: mirrors SOSButton.swift exactly, including the comment
// at the top of the original — this component is PURELY presentational and
// the press gesture. It does NOT call emergencyManager.trigger() itself;
// whoever embeds it (HomePage) decides whether a confirmation step happens
// first. That's what lets manual taps and triple-tap/voice/Siri share the
// same underlying trigger while behaving differently.

export function SOSButton({ isActive = false, onPress }) {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    // mirrors `.onAppear { pulse = true }` — start the ring animation once mounted
    const id = requestAnimationFrame(() => setPulse(true));
    return () => cancelAnimationFrame(id);
  }, []);

  function handleClick() {
    haptics.medium();
    onPress();
  }

  return (
    <button
      type="button"
      className="v-sos-button"
      onClick={handleClick}
      aria-label={isActive ? 'Emergency active, tap to view' : 'Send SOS emergency alert'}
    >
      <span className="v-sos-button__rings" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`v-sos-button__ring ${pulse ? 'v-sos-button__ring--pulsing' : ''}`}
            style={{
              width: 170 + i * 40,
              height: 170 + i * 40,
              animationDelay: `${i * 0.3}s`,
            }}
          />
        ))}
      </span>

      <span className="v-sos-button__core">
        {isActive ? (
          <AudioWaveform size={32} strokeWidth={2.25} color="#fff" aria-hidden="true" />
        ) : (
          <TriangleAlert size={32} strokeWidth={2.25} color="#fff" aria-hidden="true" />
        )}
        <span className={[VFont.sosLabel, 'v-sos-button__label'].join(' ')}>
          {isActive ? 'ACTIVE' : 'SOS'}
        </span>
      </span>
    </button>
  );
}
