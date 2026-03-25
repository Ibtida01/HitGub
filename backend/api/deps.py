from fastapi import Header, HTTPException, Depends, Request


async def get_current_user(
    authorization: str = Header(..., description="Bearer <token> from /auth/login"),
    request: Request = None,
) -> dict:
    """
    Dependency that validates the Bearer token stored by /auth/login
    and returns the corresponding user as a plain dict.

    Usage in a route:
        @router.get("/...")
        async def my_route(current_user: dict = Depends(get_current_user)):
            uid = current_user["user_id"]
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
