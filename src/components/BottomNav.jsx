import { useLocation, useNavigate } from 'react-router-dom';
import { Shield, Users, CircleUserRound } from 'lucide-react';
import { useContacts } from '../context/ContactsContext';
import { haptics } from '../services/hapticService';
import './BottomNav.css';

export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { contacts } = useContacts();

  const currentPath = location.pathname;

  const tabs = [
    {
      id: 'home',
      label: 'Home',
      path: '/home',
      icon: Shield,
      badge: null,
    },
    {
      id: 'contacts',
      label: 'Contacts',
      path: '/contacts',
      icon: Users,
      badge: contacts.length > 0 ? contacts.length : null,
    },
    {
      id: 'profile',
      label: 'Account',
      path: '/profile',
      icon: CircleUserRound,
      badge: null,
    },
  ];

  function handleTabClick(path) {
    if (currentPath === path) return;
    haptics.selection();
    navigate(path);
  }

  return (
    <nav className="v-bottom-nav" role="navigation" aria-label="Main Navigation">
      <div className="v-bottom-nav__track">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentPath === tab.path;

          return (
            <button
              key={tab.id}
              type="button"
              className={`v-bottom-nav__item ${isActive ? 'v-bottom-nav__item--active' : ''}`}
              onClick={() => handleTabClick(tab.path)}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <div className="v-bottom-nav__icon-wrap">
                <Icon
                  size={22}
                  strokeWidth={isActive ? 2.4 : 1.9}
                  color={isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)'}
                />
                {tab.badge !== null && (
                  <span className="v-bottom-nav__badge" aria-label={`${tab.badge} contacts`}>
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className="v-bottom-nav__label">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
