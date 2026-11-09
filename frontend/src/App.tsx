import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { ToastProvider } from './components/ui/Toast'
import { EmployeeCreatePage } from './features/employees/pages/EmployeeCreatePage'
import { EmployeeDetailPage } from './features/employees/pages/EmployeeDetailPage'
import { EmployeeEditPage } from './features/employees/pages/EmployeeEditPage'
import { EmployeesPage } from './features/employees/pages/EmployeesPage'

function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/employees" replace />} />
            <Route path="employees" element={<EmployeesPage />} />
            <Route path="employees/new" element={<EmployeeCreatePage />} />
            <Route path="employees/:id" element={<EmployeeDetailPage />} />
            <Route path="employees/:id/edit" element={<EmployeeEditPage />} />
            <Route path="*" element={<Navigate to="/employees" replace />} />
          </Route>
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  )
}

export default App
