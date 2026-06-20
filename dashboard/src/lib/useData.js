import { useCallback, useEffect, useState } from 'react';

// Tiny data hook around a supabase query factory. `fn` returns a thenable that
// resolves to { data, error } (i.e. a supabase query builder). Re-runs when any
// value in `deps` changes; exposes refetch() for after mutations.
export function useQuery(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => {
    setLoading(true);
    return Promise.resolve(fn())
      .then((res) => {
        setData(res?.data ?? null);
        setError(res?.error ?? null);
      })
      .catch((e) => setError(e))
      .finally(() => setLoading(false));
  }, deps);

  useEffect(() => {
    run();
  }, [run]);

  return { data, error, loading, refetch: run };
}
