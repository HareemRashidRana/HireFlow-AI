import logging

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db

router = APIRouter(tags=["health"])
logger = logging.getLogger(__name__)


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict[str, str]:
    """Liveness plus a database check. Never leaks connection details."""
    try:
        db.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception:
        logger.exception("Database health check failed")
        db_status = "unreachable"

    return {
        "status": "ok" if db_status == "connected" else "degraded",
        "database": db_status,
        "version": settings.APP_VERSION,
    }
