import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { HomeRedirect, PublicOnly, RequireAuth, RequirePermission, RequireRole } from './auth/guards'
import { AppShell } from './components/layout/AppShell'
import { ToastProvider } from './components/ui/Toast'
import { ChangePasswordPage } from './features/auth/ChangePasswordPage'
import { LoginPage } from './features/auth/LoginPage'
import { EmployeeCreatePage } from './features/employees/pages/EmployeeCreatePage'
import { EmployeeDetailPage } from './features/employees/pages/EmployeeDetailPage'
import { EmployeeEditPage } from './features/employees/pages/EmployeeEditPage'
import { EmployeesPage } from './features/employees/pages/EmployeesPage'
import { ProfilePage } from './features/employees/pages/ProfilePage'
import { ApplicationCreatePage } from './features/recruitment/pages/ApplicationCreatePage'
import { ApplicationDetailPage } from './features/recruitment/pages/ApplicationDetailPage'
import { ApplicationsPage } from './features/recruitment/pages/ApplicationsPage'
import { PrivacyPage } from './features/privacy/pages/PrivacyPage'
import { PipelineBoardPage } from './features/recruitment/pages/PipelineBoardPage'
import { CandidateCreatePage } from './features/recruitment/pages/CandidateCreatePage'
import { CandidateDetailPage } from './features/recruitment/pages/CandidateDetailPage'
import { CandidateEditPage } from './features/recruitment/pages/CandidateEditPage'
import { CandidatesPage } from './features/recruitment/pages/CandidatesPage'
import { JobCreatePage } from './features/recruitment/pages/JobCreatePage'
import { JobDetailPage } from './features/recruitment/pages/JobDetailPage'
import { JobEditPage } from './features/recruitment/pages/JobEditPage'
import { AdminOverviewPage } from './features/panels/admin/AdminOverviewPage'
import { RolesPage } from './features/panels/admin/RolesPage'
import { UsersPage } from './features/panels/admin/UsersPage'
import { EmployeeHomePage } from './features/panels/employee/EmployeeHomePage'
import { HrHomePage, HrReportsPage } from './features/panels/hr/HrPages'
import { RecruiterHomePage } from './features/panels/recruiter/RecruiterHomePage'
import { AttendanceHistoryPage } from './features/workforce/pages/AttendanceHistoryPage'
import { AttendanceManagePage } from './features/workforce/pages/AttendanceManagePage'
import { AttendanceOverviewPage } from './features/workforce/pages/AttendanceOverviewPage'
import { AttendancePage } from './features/workforce/pages/AttendancePage'
import { LeaveApprovalsPage } from './features/workforce/pages/LeaveApprovalsPage'
import { LeaveBalancesPage } from './features/workforce/pages/LeaveBalancesPage'
import { LeaveCalendarPage } from './features/workforce/pages/LeaveCalendarPage'
import { LeaveDashboardPage } from './features/workforce/pages/LeaveDashboardPage'
import { MyLeavePage } from './features/workforce/pages/MyLeavePage'
import { WorkSettingsPage } from './features/workforce/pages/WorkSettingsPage'
import { DashboardPage } from './features/dashboard/pages/DashboardPage'
import { InterviewDetailPage } from './features/recruitment/pages/InterviewDetailPage'
import { InterviewsPage } from './features/recruitment/pages/InterviewsPage'
import { JobsPage } from './features/recruitment/pages/JobsPage'

