from fastapi import APIRouter

from app.api.v1 import (
    analytics,
    applications,
    attendance,
    auth,
    candidates,
    employees,
    health,
    interviews,
    jobs,
    leave,
    privacy,
    resumes,
    screening,
    users,
    work_config,
    workforce_analytics,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(employees.router)
api_router.include_router(jobs.router)
api_router.include_router(candidates.router)
api_router.include_router(applications.router)
api_router.include_router(privacy.router)
api_router.include_router(resumes.router)
api_router.include_router(screening.router)
api_router.include_router(interviews.router)
api_router.include_router(analytics.router)
api_router.include_router(workforce_analytics.router)
api_router.include_router(attendance.router)
api_router.include_router(leave.router)
api_router.include_router(work_config.router)
