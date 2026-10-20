import { VFont } from '../../design-system/theme';
import { withAlpha } from '../../utils/colorUtils';
import './onboarding.css';

/**
 * OnboardingPageView — individual slide view with polished icon halo and typography.
 */
export function OnboardingPageView({ page }) {
  const Icon = page.icon;

  return (
    <div className="v-onboarding-page">
      <div className="v-onboarding-page__illustration">
        <div
          className="v-onboarding-page__halo"
          style={{ background: withAlpha(page.tint, 0.08) }}
        />
        <div
          className="v-onboarding-page__icon-wrap"
          style={{
            background: withAlpha(page.tint, 0.14),
            borderColor: withAlpha(page.tint, 0.25),
          }}
        >
          <Icon size={56} strokeWidth={2} color={page.tint} aria-hidden="true" />
        </div>
      </div>

      <div className="v-onboarding-page__copy">
        <h2 className={['v-onboarding-page__title', VFont.display].join(' ')}>
          {page.title.split('\n').map((line, i) => (
            <span key={i}>
              {line}
              {i === 0 && <br />}
            </span>
          ))}
        </h2>
        <p className={['v-onboarding-page__desc', VFont.body].join(' ')}>
          {page.subtitle}
        </p>
      </div>
    </div>
  );
}
