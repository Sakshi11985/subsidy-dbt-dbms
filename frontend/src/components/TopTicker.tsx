import React from 'react';
import { COMMODITY_TICKER } from '../data/mockData';

export const TopTicker: React.FC = () => {
  return (
    <div className="bg-[#0b2416] text-white text-xs border-b border-emerald-950/60 overflow-hidden select-none py-1.5">
      <div className="flex animate-marquee whitespace-nowrap">
        {/* Double list for smooth infinite scroll marquee */}
        {[...COMMODITY_TICKER, ...COMMODITY_TICKER].map((item, idx) => (
          <div key={idx} className="inline-flex items-center space-x-2 mx-5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            <span className="font-medium text-emerald-200/90">{item.crop}</span>
            <span className="font-semibold text-white">{item.price}</span>
            {item.change && (
              <span className={`text-[11px] font-bold ${item.positive ? 'text-emerald-400' : 'text-rose-400'}`}>
                {item.change}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
