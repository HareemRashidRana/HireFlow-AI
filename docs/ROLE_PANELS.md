# Role panels, navigation and sign-in landing

Each role has its own **panel**: its own home page and its own grouped menu. The menu only decides
what is *listed*. It never grants or removes access: the route guards in the app and the permission
checks on the server (which are unchanged) decide who may open or do anything.

## Where each role lands after signing in

| Role | Home | Panel title |
|---|---|---|
| Administrator | `/admin` | Admin Console |
| HR Manager | `/hr` | HR Workspace |
| Recruiter | `/recruiter` | Recruiting |
| Employee | `/employee` | My Portal |

If someone was sent to the login page while trying to open a particular page, they are taken back to
it **only if their role may open it**. Otherwise they land on their own home, never on an
"access denied" page (for example, an HR manager who first asked for `/admin` lands on `/hr`). Someone
who must change their password goes to that screen first.

## The menus

Items appear only if the person holds the permission for them. "My work" (own attendance, leave and
profile) appears only for people whose login is linked to an employee record.

**Administrator**
- *System overview*
- *Administration*: Users & accounts, Roles & permissions, Company settings, Data privacy
- *People*: Employees
- *Attendance & leave*: Today & month, Records & corrections, Leave approvals, Leave balances, Leave calendar
- *Recruitment*: Job postings, Candidates & resumes, Applications, Hiring pipeline, Interviews
- *Reports*: System reports
- *My work* (if linked)

**HR Manager**
- *HR dashboard*
- *People*: Employees
- *Attendance*: Today & month, Records & corrections
- *Leave*: Approvals, Balances, Leave calendar
- *Configuration*: Work schedule & holidays, Data privacy
- *Recruitment*: Job postings, Candidates & resumes, Hiring decisions (the pipeline, where an application is marked hired), Interviews
- *Reports*: HR reports, Recruitment analytics
- *My work* (if linked)

**Recruiter**
- *Recruitment dashboard*
- *Hiring*: Job postings, Candidates & resumes, Applications, Hiring pipeline, Interviews
- *Insights*: Recruitment analytics
- *My work* (if linked)

**Employee**
- Home, Attendance (check in/out, history), Leave (balances, apply, requests), My profile

Not every allowed page is a menu item: detail pages are reached from lists, and a recruiter can
still open the employee directory by its address (the API permission, which the job form's
hiring-manager picker relies on, is unchanged and is not shown in the recruiter menu).

## Permission matrix

The permissions below are what the app grants each role (✔ = allowed). The server enforces them on
every request; the front end uses the same table only to decide what to show.

| Permission | Admin | HR Manager | Recruiter | Employee |
|---|:-:|:-:|:-:|:-:|
| View employees (`employees:read`) | ✔ | ✔ | ✔ | own record only |
| Create / edit employees | ✔ | ✔ | | |
| Delete employees | ✔ | | | |
| Manage user accounts and roles | ✔ | | | |
| View / edit recruitment (jobs, candidates, applications) | ✔ | ✔ | ✔ | |
| Delete draft jobs | ✔ | | | |
| Delete a candidate | ✔ | ✔ | | |
| Assign applications | ✔ | ✔ | | |
| Mark an application hired / reopen it | ✔ | ✔ | | |
| Upload and review resumes | ✔ | ✔ | ✔ | |
| Delete resumes | ✔ | ✔ | | |
| Use Requirements Coverage | ✔ | ✔ | ✔ | |
| Schedule and manage interviews (feedback is written only by an assigned interviewer; HR and admins read submitted feedback) | ✔ | ✔ | ✔ | |
| Recruitment analytics | ✔ | ✔ | ✔ | |
| Attendance corrections, leave approvals and balances, work schedule | ✔ | ✔ | | |
| Data privacy tools (audit, export, anonymise, retention review) | ✔ | ✔ | | |
| Purge candidate data permanently (also needs `PRIVACY_PURGE_ENABLED`) | ✔ | | | |
| Own attendance, leave and profile | linked login | linked login | linked login | ✔ |

Extra rules that no role can bypass: nobody approves their own leave request, an administrator cannot
change the role of, or deactivate, their own account, and an Employee can only ever read their own
attendance, leave and profile.

## Top bar and sign-out

The top bar is on every screen size. The account menu in it shows who is signed in and offers *My
profile* (when linked), *Change password* and **Sign out**. On narrow screens the menu button opens
the same panel menu as a drawer. The menu list scrolls on its own, so a long menu can never push
Sign out out of reach (the cause of the earlier sign-out bug).

## For developers

- The menus are defined once in `frontend/src/components/layout/navigation.ts`.
- Landing rules are in `frontend/src/auth/permissions.ts` (`ROUTE_RULES`, `canOpenPath`,
  `landingPath`). A test reads `App.tsx` and fails if those rules ever disagree with the real route
  guards.
- A test also checks that every management page the Administrator or HR Manager may open is one
  click away in their menu.
