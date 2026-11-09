import { useEffect, useState } from 'react'

export type ApiHealth = 'checking' | 'online' | 'degraded' | 'offline'

interface HealthResponse {
  status: string
  database: string
}

/** Polls /api/v1/health every 30s for the sidebar status dot. */
export function useApiHealth(): ApiHealth {
  const [health, setHealth] = useState<ApiHealth>('checking')

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch('/api/v1/health')
        const body = (await res.json()) as HealthResponse
        if (!cancelled) setHealth(res.ok && body.status === 'ok' ? 'online' : 'degraded')
      } catch {
        if (!cancelled) setHealth('offline')
      }
    }
    void check()
    const timer = setInterval(check, 30_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return health
}
