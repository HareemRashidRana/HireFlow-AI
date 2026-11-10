/** Hands a downloaded file to the browser's "save as". Nothing is kept in browser storage. */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Release the in-memory copy right after the browser has started the save.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
