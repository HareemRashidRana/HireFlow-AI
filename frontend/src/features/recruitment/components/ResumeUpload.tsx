import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { isAbortError } from '../../../api/client'
import { resumesApi } from '../../../api/resumes'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Feedback'
import { useToast } from '../../../components/ui/Toast'
import type { Resume } from '../../../types/resume'
import { ACCEPT_ATTRIBUTE, MAX_RESUME_BYTES, formatBytes, validateResumeFile } from '../lib/resumes'

interface Props {
  candidateId: string
  onUploaded: (resume: Resume) => void
}

/**
 * Drag a PDF or DOCX onto the zone, or choose one. The browser cannot report byte-level upload
 * progress through fetch, so while the file is on its way an honest "working" bar is shown, with a
 * Cancel button. The server validates the file's real content; the checks here are only for speed.
 */
export function ResumeUpload({ candidateId, onUploaded }: Props) {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const controller = useRef<AbortController | null>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const send = async (files: FileList | File[]) => {
    if (uploading) return
    setError(null)
    if (files.length === 0) return
    if (files.length > 1) {
      setError('Upload one resume at a time.')
      return
    }
    const file = files[0]
    const problem = validateResumeFile(file)
    if (problem) {
      setError(problem)
      return
    }
    const ctl = new AbortController()
    controller.current = ctl
    setUploading(file.name)
    try {
      const resume = await resumesApi.upload(candidateId, file, ctl.signal)
      toast.success('Resume uploaded.')
      onUploaded(resume)
    } catch (err) {
      if (isAbortError(err)) setError('Upload cancelled.')
      else setError(err instanceof Error ? err.message : 'The upload failed. Please try again.')
    } finally {
      controller.current = null
      setUploading(null)
      if (input.current) input.current.value = '' // allow choosing the same file again
    }
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    void send(e.dataTransfer.files)
  }

  return (
    <div>
      <div
        data-testid="resume-dropzone"
        onDragOver={(e) => {
          e.preventDefault()
          if (!uploading) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
          dragging ? 'border-lavender-500 bg-lavender-50' : 'border-slate-200 bg-slate-50/60'
        }`}
      >
        {uploading ? (
          <div role="status" aria-live="polite">
            <p className="text-sm font-medium text-navy-900 [overflow-wrap:anywhere]">Uploading {uploading}…</p>
            <div
              role="progressbar"
              aria-label="Uploading the resume"
              aria-busy="true"
              className="mx-auto mt-3 h-1.5 max-w-xs overflow-hidden rounded-full bg-slate-200"
            >
              <div className="h-full w-1/3 animate-pulse rounded-full bg-lavender-500" />
            </div>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => controller.current?.abort()}>
              Cancel upload
            </Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-600">Drag a resume here, or</p>
            <Button variant="secondary" className="mt-2" onClick={() => input.current?.click()}>
              Choose a file
            </Button>
            <p className="mt-2 text-xs text-slate-500">PDF or DOCX, up to {formatBytes(MAX_RESUME_BYTES)}.</p>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          aria-label="Resume file"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => e.target.files && void send(e.target.files)}
        />
      </div>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
    </div>
  )
}
