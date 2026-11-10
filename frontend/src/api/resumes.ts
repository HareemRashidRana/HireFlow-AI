import type { Resume, ResumeList, ResumeParsed, ReviewedResume } from '../types/resume'
import { download, request } from './http'

const cand = (id: string) => `/candidates/${encodeURIComponent(id)}/resumes`
const one = (id: string) => `/resumes/${encodeURIComponent(id)}`

export const resumesApi = {
  list: (candidateId: string, signal?: AbortSignal) =>
    request<ResumeList>(`${cand(candidateId)}?page_size=50`, { signal }),

  /** The file goes up as multipart form data; the server decides what it really is. */
  upload: (candidateId: string, file: File, signal?: AbortSignal) => {
    const form = new FormData()
    form.append('file', file, file.name)
    return request<Resume>(cand(candidateId), { method: 'POST', formData: form, signal })
  },

  parsed: (id: string, signal?: AbortSignal) => request<ResumeParsed>(`${one(id)}/parsed`, { signal }),

  /** Re-read the stored file. Used to retry a failed or empty extraction. */
  parse: (id: string) => request<Resume>(`${one(id)}/parse`, { method: 'POST' }),

  /** A human review. The server insists on the explicit confirm flag; nothing else is changed. */
  review: (id: string, data: ReviewedResume) =>
    request<Resume>(`${one(id)}/review`, { method: 'PUT', json: { ...data, confirm: true } }),

  activate: (id: string) => request<Resume>(`${one(id)}/activate`, { method: 'POST' }),

  remove: (id: string) => request<void>(one(id), { method: 'DELETE' }),

  download: (id: string) => download(`${one(id)}/download`),
}
