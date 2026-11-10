"""Refuse oversized resume uploads BEFORE the framework starts spooling the body to disk.

FastAPI parses multipart bodies before the endpoint runs, so the size check has to happen earlier.
For POSTs to /candidates/{id}/resumes the request must declare its length (HTTP guarantees a client
cannot send more than it declared), and a declared size beyond the limit gets 413 at once.
"""

import re

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import settings

_UPLOAD_PATH = re.compile(r"^/api/v1/candidates/[^/]+/resumes/?$")
_OVERHEAD = 64 * 1024  # multipart boundaries and form fields


class ResumeUploadLimit:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and scope["method"] == "POST"
            and _UPLOAD_PATH.match(scope["path"])
        ):
            declared = dict(scope["headers"]).get(b"content-length")
            if declared is None:
                response = JSONResponse(
                    {"detail": "The upload must declare its size."}, status_code=411
                )
                return await response(scope, receive, send)
            try:
                length = int(declared)
            except ValueError:
                length = -1
            if length < 0:
                response = JSONResponse({"detail": "Invalid Content-Length."}, status_code=400)
                return await response(scope, receive, send)
            if length > settings.RESUME_MAX_BYTES + _OVERHEAD:
                mb = settings.RESUME_MAX_BYTES // (1024 * 1024)
                response = JSONResponse(
                    {"detail": f"The file is larger than the {mb} MB limit."}, status_code=413
                )
                return await response(scope, receive, send)
        await self.app(scope, receive, send)
