from fastapi import FastAPI, Request, Depends, APIRouter
from contextlib import asynccontextmanager
from database.connection import create_database_pool
from database.connection import get_db

from .api.authentication import router as authentication_router
from .api.collaboration import router as collaborators_router
from .api.collaboration import repo_router as repo_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.db_pool = await create_database_pool()
    yield
    await app.state.db_pool.close()


app = FastAPI(
    title="HitGub API",
    version="0.1.0",
    description="Backend API for HitGub — a GitHub clone project.",
    lifespan=lifespan,
)


app.include_router(authentication_router, prefix="/auth")
app.include_router(collaborators_router)   # /repos/{repo_id}/collaborators/...
app.include_router(repo_router)            # /repos/{repo_id}/my-role  etc.


@app.get("/")
def hello():
    return {"message": "HitGub API is running"}
