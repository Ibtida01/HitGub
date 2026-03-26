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
        host=os.getenv("PGHOST", "127.0.0.1"),
        min_size=10,
        port=int(os.getenv("PGPORT", "5433"))
    )
    return pool



async def get_db(request:Request):
    async with request.app.state.db_pool.acquire() as conn:
        yield conn