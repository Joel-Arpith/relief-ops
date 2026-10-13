import { useEffect, useState } from 'react';

/**
 * Phone layout breakpoint. 768px keeps tablets on the desktop three-pane layout,
 * where a 400px rail beside a map still works; below it the rail becomes a sheet.
 */
const QUERY = '(max-width: 767px)';

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(QUERY).matches : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile(e.matches);
    onChange(mq);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}

/** True on touch-first devices — used to skip cursor-driven ambience. */
export function useIsTouch(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(hover: none), (pointer: coarse)');
    setTouch(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setTouch(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return touch;
}
