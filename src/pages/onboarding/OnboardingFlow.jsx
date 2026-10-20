import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowRight, ChevronLeft } from 'lucide-react';
import { onboardingPages } from './onboardingData';
import { OnboardingPageView } from './OnboardingPageView';
import { PermissionsSetupView } from './PermissionsSetupView';
import { useAppState } from '../../context/AppStateContext';
import { haptics } from '../../services/hapticService';
import { VFont } from '../../design-system/theme';
import './onboarding.css';

export function OnboardingFlow() {
  const [pageIndex, setPageIndex] = useState(0);
  const { completeOnboarding } = useAppState();
  const navigate = useNavigate();

  // Gesture handling refs and state
  const touchStartXRef = useRef(0);
  const touchDeltaXRef = useRef(0);
  const [dragOffset, setDragOffset] = useState(0);
  const isDraggingRef = useRef(false);

  const totalPages = onboardingPages.length + 1; // 3 content slides + 1 permissions screen
  const isStaticSlide = pageIndex < onboardingPages.length;

  function goToPage(index) {
    if (index === pageIndex) return;
    haptics.selection();
    setPageIndex(Math.max(0, Math.min(index, totalPages - 1)));
  }

  function goNext() {
    haptics.selection();
    setPageIndex((prev) => Math.min(prev + 1, totalPages - 1));
  }

  function goPrev() {
    haptics.selection();
    setPageIndex((prev) => Math.max(prev - 1, 0));
  }

  function skipToPermissions() {
    haptics.selection();
    setPageIndex(onboardingPages.length); // Jump to permissions setup screen
  }

  function finishOnboarding() {
    haptics.success();
    completeOnboarding();
    navigate('/auth', { replace: true });
  }

  // --- Touch & Swipe Gesture Handlers ---
  function handleTouchStart(e) {
    // Only allow swipe on static slides (don't interfere with vertical scroll in permissions)
    if (!isStaticSlide) return;
    touchStartXRef.current = e.touches[0].clientX;
    touchDeltaXRef.current = 0;
    isDraggingRef.current = true;
  }

  function handleTouchMove(e) {
    if (!isDraggingRef.current) return;
    const currentX = e.touches[0].clientX;
    const deltaX = currentX - touchStartXRef.current;
    touchDeltaXRef.current = deltaX;
    // Add resistance at bounds
    if ((pageIndex === 0 && deltaX > 0) || (pageIndex === totalPages - 1 && deltaX < 0)) {
      setDragOffset(deltaX * 0.3);
    } else {
      setDragOffset(deltaX);
    }
  }

  function handleTouchEnd() {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    const threshold = 55; // pixels to trigger slide
    const delta = touchDeltaXRef.current;

    if (delta < -threshold && pageIndex < totalPages - 1) {
      goNext();
    } else if (delta > threshold && pageIndex > 0) {
      goPrev();
    }
    setDragOffset(0);
  }

  // Base transform percentage with current drag pixel offset
  const transformPercent = -(pageIndex * 100);

  return (
    <div className="v-onboarding">
      {/* Top Mobile Onboarding Bar */}
      <header className="v-onboarding__topbar">
        <div className="v-onboarding__brand">
          <div className="v-onboarding__logo-badge">
            <ShieldCheck size={18} color="var(--color-accent)" strokeWidth={2.4} />
          </div>
          <span className="v-onboarding__brand-name">VISHWAS</span>
        </div>

        {/* Step Indicator */}
        <div className="v-onboarding__step-pill">
          <span>{pageIndex + 1} of {totalPages}</span>
        </div>

        {/* Skip Button (visible on slides 1-3) */}
        {isStaticSlide ? (
          <button
            type="button"
            className="v-onboarding__skip-btn"
            onClick={skipToPermissions}
            aria-label="Skip to permissions setup"
          >
            Skip
          </button>
        ) : (
          <button
            type="button"
            className="v-onboarding__back-btn"
            onClick={() => goToPage(onboardingPages.length - 1)}
            aria-label="Back to intro"
          >
            <ChevronLeft size={16} strokeWidth={2.5} />
            Back
          </button>
        )}
      </header>

      {/* Progress Bar Indicators */}
      <div className="v-onboarding__progress" role="tablist" aria-label="Onboarding Progress">
        {Array.from({ length: totalPages }).map((_, i) => (
          <button
            key={i}
            type="button"
            className={`v-onboarding__progress-bar ${i === pageIndex ? 'v-onboarding__progress-bar--active' : ''} ${i < pageIndex ? 'v-onboarding__progress-bar--completed' : ''}`}
            onClick={() => goToPage(i)}
            aria-label={`Go to slide ${i + 1}`}
            role="tab"
            aria-selected={i === pageIndex}
          />
        ))}
      </div>

      {/* Swipeable Viewport */}
      <div
        className="v-onboarding__viewport"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className={`v-onboarding__track ${isDraggingRef.current ? 'v-onboarding__track--dragging' : ''}`}
          style={{
            transform: `translateX(calc(${transformPercent}% + ${dragOffset}px))`,
          }}
        >
          {onboardingPages.map((page) => (
            <div className="v-onboarding__slide" key={page.id}>
              <OnboardingPageView page={page} />
            </div>
          ))}

          {/* Final Permissions Screen */}
          <div className="v-onboarding__slide v-onboarding__slide--permissions">
            <PermissionsSetupView onContinue={finishOnboarding} />
          </div>
        </div>
      </div>

      {/* Footer Controls for Static Slides */}
      {isStaticSlide && (
        <footer className="v-onboarding__footer">
          <div className="v-onboarding__nav-row">
            {pageIndex > 0 ? (
              <button
                type="button"
                className="v-onboarding__prev-btn"
                onClick={goPrev}
                aria-label="Previous slide"
              >
                Back
              </button>
            ) : (
              <div className="v-onboarding__spacer" />
            )}

            <button
              type="button"
              className={['v-btn', 'v-btn--primary', VFont.headline, 'v-onboarding__action-btn'].join(' ')}
              onClick={goNext}
              aria-label={pageIndex === onboardingPages.length - 1 ? 'Get Started' : 'Next'}
            >
              <span>{pageIndex === onboardingPages.length - 1 ? 'Get Started' : 'Next'}</span>
              <ArrowRight size={18} strokeWidth={2.4} />
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
