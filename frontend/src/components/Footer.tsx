import React from 'react';
import { Sprout, ShieldCheck, Phone, Database } from 'lucide-react';
import { Language } from '../types';

interface FooterProps {
  language: Language;
}

export const Footer: React.FC<FooterProps> = ({ language }) => {
  const isHi = language === 'hi';

  return (
    <footer className="bg-[#0b2214] text-slate-300 border-t border-emerald-950 text-xs">
      {/* Top Banner */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* Brand info */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-600 flex items-center justify-center text-white">
                <Sprout className="w-5 h-5 text-amber-300" />
              </div>
              <div className="flex flex-col">
                <span className="text-xl font-black text-white leading-tight">
                  Namma <span className="text-emerald-400">Raitha</span>
                </span>
                <span className="text-[10px] text-emerald-300/80 font-medium tracking-wider">ನಮ್ಮ ರೈತ</span>
              </div>
            </div>
            <p className="text-emerald-100/70 text-xs leading-relaxed">
              {isHi
                ? "भारत का विश्वसनीय किसान मंच। सरकारी सब्सिडी, मंडी भाव, और शून्य-लीकेज डीबीटी गारंटी।"
                : "India's premier farmer empowerment platform. Guaranteed Direct Benefit Transfers, live Agmarknet prices, and transparent benefit distribution."}
            </p>
            <div className="pt-2 flex items-center gap-2 text-emerald-400 text-xs">
              <ShieldCheck className="w-4 h-4" />
              <span>Certified DBT Compliance</span>
            </div>
          </div>

          {/* Subsidies & Schemes */}
          <div>
            <h4 className="font-bold text-white uppercase tracking-wider text-xs mb-3 text-emerald-300">
              {isHi ? 'प्रमुख सरकारी योजनाएं' : 'Govt Subsidies & Schemes'}
            </h4>
            <ul className="space-y-2 text-slate-300">
              <li>PM-Kisan Samman Nidhi (₹6,000/yr)</li>
              <li>PM-KUSUM Solar Agricultural Pumps</li>
              <li>PM Krishi Sinchayee Yojana (Drip Irrigation)</li>
              <li>Sub-Mission on Agri Mechanization (SMAM)</li>
              <li>Kisan Credit Card (KCC @ 4%)</li>
            </ul>
          </div>

          {/* Emergency / Help */}
          <div className="space-y-3">
            <h4 className="font-bold text-white uppercase tracking-wider text-xs mb-3 text-emerald-300">
              Farmer Helpdesk & Support
            </h4>
            <p className="text-slate-300 text-xs">
              Toll-Free Kisan Call Centre:
            </p>
            <div className="p-3 bg-emerald-950/80 rounded-xl border border-emerald-800/60 font-mono text-amber-300 text-sm font-bold flex items-center gap-2">
              <Phone className="w-4 h-4 text-emerald-400" />
              <span>1800-180-1551</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Operational 6:00 AM to 10:00 PM all 7 days a week in 22 regional Indian languages.
            </p>
          </div>

        </div>

        {/* Bottom credits */}
        <div className="mt-10 pt-6 border-t border-emerald-900/60 flex flex-col sm:flex-row items-center justify-between text-slate-400 text-[11px] gap-3">
          <p>
            © 2026 Namma Raitha (ನಮ್ಮ ರೈತ) DBT Platform. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1 text-emerald-300">
              <Database className="w-3.5 h-3.5" />
              <span>Direct Benefit Transfer (DBT) Platform</span>
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
};
