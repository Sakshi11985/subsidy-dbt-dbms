import React from 'react';
import { Language } from '../types';
import { TRANSLATIONS } from '../utils/translations';

interface HeroProps {
  language: Language;
  onSelectAction: (tab: string) => void;
  onOpenApplyModal: () => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onToggleLanguage: () => void;
}

export const Hero: React.FC<HeroProps> = ({
  language,
  onSelectAction,
  onOpenApplyModal,
  searchQuery,
  setSearchQuery,
  onToggleLanguage,
}) => {
  const t = TRANSLATIONS[language] || TRANSLATIONS.en;

  return (
    <>
      {/* EXACT HERO SECTION MATCHING FARMER.IN */}
      <section className="nhero">
        {/* Background Image Poster */}
        <div 
          className="nhero-bg" 
          style={{ backgroundImage: "url('/hero-farmer.jpg')" }}
        />

        {/* Real Farmer & Field Background Video from Farmer.in */}
        <video 
          className="nhero-vid" 
          autoPlay 
          muted 
          loop 
          playsInline 
          preload="auto" 
          poster="/hero-farmer.jpg" 
          aria-hidden="true"
        >
          <source src="/hero-farmer.mp4" type="video/mp4" />
        </video>

        {/* Veils & Atmospheric Gradients */}
        <div className="nhero-veil"></div>
        <div className="nhero-glow"></div>

        {/* Hero Content */}
        <div className="nhero-inner">
          
          {/* Eyebrow Pill */}
          <div className="eyebrow">
            <span className="dot"></span>
            <span>{t.heroTagline}</span>
          </div>

          {/* Main Title */}
          <h1>
            {language === 'en' ? (
              <>
                Earn more, spend less<br />
                on your <span className="g">farm</span>.
              </>
            ) : (
              <>
                {t.heroTitleLead}<br />
                <span className="g">{t.heroTitleFarm}</span>
              </>
            )}
          </h1>

          {/* Subtitle */}
          <p className="nhero-sub">
            {t.heroDesc}
          </p>

          {/* Search Box */}
          <div className="nhero-search">
            <input 
              type="text" 
              id="heroSearch"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search a crop price, scheme, tractor loan..." 
            />
            <button type="button" onClick={() => onSelectAction('schemes')}>
              <span>🔍</span>
              <span>Search</span>
            </button>
          </div>

          {/* Trust Badges */}
          <div className="nhero-trust">
            <span>✓ Official Agmarknet data</span>
            <span>💳 100% free</span>
            <span>📊 122 crops · 36 states</span>
            <button 
              type="button" 
              onClick={onToggleLanguage}
              className="cursor-pointer hover:bg-emerald-800 transition"
              title="Click to toggle language"
            >
              <span>🌐</span>
              <span>{language === 'en' ? 'हिंदी & English' : language === 'kn' ? 'ಕನ್ನಡ & More' : 'Languages'}</span>
            </button>
          </div>

          {/* 5 Intent Cards Matching Screenshot Exactly */}
          <div className="intent">
            
            {/* Card 1: Tractor Loan */}
            <a onClick={() => onSelectAction('schemes')} title="Tractor Loan">
              <span className="ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2.5" y="6.5" width="19" height="11" rx="2"/>
                  <circle cx="12" cy="12" r="2.6"/>
                  <path d="M5.5 9.5v5M18.5 9.5v5"/>
                </svg>
              </span>
              <span className="t">Tractor Loan</span>
              <span className="s">Rates by lender</span>
            </a>

            {/* Card 2: Kisan Credit Card */}
            <a onClick={() => onSelectAction('schemes')} title="Kisan Credit Card">
              <span className="ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2.5" y="5" width="19" height="14" rx="2.2"/>
                  <path d="M2.5 9.5h19"/>
                  <path d="M6 15h4"/>
                </svg>
              </span>
              <span className="t">Kisan Credit Card</span>
              <span className="s">₹3 lakh at 4%</span>
            </a>

            {/* Card 3: Claim a Subsidy */}
            <a onClick={onOpenApplyModal} title="Claim a Subsidy">
              <span className="ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3.5" y="10" width="17" height="10" rx="1.5"/>
                  <path d="M3.5 13.5h17M12 10v10"/>
                  <path d="M12 10c-1.8-3.6-6.4-2.6-4.6 0M12 10c1.8-3.6 6.4-2.6 4.6 0"/>
                </svg>
              </span>
              <span className="t">Claim a Subsidy</span>
              <span className="s">Solar · drip · more</span>
            </a>

            {/* Card 4: Buy / Sell Tractor */}
            <a onClick={() => onSelectAction('schemes')} title="Buy / Sell Tractor">
              <span className="ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 8h13M14 5l3 3-3 3"/>
                  <path d="M20 16H7M10 13l-3 3 3 3"/>
                </svg>
              </span>
              <span className="t">Buy / Sell Tractor</span>
              <span className="s">New & used</span>
            </a>

            {/* Card 5: Today's Prices */}
            <a onClick={() => onSelectAction('citizen')} title="Today's Prices">
              <span className="ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4v16h16"/>
                  <path d="M7 15l4-4 3 3 5-6"/>
                  <path d="M19 11V8h-3"/>
                </svg>
              </span>
              <span className="t">Today's Prices</span>
              <span className="s">122 crops live</span>
            </a>

          </div>

        </div>
      </section>

      {/* PM KISAN ALERT STRIP EXACTLY MATCHING SCREENSHOT */}
      <div className="alert-strip" id="announce">
        <div className="alert-inner">
          <span className="text-base">🚨</span>
          <span>
            <strong>PM Kisan:</strong> 23rd installment paid 20 June 2026; 24th not announced yet (likely Oct-Nov 2026).{' '}
            <a onClick={() => onSelectAction('citizen')} className="cursor-pointer">
              Check your status & eKYC now →
            </a>
          </span>
        </div>
      </div>
    </>
  );
};
