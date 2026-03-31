import asyncpg
import bcrypt
import jwt
import os
import re
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, status

from database.connection import get_db
from .deps import get_current_user
from ..model.user import Login, SignUp

router = APIRouter()

SECRET_KEY = "your-very-long-secret-key-at-least-32-chars" # move to env var in production
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = int(os.getenv("TOKEN_EXPIRE_HOURS", "8"))
USERNAME_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


def _create_jwt(user_id: str) -> str:
    expire = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    payload = {
        "sub": str(user_id),
        "exp": expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _decode_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


async def _ensure_auth_columns(db) -> None:
    await db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS active_token TEXT")
    await db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP")


@router.post("/signup")
async def signup(signup: SignUp, db=Depends(get_db)):
    await _ensure_auth_columns(db)

    username = signup.username.strip()
    if not USERNAME_RE.match(username):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Username can contain only letters, numbers, underscore, and hyphen.",
        )

    email = signup.email.strip()

    password = signup.password.encode("utf-8")
    hashed_password = bcrypt.hashpw(password, bcrypt.gensalt()).decode()

    try:
        await db.execute(
            """
            INSERT INTO users (username, email, password_hash, full_name, bio, avatar_url)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            username,
            email,
            hashed_password,
            signup.full_name,
            signup.bio,
            signup.avatar_url,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username or email already exists",
        )
    except asyncpg.CheckViolationError as exc:
        constraint = getattr(exc, "constraint_name", "")
        if constraint == "username_format":
            detail = "Username can contain only letters, numbers, underscore, and hyphen."
        elif constraint == "email_format":
            detail = "Please enter a valid email address."
        else:
            detail = "Input validation failed."
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)

    return {"detail": "Signup successful"}


@router.post("/login")
async def login(data: Login, db=Depends(get_db)):
    await _ensure_auth_columns(db)

    user = await db.fetchrow(
        "SELECT user_id, password_hash FROM users WHERE username = $1",
        data.username,
    )

    if not user:
        raise HTTPException(status_code=400, detail="Invalid credentials")

    if not bcrypt.checkpw(data.password.encode("utf-8"), user["password_hash"].encode("utf-8")):
        raise HTTPException(status_code=400, detail="Invalid credentials")

    token = _create_jwt(user["user_id"])
    expire = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)

    await db.execute(
        """
        UPDATE users
        SET active_token = $1,
            token_expires_at = $2
        WHERE user_id = $3
        """,
        token,
        expire,
        user["user_id"],
    )

    return {"token": token}


@router.post("/logout")
async def logout(current_user: dict = Depends(get_current_user), db=Depends(get_db)):
    await _ensure_auth_columns(db)

    await db.execute(
        """
        UPDATE users
        SET active_token = NULL,
            token_expires_at = NULL
        WHERE user_id = $1
        """,
        current_user["user_id"],
    )

    return {"detail": "Logged out"}


@router.get("/me")
async def me(current_user: dict = Depends(get_current_user)):
    return current_user


@router.get("/users/search")
async def search_users(
    q: str = Query(default="", min_length=1),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    term = f"%{q.strip()}%"
    rows = await db.fetch(
        """
        SELECT user_id, username, email, full_name, avatar_url, created_at
        FROM users
        WHERE user_id <> $2
          AND (
              username ILIKE $1
              OR email ILIKE $1
              OR COALESCE(full_name, '') ILIKE $1
          )
        ORDER BY username ASC
        LIMIT 20
        """,
        term,
        current_user["user_id"],
    )
    return [dict(row) for row in rows]


@router.get("/users/me/collaborations/pending")
async def my_pending_collaborations(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    rows = await db.fetch(
        """
        SELECT
            rc.collaboration_id,
            rc.repository_id,
            r.name AS repository_name,
            rc.user_id,
            u.username,
            u.full_name,
            u.email,
            u.avatar_url,
            rc.role,
            rc.status,
            rc.invited_at,
            rc.accepted_at,
            inv.username AS invited_by_username
        FROM repository_collaborators rc
        JOIN repositories r ON r.repository_id = rc.repository_id
        JOIN users u ON u.user_id = rc.user_id
        LEFT JOIN users inv ON inv.user_id = rc.invited_by
        WHERE rc.user_id = $1
          AND rc.status = 'pending'
        ORDER BY rc.invited_at DESC
        """,
        current_user["user_id"],
    )
    return [dict(row) for row in rows]


@router.get("/users/me/notifications")
async def my_notifications(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    rows = await db.fetch(
        """
        SELECT
            n.notification_id AS id,
            n.type,
            n.message,
            n.is_read AS read,
            n.created_at,
            n.repository_id,
            r.name AS repository_name,
            n.actor_id,
            u.username AS actor_username
        FROM notifications n
        LEFT JOIN repositories r ON r.repository_id = n.repository_id
        LEFT JOIN users u ON u.user_id = n.actor_id
        WHERE n.user_id = $1
        ORDER BY n.created_at DESC
        LIMIT 100
        """,
        current_user["user_id"],
    )
    return [dict(row) for row in rows]


@router.post("/users/me/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: int,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    result = await db.execute(
        """
        UPDATE notifications
        SET is_read = TRUE
        WHERE notification_id = $1
          AND user_id = $2
        """,
        notification_id,
        current_user["user_id"],
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Notification not found")

    return {"detail": "Notification marked as read", "notification_id": notification_id}


@router.post("/users/me/notifications/read-all")
async def mark_all_notifications_read(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await db.execute(
        """
        UPDATE notifications
        SET is_read = TRUE
        WHERE user_id = $1
          AND is_read = FALSE
        """,
        current_user["user_id"],
    )
    return {"detail": "All notifications marked as read"}


@router.delete("/users/me/notifications/{notification_id}")
async def delete_notification(
    notification_id: int,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    result = await db.execute(
        """
        DELETE FROM notifications
        WHERE notification_id = $1
          AND user_id = $2
        """,
        notification_id,
        current_user["user_id"],
    )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Notification not found")

    return {"detail": "Notification cleared", "notification_id": notification_id}


@router.delete("/users/me/notifications")
async def clear_all_notifications(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    result = await db.execute(
        """
        DELETE FROM notifications
        WHERE user_id = $1
        """,
        current_user["user_id"],
    )
    deleted_count = int(result.split(" ")[-1]) if isinstance(result, str) else 0
    return {"detail": "All notifications cleared", "deleted": deleted_count}