import { useEffect, useState } from 'react';

/** Unix seconds, ticking once a second while `active` (countdowns). */
export function useNowSeconds(active = true): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now() / 1000);
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
