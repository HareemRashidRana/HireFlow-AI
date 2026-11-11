# HireFlow AI: frontend

The web interface of HireFlow AI: a React single-page app that talks to the FastAPI backend in `../backend`.

**Stack:** React 19, TypeScript, Vite, Tailwind CSS v4, React Router. Tests: Vitest and Testing Library. Lint: oxlint.

## Commands

Run these in this folder. You need Node.js 22.12 or newer.

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Start the dev server at http://localhost:5173 (proxies `/api` to the backend on port 8000) |
| `npm test` | Run the Vitest suite |
| `npm run lint` | Run oxlint |
| `npx tsc -b` | Type-check |
| `npm run build` | Type-check and create a production build in `dist/` |

## Structure

```
src/
  api/          typed API client (one place for fetch, errors, token refresh)
  auth/         session handling, roles and permissions, route guards
  components/   shared UI (layout, navigation, form controls)
  features/     one folder per module: auth, employees, recruitment (incl. resumes,
                screening, interviews), workforce (attendance and leave), privacy,
                dashboard, panels (role home pages)
  hooks/ lib/ types/   shared hooks, helpers and types
```

The backend must be running for the app to work. See the [root README](../README.md) and
[docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md) for the full setup.
