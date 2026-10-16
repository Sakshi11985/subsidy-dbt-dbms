// Minimal toast store (replaces browser alert() popups).
export type ToastKind = 'success' | 'error' | 'info';
export interface Toast { id: number; kind: ToastKind; title: string; message?: string }

type Listener = (toasts: Toast[]) => void;
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l(toasts));

export function subscribe(l: Listener) {
  listeners.add(l);
  l(toasts);
  return () => { listeners.delete(l); };
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function push(kind: ToastKind, title: string, message?: string) {
  const id = nextId++;
  toasts = [...toasts, { id, kind, title, message }].slice(-5);
  emit();
  setTimeout(() => dismiss(id), kind === 'error' ? 9000 : 5000);
}

export const toast = {
  success: (title: string, message?: string) => push('success', title, message),
  error: (title: string, message?: string) => push('error', title, message),
  info: (title: string, message?: string) => push('info', title, message),
};
