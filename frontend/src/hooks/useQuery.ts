import { useCallback, useEffect, useState } from 'react'
import { ApiError, isAbortError } from '../api/client'

interface QueryState<T> {
  data: T | null
  error: ApiError | null
  loading: boolean
  reload: () => void
}

/**
 * Runs `fetcher` whenever `key` changes (or `reload()` is called) and cancels stale requests.
 * `data` keeps the previous result while a new request loads, so lists don't flash empty.
 */
export function useQuery<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  key: string,
  enabled = true,
): QueryState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-change pattern
    setLoading(true)
    setError(null)
    fetcher(controller.signal)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((e: unknown) => {
        if (cancelled || isAbortError(e)) return
        setError(e instanceof ApiError ? e : new ApiError('Something went wrong.', 0))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
    // `fetcher` is intentionally keyed by `key` so callers can pass inline closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, enabled])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, error, loading, reload }
}
