import { useState } from 'react'
import { employeesApi } from '../../../api/employees'
import { ApiError } from '../../../api/client'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Feedback'
import { Modal } from '../../../components/ui/Modal'
import { fullName } from '../../../lib/format'
import type { Employee } from '../../../types/employee'

interface Props {
  employee: Employee | null
  onClose: () => void
  /** Called after the employee was deleted successfully. */
  onDeleted: (employee: Employee) => void
}

export function DeleteEmployeeDialog({ employee, onClose, onDeleted }: Props) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    if (deleting) return
    setError(null)
    onClose()
  }

  const confirm = async () => {
    if (!employee) return
    setDeleting(true)
    setError(null)
    try {
      await employeesApi.remove(employee.id)
      onDeleted(employee)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not delete this employee.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal
      open={employee !== null}
      onClose={close}
      title="Delete employee?"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} loading={deleting}>
            Delete employee
          </Button>
        </>
      }
    >
      {employee && (
        <div className="space-y-3">
          <p>
            You are about to permanently delete{' '}
            <strong className="text-navy-900">{fullName(employee)}</strong> ({employee.employee_id}).
            This cannot be undone. If they only left the company, set their status to Terminated instead.
          </p>
          {error && <Alert>{error}</Alert>}
        </div>
      )}
    </Modal>
  )
}
