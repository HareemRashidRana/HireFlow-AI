/**
 * Small fetch wrapper. All calls go to /api/... which Vite proxies to FastAPI in development.
 *
 * The backend returns errors in two shapes:
 *   {"detail": "Employee not found"}                                  (404, 409, rule-based 422)
 *   {"detail": [{"loc": ["body", "work_email"], "msg": "..."}]}       (field validation 422)
 * Both are normalised into ApiError.
 */

export class ApiError extends Error {
  status: number
  /** Field name -> message, for validation errors that point at a specific input. */
  fieldErrors: Record<string, string>

  constructor(message: string, status: number, fieldErrors: Record<string, string> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

interface ValidationItem {
  loc?: (string | number)[]
  msg?: string
}

function parseError(status: number, body: unknown): ApiError {
  const detail = (body as { detail?: unknown } | null)?.detail

  if (typeof detail === 'string') return new ApiError(detail, status)

  if (Array.isArray(detail)) {
    const fieldErrors: Record<string, string> = {}
    for (const item of detail as ValidationItem[]) {
      const field = item.loc?.filter((p) => p !== 'body' && p !== 'query').join('.') ?? ''
      const msg = (item.msg ?? 'Invalid value').replace(/^Value error, /, '')
      if (field && !(field in fieldErrors)) fieldErrors[field] = msg
    }
    return new ApiError('Please correct the highlighted fields.', status, fieldErrors)
  }

  return new ApiError(`Request failed (HTTP ${status}).`, status)
}

export async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = init
  let response: Response
  try {
    response = await fetch(`/api/v1${path}`, {
      ...rest,
      headers: { Accept: 'application/json', ...(json !== undefined && { 'Content-Type': 'application/json' }), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('Cannot reach the server. Check that the backend is running.', 0)
  }

  if (response.status === 204) return undefined as T

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    /* non-JSON body */
  }

  if (!response.ok) throw parseError(response.status, body)
  return body as T
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
