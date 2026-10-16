import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertOctagon, Info, X } from 'lucide-react';
import { subscribe, dismiss, Toast } from '../utils/toast';

const STYLE = {
  success: 'bg-emerald-50 border-emerald-300 text-emerald-950',
  error: 'bg-rose-50 border-rose-300 text-rose-950',
  info: 'bg-slate-50 border-slate-300 text-slate-900',
};

export const Toaster: React.FC = () => {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => subscribe(setItems), []);
  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] flex flex-col gap-2 sm:w-[420px]" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} role="status" className={`rounded-2xl border shadow-lg p-4 text-xs flex gap-3 ${STYLE[t.kind]}`}>
          {t.kind === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />}
          {t.kind === 'error' && <AlertOctagon className="w-5 h-5 text-rose-600 shrink-0" />}
          {t.kind === 'info' && <Info className="w-5 h-5 text-slate-600 shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm">{t.title}</p>
            {t.message && <p className="mt-1 font-mono text-[11px] leading-relaxed break-words">{t.message}</p>}
          </div>
          <button onClick={() => dismiss(t.id)} className="shrink-0 opacity-60 hover:opacity-100 cursor-pointer" aria-label="Dismiss">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
