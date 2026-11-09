import { useEffect, useState } from 'react'

type Health = { status: string; database: string; version: string }

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/v1/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<Health>
      })
      .then(setHealth)
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">HireFlow AI</h1>
        <p className="mt-1 text-sm text-slate-500">HR Management System</p>

        <div className="mt-6 rounded-lg bg-slate-50 p-4 text-sm">
          <p className="font-medium text-slate-700">Backend status</p>
          {error && <p className="mt-1 text-red-600">Unreachable: {error}</p>}
          {!error && !health && <p className="mt-1 text-slate-500">Checking…</p>}
          {health && (
            <ul className="mt-1 space-y-0.5 text-slate-600">
              <li>API: <span className="font-medium text-emerald-600">{health.status}</span></li>
              <li>Database: <span className="font-medium">{health.database}</span></li>
              <li>Version: {health.version}</li>
            </ul>
          )}
        </div>
      </div>
    </main>
  )
}

export default App