function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />

            {/* Signed in, but allowed while a password change is pending */}
            <Route
              path="/change-password"
              element={<RequireAuth allowPasswordChange><ChangePasswordPage /></RequireAuth>}
            />

            {/* Signed in */}
            <Route element={<RequireAuth><AppShell /></RequireAuth>}>
              <Route index element={<HomeRedirect />} />
              <Route path="dashboard" element={<RequirePermission permission="analytics:read"><DashboardPage /></RequirePermission>} />
              {/* Attendance and leave. Own pages need a linked employee record (the page says so);
                  HR pages need workforce:manage. The API enforces both. */}
              <Route path="attendance" element={<AttendancePage />} />
              <Route path="attendance/history" element={<AttendanceHistoryPage />} />
              <Route path="attendance/overview" element={<RequirePermission permission="workforce:manage"><AttendanceOverviewPage /></RequirePermission>} />
              <Route path="attendance/manage" element={<RequirePermission permission="workforce:manage"><AttendanceManagePage /></RequirePermission>} />
              <Route path="leave" element={<LeaveDashboardPage />} />
              <Route path="leave/requests" element={<MyLeavePage />} />
              <Route path="leave/approvals" element={<RequirePermission permission="workforce:manage"><LeaveApprovalsPage /></RequirePermission>} />
              <Route path="leave/balances" element={<LeaveBalancesPage />} />
              <Route path="leave/calendar" element={<LeaveCalendarPage />} />
              <Route path="settings/work" element={<RequirePermission permission="workforce:manage"><WorkSettingsPage /></RequirePermission>} />
              {/* The four panels: each role has its own landing page and navigation (see navigation.ts). */}
              <Route path="admin" element={<RequireRole roles={['admin']}><AdminOverviewPage /></RequireRole>} />
              <Route path="admin/users" element={<RequirePermission permission="users:manage"><UsersPage /></RequirePermission>} />
              <Route path="admin/roles" element={<RequirePermission permission="users:manage"><RolesPage /></RequirePermission>} />
              <Route path="admin/settings" element={<RequirePermission permission="workforce:manage"><WorkSettingsPage /></RequirePermission>} />
              <Route path="hr" element={<RequireRole roles={['hr_manager']}><HrHomePage /></RequireRole>} />
              <Route path="hr/reports" element={<RequireRole roles={['hr_manager']}><HrReportsPage /></RequireRole>} />
              <Route path="recruiter" element={<RequireRole roles={['recruiter']}><RecruiterHomePage /></RequireRole>} />
              <Route path="employee" element={<RequireRole roles={['employee']}><EmployeeHomePage /></RequireRole>} />
              <Route path="profile" element={<ProfilePage />} />

              {/* Role-restricted. The API enforces the same rules; these just show a clear message. */}
              <Route
                path="employees"
                element={<RequirePermission permission="employees:read"><EmployeesPage /></RequirePermission>}
              />
              <Route
                path="employees/new"
                element={<RequirePermission permission="employees:write"><EmployeeCreatePage /></RequirePermission>}
              />
              {/* Everyone may open this route; the server only returns the caller's own record to employees. */}
              <Route path="employees/:id" element={<EmployeeDetailPage />} />
              <Route
                path="employees/:id/edit"
                element={<RequirePermission permission="employees:write"><EmployeeEditPage /></RequirePermission>}
              />

              {/* Recruitment: jobs. Same rules as the API (recruitment:*). */}
              <Route path="recruitment" element={<Navigate to="/recruitment/jobs" replace />} />
              {/* Interviews: schedule, track and give feedback (interviews:use). */}
              <Route
                path="recruitment/interviews"
                element={<RequirePermission permission="interviews:use"><InterviewsPage /></RequirePermission>}
              />
              <Route
                path="recruitment/interviews/:id"
                element={<RequirePermission permission="interviews:use"><InterviewDetailPage /></RequirePermission>}
              />
              <Route
                path="recruitment/jobs"
                element={<RequirePermission permission="recruitment:read"><JobsPage /></RequirePermission>}
              />
              <Route
                path="recruitment/jobs/new"
                element={<RequirePermission permission="recruitment:write"><JobCreatePage /></RequirePermission>}
              />
              <Route
                path="recruitment/jobs/:id"
                element={<RequirePermission permission="recruitment:read"><JobDetailPage /></RequirePermission>}
              />
              <Route
                path="recruitment/jobs/:id/edit"
                element={<RequirePermission permission="recruitment:write"><JobEditPage /></RequirePermission>}
              />

              {/* Recruitment: candidates (separate from employees). */}
              <Route
                path="recruitment/candidates"
                element={<RequirePermission permission="recruitment:read"><CandidatesPage /></RequirePermission>}
              />
              <Route
                path="recruitment/candidates/new"
                element={<RequirePermission permission="recruitment:write"><CandidateCreatePage /></RequirePermission>}
              />
              <Route
                path="recruitment/candidates/:id"
                element={<RequirePermission permission="recruitment:read"><CandidateDetailPage /></RequirePermission>}
              />
              <Route
                path="recruitment/candidates/:id/edit"
                element={<RequirePermission permission="recruitment:write"><CandidateEditPage /></RequirePermission>}
              />

              {/* Recruitment: applications and the pipeline board. */}
              <Route
                path="recruitment/applications"
                element={<RequirePermission permission="recruitment:read"><ApplicationsPage /></RequirePermission>}
              />
              <Route
                path="recruitment/applications/new"
                element={<RequirePermission permission="recruitment:write"><ApplicationCreatePage /></RequirePermission>}
              />
              <Route
                path="recruitment/applications/:id"
                element={<RequirePermission permission="recruitment:read"><ApplicationDetailPage /></RequirePermission>}
              />
              <Route
                path="recruitment/pipeline"
                element={<RequirePermission permission="recruitment:read"><PipelineBoardPage /></RequirePermission>}
              />

              {/* Candidate privacy: retention, audit trail, export, anonymization, purge preview. */}
              <Route
                path="recruitment/privacy"
                element={<RequirePermission permission="privacy:manage"><PrivacyPage /></RequirePermission>}
              />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}

export default App
