from fastapi import Request,status,APIRouter,Depends,HTTPException
from ..model.user import SignUp,Login
from database.connection import get_db
import bcrypt
import uuid

router = APIRouter()


@router.post("/signup")
async def signup(signup: SignUp,db = Depends(get_db)):
    password = signup.password.encode("utf-8")
    hashed_password = bcrypt.hashpw(password,bcrypt.gensalt()).decode()
    print(type, type(hashed_password))

    result = await db.execute("INSERT into users (username,email,password_hash,full_name,bio,avatar_url) VALUES ($1, $2, $3, $4, $5, $6)",
                              signup.username,signup.email,hashed_password,signup.full_name,signup.bio,signup.avatar_url)
    
    if result:
        return status.HTTP_200_OK
    else:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,detail="problem in SQL")
    


@router.post("/login")
async def login(data: Login, db = Depends(get_db)):
    user = await db.fetchrow(
        "SELECT user_id, password_hash FROM users WHERE username = $1",
        data.username
    )

    if not user:
        raise HTTPException(status_code=400, detail="Invalid credentials")

    if not bcrypt.checkpw(data.password.encode("utf-8"),user["password_hash"].encode("utf-8")):
        raise HTTPException(status_code=400, detail="Invalid credentials")

    token = str(uuid.uuid4())

    result = await db.execute("UPDATE users SET active_token = $1, token_expires_at = NOW() + INTERVAL '1 hour',is_active = TRUE WHERE user_id = $2",token,user["user_id"])

    if result:
        return {"token":token}
    else:
         raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,detail="problem in SQL")


@router.post("/logout")
async def logout(data: Login, db = Depends(get_db)):

    result = await db.execute("""UPDATE users SET is_active = FALSE, active_token = NULL, token_expires_at = NULL WHERE username = $1""", data.username)

    if result:
        return status.HTTP_200_OK
    
    else:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,detail="problem in SQL")