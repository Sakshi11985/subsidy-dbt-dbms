import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { Language } from '../types';
import { LANGUAGES, TRANSLATIONS } from '../utils/translations';

interface HeaderProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  fraudCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  setCurrentTab,
  language,
  setLanguage,
  searchQuery,
  setSearchQuery,
  fraudCount,
}) => {
  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const t = TRANSLATIONS[language] || TRANSLATIONS.en;
  const currentLangObj = LANGUAGES.find(l => l.code === language) || LANGUAGES[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsLangDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="bg-white sticky top-0 z-40 border-b border-slate-200 shadow-xs">
      
      {/* 1. Exact Header Bar (Logo, Search, Language, WhatsApp) */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5">
        <div className="flex items-center justify-between gap-4">
          
          {/* Exact Logo with Namma Raitha Branding */}
          <div 
            onClick={() => setCurrentTab('citizen')}
            className="flex items-center gap-2.5 cursor-pointer group shrink-0"
          >
            <img 
              src="/logo-icon.png" 
              alt="Namma Raitha" 
              className="w-10 h-10 object-contain group-hover:scale-105 transition-transform" 
            />
            <div>
              <div className="flex items-center gap-1.5 leading-none">
                <span className="text-2xl font-black tracking-tight text-[#0f3d23] font-sans block">
                  Namma <span className="text-[#16a34a]">Raitha</span>
                </span>
              </div>
              <span className="text-[10.5px] font-semibold text-slate-500 tracking-tight block mt-0.5">
                India's #1 Farmer & DBT Subsidy Platform
              </span>
            </div>
          </div>

          {/* Search bar matching Farmer.in */}
          <div className="hidden md:flex flex-1 max-w-md mx-4">
            <div className="relative w-full">
              <input
                type="text"
                placeholder="Search crops, schemes, mandi..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-4 pr-11 py-2 text-xs bg-slate-50 border border-slate-300 rounded-full focus:outline-none focus:ring-2 focus:ring-[#16a34a] focus:bg-white transition-all shadow-inner"
              />
              <button 
                type="button"
                className="absolute right-1 top-1 p-1 px-2.5 bg-[#16a34a] text-white rounded-full hover:bg-[#15803d] transition cursor-pointer text-xs"
              >
                🔍
              </button>
            </div>
          </div>

          {/* Right Header Actions */}
          <div className="flex items-center gap-2.5 shrink-0">
            
            {/* Multilingual Selector (English, Kannada, Hindi, Telugu, Tamil, Marathi, Punjabi) */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setIsLangDropdownOpen(!isLangDropdownOpen)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 transition shadow-xs cursor-pointer"
                title="Select Language"
              >
                <span className="text-xs">{currentLangObj.flag}</span>
                <span className="font-bold text-slate-900">{currentLangObj.nativeName}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {isLangDropdownOpen && (
                <div className="absolute right-0 mt-2 w-52 bg-white rounded-2xl shadow-2xl border border-slate-200 py-1.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                    Select Language / ಭಾಷೆ / भाषा
                  </div>
                  <div className="max-h-72 overflow-y-auto py-1">
                    {LANGUAGES.map((lang) => {
                      const isSelected = language === lang.code;
                      return (
                        <button
                          key={lang.code}
                          onClick={() => {
                            setLanguage(lang.code);
                            setIsLangDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3.5 py-2 text-xs flex items-center justify-between transition cursor-pointer ${
                            isSelected
                              ? 'bg-emerald-50 text-emerald-900 font-bold'
                              : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{lang.flag}</span>
                            <div>
                              <span className="block font-medium text-slate-900">{lang.nativeName}</span>
                              <span className="text-[10px] text-slate-400">{lang.name}</span>
                            </div>
                          </div>
                          {isSelected && <Check className="w-4 h-4 text-emerald-600" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Join WhatsApp Button */}
            <a
              href="#whatsapp"
              onClick={(e) => { e.preventDefault(); alert("Farmer.in Daily Mandi Updates on WhatsApp:\nJoin 4.2 Lakh Farmers receiving real-time price alerts."); }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-full bg-[#16a34a] hover:bg-[#15803d] text-white shadow-xs transition cursor-pointer"
            >
              <span>📱</span>
              <span>Join WhatsApp</span>
            </a>

          </div>

        </div>
      </div>

      {/* 2. Exact Dark Green Nav Bar from the screenshot */}
      <nav className="bg-[#14472b] text-white px-4 sm:px-6 lg:px-8 border-t border-[#0d341e]">
        <div className="max-w-7xl mx-auto flex items-center justify-between overflow-x-auto no-scrollbar">
          
          <div className="flex items-center space-x-1 sm:space-x-2">
            
            {/* Home Tab with exact yellow bottom border from screenshot */}
            <button
              onClick={() => setCurrentTab('citizen')}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold transition-all cursor-pointer ${
                currentTab === 'citizen'
                  ? 'border-b-2 border-[#facc15] text-[#facc15] bg-[#103b23]'
                  : 'text-emerald-100/90 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>🏠</span>
              <span>Home</span>
            </button>

            {/* Mandi Prices */}
            <button
              onClick={() => setCurrentTab('schemes')}
              className={`inline-flex items-center gap-1 px-3 py-2.5 text-xs font-medium transition cursor-pointer ${
                currentTab === 'schemes'
                  ? 'border-b-2 border-[#facc15] text-[#facc15] bg-[#103b23]'
                  : 'text-emerald-100/90 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>📊</span>
              <span>Mandi Prices</span>
              <span className="text-[10px] text-emerald-300">▾</span>
            </button>

            {/* Subsidies & Schemes */}
            <button
              onClick={() => setCurrentTab('schemes')}
              className="inline-flex items-center gap-1 px-3 py-2.5 text-xs font-medium text-emerald-100/90 hover:text-white hover:bg-white/5 transition cursor-pointer"
            >
              <span>💰</span>
              <span>Subsidies & Schemes</span>
              <span className="text-[10px] text-emerald-300">▾</span>
            </button>

            {/* Buy & Sell */}
            <button
              onClick={() => setCurrentTab('schemes')}
              className="inline-flex items-center gap-1 px-3 py-2.5 text-xs font-medium text-emerald-100/90 hover:text-white hover:bg-white/5 transition cursor-pointer"
            >
              <span>🚜</span>
              <span>Buy & Sell</span>
              <span className="text-[10px] text-emerald-300">▾</span>
            </button>

            {/* Services (Field Verification Desk) */}
            <button
              onClick={() => setCurrentTab('verifier')}
              className={`inline-flex items-center gap-1 px-3 py-2.5 text-xs font-medium transition cursor-pointer ${
                currentTab === 'verifier'
                  ? 'border-b-2 border-[#facc15] text-[#facc15] bg-[#103b23]'
                  : 'text-emerald-100/90 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>🤝</span>
              <span>Services</span>
              <span className="text-[10px] text-emerald-300">▾</span>
            </button>

            {/* Knowledge (DBT Disbursal Desk) */}
            <button
              onClick={() => setCurrentTab('disbursal')}
              className={`inline-flex items-center gap-1 px-3 py-2.5 text-xs font-medium transition cursor-pointer ${
                currentTab === 'disbursal'
                  ? 'border-b-2 border-[#facc15] text-[#facc15] bg-[#103b23]'
                  : 'text-emerald-100/90 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>📚</span>
              <span>Knowledge</span>
              <span className="text-[10px] text-emerald-300">▾</span>
            </button>

            {/* Grow */}
            <button
              onClick={() => setCurrentTab('citizen')}
              className="inline-flex items-center gap-1 px-3 py-2.5 text-xs font-medium text-emerald-100/90 hover:text-white hover:bg-white/5 transition cursor-pointer"
            >
              <span>🌱</span>
              <span>Grow</span>
            </button>

            {/* Community (Fraud & Audit Console) */}
            <button
              onClick={() => setCurrentTab('fraud')}
              className={`inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition cursor-pointer ${
                currentTab === 'fraud'
                  ? 'border-b-2 border-[#facc15] text-[#facc15] bg-[#103b23]'
                  : 'text-emerald-100/90 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>💬</span>
              <span>Community</span>
              {fraudCount > 0 && (
                <span className="bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full animate-pulse">
                  {fraudCount}
                </span>
              )}
            </button>

          </div>

          {/* Join the Sangh button on far right from screenshot */}
          <div className="hidden lg:flex items-center pl-4 py-1.5">
            <button
              onClick={() => alert("Welcome to the Kisan Sangh Community!")}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#16a34a] hover:bg-[#15803d] text-white text-xs font-bold transition shadow-xs cursor-pointer whitespace-nowrap"
            >
              <span>🌾</span>
              <span>Join the Sangh</span>
            </button>
          </div>

        </div>
      </nav>
    </header>
  );
};
