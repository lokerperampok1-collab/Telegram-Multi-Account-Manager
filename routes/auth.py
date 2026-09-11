from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from database.models import UserModel
from services.auth_service import get_password_hash, verify_password, create_access_token, get_current_user

router = APIRouter()

class RegisterRequest(BaseModel):
    username: str
    password: str

class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict

@router.post("/register")
async def register(req: RegisterRequest):
    username = req.username.strip()
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters")
    if len(req.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")

    existing = await UserModel.get_by_username(username)
    if existing:
        raise HTTPException(status_code=400, detail="Username is already taken")

    hashed_pw = get_password_hash(req.password)
    user_id = await UserModel.create(username, hashed_pw)

    token = create_access_token(data={"sub": str(user_id), "username": username})
    return {
        "status": "success",
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user_id, "username": username}
    }

@router.post("/login")
async def login(req: LoginRequest):
    user = await UserModel.get_by_username(req.username.strip())
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = create_access_token(data={"sub": str(user["id"]), "username": user["username"]})
    return {
        "status": "success",
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user["id"], "username": user["username"]}
    }

@router.get("/me")
async def get_profile(current_user: dict = Depends(get_current_user)):
    return {
        "id": current_user["id"],
        "username": current_user["username"],
        "created_at": current_user.get("created_at")
    }
