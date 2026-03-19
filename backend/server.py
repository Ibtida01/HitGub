from fastapi import FastAPI,Request,Depends,APIRouter
from contextlib import asynccontextmanager
from database.connection import create_database_pool
from database.connection import get_db

from .api.authentication import router as authentication_router

@asynccontextmanager
async def lifespan(app:FastAPI):
    app.state.db_pool = await create_database_pool()

    yield

    await app.state.db_pool.close()




app = FastAPI(lifespan=lifespan)


app.include_router(authentication_router,prefix="/auth")



@app.get("/")
def hello():
    return "Hello"