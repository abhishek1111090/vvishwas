import { useState, useEffect } from 'react';
import { Wifi, Battery } from 'lucide-react';
import { useEmergency } from '../context/EmergencyContext';
import { useBattery } from '../utils/useBattery';
import { useTripleTap } from '../utils/useTripleTap';
import { BottomNav } from './BottomNav';
import { EmergencyActiveOverlay } from '../pages/sos/EmergencyActiveOverlay';
import './AppShell.css';

export function AppShell({ children, showBottomNav = true }) {
  const emergency = useEmergency();
  const battery = useBattery();
  const [currentTime, setCurrentTime] = useState('');

  // Global Triple-Tap SOS: Active across all shell screens
  const globalTripleTapHandler = useTripleTap(() => {
    emergency.trigger('tripleTap');
  });

  // Simulated live clock for the status bar
  useEffect(() => {
    function updateClock() {
      const now = new Date();
      const hours = now.getHours();
      const minutes = String(now.getMinutes()).padStart(2, '0');
      setCurrentTime(`${hours}:${minutes}`);
    }
    updateClock();
    const interval = setInterval(updateClock, 15000);
    return () => clearInterval(interval);
  }, []);

  const safeBatteryPercent = battery.level !== null
    ? `${Math.round(battery.level * 100)}%`
    : '100%';

  return (
    <div className="v-shell" onClick={globalTripleTapHandler}>
      {/* Mobile Top Status Bar Header (Visible in mobile app frame) */}
      <header className="v-shell__status-bar" aria-hidden="true">
        <span className="v-shell__clock">{currentTime || '9:41'}</span>
        <div className="v-shell__notch-pill" />
        <div className="v-shell__status-icons">
          <span className="v-shell__signal">●●●●</span>
          <Wifi size={13} strokeWidth={2.4} />
          <div className="v-shell__battery-wrap">
            <span className="v-shell__battery-text">{safeBatteryPercent}</span>
            <Battery size={15} strokeWidth={2.2} />
          </div>
        </div>
      </header>

      {/* Main App Content Viewport */}
      <main className="v-shell__viewport">
        {children}
      </main>

      {/* Persistent Mobile Bottom Navigation Bar */}
      {showBottomNav && !emergency.isActive && <BottomNav />}

      {/* Global Emergency Active Overlay (Always top-level when SOS is engaged) */}
      {emergency.isActive && <EmergencyActiveOverlay />}
    </div>
  );
}
