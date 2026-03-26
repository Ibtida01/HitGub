from fastapi import Header, HTTPException, Request
from typing import Optional


async def get_current_user(
    request: Request,
    authorization: Optional[str] = Header(
        default=None,
        description="Bearer <token> from /auth/login",
    ),
) -> dict:
    """
    Dependency that validates the Bearer token stored by /auth/login
    and returns the corresponding user as a plain dict.

    Usage in a route:
        @router.get("/...")
        async def my_route(current_user: dict = Depends(get_current_user)):
            uid = current_user["user_id"]

    Why authorization is Optional[str] with default=None
    -----------------------------------------------------
    FastAPI validates Header(...) fields before the function body runs.
    A *required* Header causes a 422 Unprocessable Entity when absent.
    We want a 401 instead, so we declare the header as optional and
    perform the "missing / malformed" check ourselves below.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Authorization header must be: Bearer <token>",
        )

    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Token is empty")

    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT user_id, username, email, full_name, avatar_url
            FROM   users
            WHERE  active_token     = $1
            AND    is_active        = TRUE
            AND    token_expires_at > NOW()
            """,
            token,
        )

    if row is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token. Please log in again.")

    return dict(row)