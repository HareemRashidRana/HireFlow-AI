/**
 * Error type shared by the HTTP client and the session manager.
 *
 * The backend returns errors in two shapes:
 *   {"detail": "Employee not found"}                                  (401, 403, 404, 409, 429, rule 422)
 *   {"detail": [{"loc": ["body", "work_email"], "msg": "..."}]}       (field validation 422)
 * Both are normalised into ApiError.
 */

export class ApiError extends Error {
  status: number
  /** Field name -> message, for validation errors that point at a specific input. */
  fieldErrors: Record<string, string>
  /** From the Retry-After header (429 responses), in seconds. */
  retryAfterSeconds: number | null

  constructor(
    message: string,
    status: number,
    fieldErrors: Record<string, string> = {},
    retryAfterSeconds: number | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fieldErrors = fieldErrors
    this.retryAfterSeconds = retryAfterSeconds
  }
}

interface ValidationItem {
  loc?: (string | number)[]
  msg?: string
}

export function parseError(status: number, body: unknown, retryAfter: string | null = null): ApiError {
  const detail = (body as { detail?: unknown } | null)?.detail
  const retry = retryAfter && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) : null

  if (typeof detail === 'string') return new ApiError(detail, status, {}, retry)

  if (Array.isArray(detail)) {
    const fieldErrors: Record<string, string> = {}
    for (const item of detail as ValidationItem[]) {
      const field = item.loc?.filter((p) => p !== 'body' && p !== 'query').join('.') ?? ''
      const msg = (item.msg ?? 'Invalid value').replace(/^Value error, /, '')
      if (field && !(field in fieldErrors)) fieldErrors[field] = msg
    }
    return new ApiError('Please correct the highlighted fields.', status, fieldErrors, retry)
  }

  return new ApiError(`Request failed (HTTP ${status}).`, status, {}, retry)
}

export const NETWORK_ERROR_MESSAGE = 'Cannot reach the server. Check that the backend is running.'

export function networkError(): ApiError {
  return new ApiError(NETWORK_ERROR_MESSAGE, 0)
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
