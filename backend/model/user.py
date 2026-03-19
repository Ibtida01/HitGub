from pydantic import BaseModel
from typing import Optional

class SignUp(BaseModel):
    username: str
    email: str
    password: str
    full_name: Optional[str] = None
    bio: Optional[str] = None
    avatar_url: Optional[str] = None



class Login(BaseModel):
    username: str
    password: str