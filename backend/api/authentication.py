import asyncpg
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, status

from database.connection import get_db
from ..model.user import Login, SignUp

router = APIRouter()

SECRET_KEY = "your-very-long-secret-key-at-least-32-chars" # move to env var in production
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 1


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

    password = signup.password.encode("utf-8")
    hashed_password = bcrypt.hashpw(password, bcrypt.gensalt()).decode()

    try:
        await db.execute(
            """
            INSERT INTO users (username, email, password_hash, full_name, bio, avatar_url)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            signup.username,
            signup.email,
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
            token_expires_at = $2,
            is_active = TRUE
        WHERE user_id = $3
        """,
        token,
        expire,
        user["user_id"],
    )

    return {"token": token}


@router.post("/logout")
async def logout(data: Login, db=Depends(get_db)):
    await _ensure_auth_columns(db)

    await db.execute(
        """
        UPDATE users
        SET is_active = FALSE,
            active_token = NULL,
            token_expires_at = NULL
        WHERE username = $1
        """,
        data.username,
    )

    return {"detail": "Logged out"}