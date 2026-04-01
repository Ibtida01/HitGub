import os

import asyncpg
from fastapi import Request

try:
    from dotenv import load_dotenv
    load_dotenv(override=True)
except ImportError:
    pass


async def create_database_pool():
    pool = await asyncpg.create_pool(
        user=os.getenv("PGUSER", "myuser"),
        password=os.getenv("PGPASSWORD", "mypassword"),
        database=os.getenv("PGDATABASE", "hitgub"),
        host=os.getenv("PGHOST", "postgres"),
        min_size=10,
        port=int(os.getenv("PGPORT", "5432"))
    )

    # Keep notification schema in sync for existing environments that were
    # initialized before notifications were introduced.
    async with pool.acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS branch_directories (
                directory_id BIGSERIAL PRIMARY KEY,
                repository_id INTEGER NOT NULL REFERENCES repositories (repository_id) ON DELETE CASCADE,
                branch_id INTEGER NOT NULL REFERENCES branches (branch_id) ON DELETE CASCADE,
                path VARCHAR(1024) NOT NULL,
                name VARCHAR(255) NOT NULL,
                created_by INTEGER NOT NULL REFERENCES users (user_id),
                last_touched_by INTEGER NOT NULL REFERENCES users (user_id),
                commit_id BIGINT REFERENCES branch_commits (commit_id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT unique_branch_directory_path UNIQUE (branch_id, path)
            )
            """
        )
        await conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_branch_directories_branch_path
            ON branch_directories (branch_id, path)
            """
        )

        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notifications (
                notification_id BIGSERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
                repository_id INTEGER REFERENCES repositories (repository_id) ON DELETE SET NULL,
                collaboration_id INTEGER REFERENCES repository_collaborators (collaboration_id) ON DELETE SET NULL,
                actor_id INTEGER REFERENCES users (user_id) ON DELETE SET NULL,
                type VARCHAR(50) NOT NULL,
                message TEXT NOT NULL,
                is_read BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        await conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_notifications_user_created
            ON notifications (user_id, created_at DESC)
            """
        )
        await conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
            ON notifications (user_id, is_read)
            """
        )

    return pool



async def get_db(request:Request):
    async with request.app.state.db_pool.acquire() as conn:
        yield conn