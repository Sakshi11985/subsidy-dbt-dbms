import React, { useState } from 'react';
import { Scheme, Language } from '../types';
import { ArrowRight, CheckCircle2, ChevronRight, Filter } from 'lucide-react';
import { TRANSLATIONS } from '../utils/translations';

interface SchemesGridProps {
  schemes: Scheme[];
  language: Language;
  onApplyForScheme: (scheme: Scheme) => void;
  searchFilter: string;
}

export const SchemesGrid: React.FC<SchemesGridProps> = ({
  schemes,
  language,
  onApplyForScheme,
  searchFilter,
}) => {
  const t = TRANSLATIONS[language] || TRANSLATIONS.en;
  const isHi = language === 'hi';

  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  const categories = ['ALL', 'Direct Income Support', 'Renewable Irrigation', 'Micro-Irrigation', 'Farm Machinery', 'Institutional Credit', 'High Value Horticulture'];

  const filteredSchemes = schemes.filter(scheme => {
    const matchesSearch = 
      scheme.title_en.toLowerCase().includes(searchFilter.toLowerCase()) ||
      scheme.title_hi.includes(searchFilter) ||
      scheme.category.toLowerCase().includes(searchFilter.toLowerCase()) ||
      scheme.scheme_code.toLowerCase().includes(searchFilter.toLowerCase());

    const matchesCat = selectedCategory === 'ALL' || scheme.category === selectedCategory;

    return matchesSearch && matchesCat;
  });

  return (
    <section className="py-10 bg-slate-50 border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header matching Farmer.in screenshot 3 */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
          <div>
            <div className="flex items-center gap-2 text-emerald-800 font-bold text-lg mb-1">
              <span>🚜</span>
              <span>{t.schemesSectionTitle}</span>
            </div>
            <p className="text-sm text-slate-600">
              {t.schemesSectionDesc}
            </p>
          </div>

          {/* Category filter pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
            <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0 mr-1" />
            {categories.slice(0, 4).map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                  selectedCategory === cat
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {cat === 'ALL' ? t.allSubsidies : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Schemes Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredSchemes.map((scheme) => (
            <div
              key={scheme.scheme_id}
              className="bg-white rounded-2xl overflow-hidden border border-slate-200/90 shadow-sm hover:shadow-xl hover:border-emerald-500/40 transition-all duration-300 flex flex-col group"
            >
              {/* Image banner with floating badge */}
              <div className="relative h-48 overflow-hidden bg-slate-100">
                <img
                  src={scheme.image_url}
                  alt={scheme.title_en}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = '/solar.jpg';
                  }}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
                
                {/* Floating Tag matching Farmer.in screenshot 3 */}
                <div className="absolute top-3 left-3">
                  <span className="px-2.5 py-1 rounded-md bg-amber-400 text-amber-950 font-bold text-xs shadow-md">
                    {scheme.tag_text}
                  </span>
                </div>

                {/* Scheme Code badge */}
                <div className="absolute bottom-3 left-3 text-white">
                  <span className="text-[11px] font-mono font-bold tracking-wider bg-black/40 backdrop-blur-xs px-2 py-0.5 rounded">
                    {scheme.scheme_code}
                  </span>
                </div>
              </div>

              {/* Card Body */}
              <div className="p-5 flex-1 flex flex-col justify-between">
                <div>
                  <h3 className="font-bold text-lg text-slate-900 group-hover:text-emerald-700 transition-colors line-clamp-1">
                    {isHi ? scheme.title_hi : scheme.title_en}
                  </h3>
                  <p className="mt-1.5 text-xs text-slate-600 line-clamp-2 leading-relaxed">
                    {isHi ? scheme.subsidy_summary_hi : scheme.subsidy_summary_en}
                  </p>

                  {/* Benefit highlights */}
                  <div className="mt-4 p-3 rounded-xl bg-emerald-50/70 border border-emerald-100">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 font-medium">DBT Benefit Value:</span>
                      <span className="text-emerald-800 font-extrabold text-sm font-mono">
                        ₹{scheme.benefit_amount.toLocaleString('en-IN')}
                        {scheme.instalments_count > 1 ? ` (${scheme.instalments_count} instalments)` : ' (1-shot)'}
                      </span>
                    </div>
                  </div>

                  {/* Database Eligibility Rules evaluated generically (Fix ⑦) */}
                  <div className="mt-3">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                      DB Rules (EligibilityRules table):
                    </span>
                    <div className="space-y-1">
                      {scheme.rules.map((rule) => (
                        <div key={rule.rule_id} className="flex items-start gap-1.5 text-[11px] text-slate-700">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                          <span>{rule.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Card Action footer */}
                <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
                  <button
                    onClick={() => onApplyForScheme(scheme)}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-xs cursor-pointer group-hover:bg-emerald-700"
                  >
                    <span>{t.checkEligibilityBtn}</span>
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>

              </div>
            </div>
          ))}
        </div>

        {/* Exact Tractor Valuation Banner matching Farmer.in screenshot 4 */}
        <div className="mt-14 bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm flex flex-col lg:flex-row items-center gap-8">
          <div className="w-full lg:w-1/2 rounded-2xl overflow-hidden shadow-md">
            <img 
              src="/tractor2.jpg" 
              alt="Red Tractor in Field" 
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = '/tractor.jpg';
              }}
              className="w-full h-80 object-cover hover:scale-105 transition-transform duration-500"
            />
          </div>
          <div className="w-full lg:w-1/2">
            <span className="text-xs font-bold text-[#d97706] uppercase tracking-widest bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
              SELL & UPGRADE
            </span>
            <h2 className="text-2xl sm:text-3xl font-black text-[#0f3d23] mt-3 leading-snug">
              What's your tractor worth?
            </h2>
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">
              Get a free instant valuation of your used tractor, then sell it to verified buyers near you. Or browse second-hand tractors by brand and budget.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button 
                onClick={() => onApplyForScheme(schemes[3])}
                className="px-5 py-2.5 rounded-xl bg-[#15803d] hover:bg-[#166534] text-white font-bold text-xs shadow-md transition flex items-center gap-2 cursor-pointer"
              >
                <span>💰 Free valuation</span>
              </button>
              <button 
                onClick={() => onApplyForScheme(schemes[3])}
                className="px-5 py-2.5 rounded-xl bg-white border border-[#15803d] text-[#15803d] hover:bg-emerald-50 font-bold text-xs transition flex items-center gap-2 cursor-pointer"
              >
                <span>Browse used tractors →</span>
              </button>
            </div>
          </div>
        </div>

        {/* Real Farmer Wins Grid matching screenshot 5 */}
        <div className="mt-14">
          <div className="mb-6">
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2">
              <span>🌾</span>
              <span>Built for farmers like you</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Real schemes, real money, real prices, working for farmers across India every day.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Win 1 */}
            <div className="bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm flex flex-col group hover:shadow-md transition">
              <div className="h-44 overflow-hidden">
                <img 
                  src="/smiling-harvest.jpg" 
                  alt="Farmer smiling with harvest" 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                />
              </div>
              <div className="p-4 flex-1 flex flex-col justify-between">
                <div>
                  <h4 className="font-bold text-sm text-slate-900">₹6,000 a year, straight to your account</h4>
                  <p className="text-xs text-slate-500 mt-1">PM-Kisan pays eligible farmers in 3 instalments. Check your status and eKYC.</p>
                </div>
                <button 
                  onClick={() => onApplyForScheme(schemes[0])}
                  className="mt-3 text-xs font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 cursor-pointer"
                >
                  <span>PM-Kisan status →</span>
                </button>
              </div>
            </div>

            {/* Win 2 */}
            <div className="bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm flex flex-col group hover:shadow-md transition">
              <div className="h-44 overflow-hidden">
                <img 
                  src="/solar-farmer.jpg" 
                  alt="Farmer with solar pump" 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                />
              </div>
              <div className="p-4 flex-1 flex flex-col justify-between">
                <div>
                  <h4 className="font-bold text-sm text-slate-900">Up to 90% off a solar pump</h4>
                  <p className="text-xs text-slate-500 mt-1">PM-KUSUM cuts your diesel bill to zero with heavily subsidised solar irrigation.</p>
                </div>
                <button 
                  onClick={() => onApplyForScheme(schemes[1])}
                  className="mt-3 text-xs font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 cursor-pointer"
                >
                  <span>Get solar subsidy →</span>
                </button>
              </div>
            </div>

            {/* Win 3 */}
            <div className="bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm flex flex-col group hover:shadow-md transition">
              <div className="h-44 overflow-hidden">
                <img 
                  src="/women-farmers.jpg" 
                  alt="Indian women farmers in field" 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                />
              </div>
              <div className="p-4 flex-1 flex flex-col justify-between">
                <div>
                  <h4 className="font-bold text-sm text-slate-900">Sell at the best price near you</h4>
                  <p className="text-xs text-slate-500 mt-1">Track live prices from 7,000+ mandis and find the market paying the most today.</p>
                </div>
                <button 
                  onClick={() => onApplyForScheme(schemes[2])}
                  className="mt-3 text-xs font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 cursor-pointer"
                >
                  <span>Find your mandi →</span>
                </button>
              </div>
            </div>

          </div>
        </div>

      </div>
    </section>
  );
};
