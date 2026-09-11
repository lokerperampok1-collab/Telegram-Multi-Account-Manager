import asyncio
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from services.auth_service import get_current_user
from services.client_manager import client_manager

router = APIRouter()

class PhoneLoginRequest(BaseModel):
    phone: str

class VerifyCodeRequest(BaseModel):
    token: str
    code: str

class Verify2FARequest(BaseModel):
    token: str
    password: str

class BulkLoginRequest(BaseModel):
    phones: List[str]

# ----------------- Phone Login Endpoints -----------------

@router.post("/login/phone")
async def start_phone_login(req: PhoneLoginRequest, current_user: dict = Depends(get_current_user)):
    """Initiates login with phone number, sends verification code via Telegram."""
    phone = req.phone.strip().replace(" ", "").replace("-", "")
    if not phone.startswith("+"):
        phone = f"+{phone}"

    res = await client_manager.start_phone_login(phone, current_user["id"])
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res.get("message"))
    return res

@router.post("/login/code")
async def verify_code(req: VerifyCodeRequest, current_user: dict = Depends(get_current_user)):
    """Verifies received OTP code."""
    res = await client_manager.verify_code(req.token, req.code.strip())
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res.get("message"))
    return res

@router.post("/login/2fa")
async def verify_2fa(req: Verify2FARequest, current_user: dict = Depends(get_current_user)):
    """Verifies Two-Step Verification (2FA) cloud password."""
    res = await client_manager.verify_2fa(req.token, req.password)
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res.get("message"))
    return res

# ----------------- QR Code Login Endpoints -----------------

@router.post("/login/qr/start")
async def start_qr_login(current_user: dict = Depends(get_current_user)):
    """Generates Telegram QR login token and returns QR base64 image."""
    res = await client_manager.start_qr_login(current_user["id"])
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res.get("message"))
    return res

@router.get("/login/qr/status/{token}")
async def get_qr_status(token: str, current_user: dict = Depends(get_current_user)):
    """Checks the status of QR login (pending, success, 2fa_needed, expired, failed)."""
    res = await client_manager.get_qr_status(token)
    return res

@router.post("/login/qr/refresh/{token}")
async def refresh_qr(token: str, current_user: dict = Depends(get_current_user)):
    """Recreates expired QR login token."""
    res = await client_manager.refresh_qr(token)
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res.get("message"))
    return res

# ----------------- Bulk Login Endpoint -----------------

@router.post("/login/bulk")
async def start_bulk_login(req: BulkLoginRequest, current_user: dict = Depends(get_current_user)):
    """Initiates login for multiple phone numbers sequentially."""
    results = []
    cleaned_phones = []
    
    for p in req.phones:
        phone = p.strip().replace(" ", "").replace("-", "")
        if phone:
            if not phone.startswith("+"):
                phone = f"+{phone}"
            cleaned_phones.append(phone)

    for phone in cleaned_phones:
        res = await client_manager.start_phone_login(phone, current_user["id"])
        results.append({
            "phone": phone,
            "status": res.get("status"),
            "token": res.get("token"),
            "message": res.get("message")
        })
        # Graceful delay to prevent fast spamming
        await asyncio.sleep(1.5)

    return {"status": "success", "results": results}
