import { useSyncExternalStore } from 'react';

/**
 * Light (editorial cream) is the default; dark is opt-in via `html.dark`.
 * index.css swaps the semantic color tokens when the class is present.
 */
const KEY = 'nod-theme';

const isDark = (): boolean => document.documentElement.classList.contains('dark');

const subscribe = (onChange: () => void): (() => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
};

export function useDarkTheme(): boolean {
  return useSyncExternalStore(subscribe, isDark, () => false);
}

export function toggleTheme(): void {
  const dark = !isDark();
  document.documentElement.classList.toggle('dark', dark);
  try {
    localStorage.setItem(KEY, dark ? 'dark' : 'light');
  } catch {
    /* private mode — the toggle still works for this session */
  }
}
