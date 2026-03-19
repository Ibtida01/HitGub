import asyncpg
from fastapi import Request


async def create_database_pool():
    pool = await asyncpg.create_pool(
        user="myuser",
        password="mypassword",
        database="hitgub",
        host="localhost",
        min_size=10,
        port=5433
    )
    return pool



async def get_db(request:Request):
    async with request.app.state.db_pool.acquire() as conn:
        yield conn