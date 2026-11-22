import { useCallback, useEffect, useRef, useState } from 'react';

export type OnceState<T> =
  | { state: 'idle' }
  | { state: 'pending' }
  | { state: 'done'; value: T }
  | { state: 'error'; error: unknown };

/** One promise per key for the whole page session: StrictMode re-runs and remounts share it. */
const cache = new Map<string, Promise<unknown>>();

/**
 * Run `run` once per `key` (null = not yet) and expose its result. Used for the calls that must not
 * repeat, like POST /api/pay/settle. `retry()` forgets the cached result and runs again.
 */
export function useOnce<T>(key: string | null, run: () => Promise<T>): OnceState<T> & { retry: () => void } {
  const [result, setResult] = useState<OnceState<T>>({ state: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const runRef = useRef(run);

  useEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    if (!key) {
      setResult({ state: 'idle' });
      return;
    }
    let cancelled = false;
    let promise = cache.get(key) as Promise<T> | undefined;
    if (!promise) {
      promise = runRef.current();
      cache.set(key, promise);
    }
    setResult({ state: 'pending' });
    promise.then(
      (value) => {
        if (!cancelled) setResult({ state: 'done', value });
      },
      (error: unknown) => {
        if (cache.get(key) === promise) cache.delete(key);
        if (!cancelled) setResult({ state: 'error', error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, attempt]);

  const retry = useCallback(() => {
    if (key) cache.delete(key);
    setAttempt((n) => n + 1);
  }, [key]);

  return { ...result, retry };
}
