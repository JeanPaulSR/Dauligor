import { useState, useEffect } from 'react';

/**
 * Subscribe to a CSS media query. Returns whether the query currently
 * matches. Updates on viewport resize.
 *
 * Use Tailwind's standard breakpoint pixel values to stay aligned with
 * the rest of the app:
 *
 *   useMediaQuery('(min-width: 640px)')  // sm
 *   useMediaQuery('(min-width: 768px)')  // md
 *   useMediaQuery('(min-width: 1024px)') // lg
 *
 * On the server / during pre-hydration, returns `false`. The first
 * effect run reconciles to the real viewport on the client.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    // Sync initial value in case it changed between SSR and hydration.
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

export default useMediaQuery;
