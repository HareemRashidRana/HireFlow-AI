import { useState } from 'react'
import { attendanceApi } from '../../../api/workforce'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'

/**
 * Today's attendance for the signed-in person, with check in and check out. `refresh` changes
 * whenever something was recorded, so other queries on the page can reload with it.
 */
export function useTodayAttendance(enabled: boolean) {
  const toast = useToast()
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const today = useQuery((s) => attendanceApi.today(s), `att-today-${refresh}`, enabled)

  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try {
      await work()
      toast.success(done)
      setRefresh((n) => n + 1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That did not work. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return {
    today,
    refresh,
    busy,
    checkIn: () => act(attendanceApi.checkIn, 'You are checked in.'),
    checkOut: () => act(attendanceApi.checkOut, 'You are checked out.'),
  }
}
