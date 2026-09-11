import json
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Form, File, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from services.auth_service import get_current_user
from services.client_manager import client_manager
from database.models import TelegramAccountModel

router = APIRouter()

class JoinGroupRequest(BaseModel):
    account_ids: Optional[List[int]] = None
    group_link: str
    delay_seconds: int = Field(default=3, ge=1, le=60)

class ImportSessionsRequest(BaseModel):
    sessions: List[str]

# ----------------- Account CRUD -----------------

@router.get("")
async def list_accounts(
    page: int = 1,
    limit: int = 50,
    search: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Retrieves paginated and filtered Telegram accounts owned by current user."""
    res = await TelegramAccountModel.list_paginated(
        user_id=current_user["id"],
        page=page,
        limit=limit,
        search=search,
        status=status
    )
    return {
        "status": "success",
        "accounts": res["items"],
        "pagination": {
            "page": res["page"],
            "limit": res["limit"],
            "total": res["total"],
            "total_pages": res["total_pages"]
        }
    }

@router.get("/{account_id}")
async def get_account_detail(account_id: int, current_user: dict = Depends(get_current_user)):
    """Retrieves detail for a specific Telegram account."""
    account = await TelegramAccountModel.get_by_id(account_id, current_user["id"])
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    account.pop("session_string", None)
    return {"status": "success", "account": account}

@router.post("/{account_id}/connect")
async def connect_account(account_id: int, current_user: dict = Depends(get_current_user)):
    """Reconnects a saved Telegram account."""
    res = await client_manager.connect_account(account_id, current_user["id"])
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res.get("message"))
    return res

@router.post("/{account_id}/disconnect")
async def disconnect_account(account_id: int, current_user: dict = Depends(get_current_user)):
    """Disconnects an active Telegram client without deleting it."""
    res = await client_manager.disconnect_account(account_id, current_user["id"])
    return res

@router.delete("/{account_id}")
async def delete_account(account_id: int, current_user: dict = Depends(get_current_user)):
    """Removes a Telegram account permanently from dashboard and closes connection."""
    res = await client_manager.remove_account(account_id, current_user["id"])
    if res.get("status") == "error":
        raise HTTPException(status_code=404, detail=res.get("message"))
    return res

# ----------------- Health & SpamBot Check -----------------

@router.post("/{account_id}/check-health")
async def check_single_health(account_id: int, current_user: dict = Depends(get_current_user)):
    """Queries @SpamBot for a single account."""
    res = await client_manager.check_account_health(account_id, current_user["id"])
    return res

@router.post("/check-health-all")
async def check_all_health(current_user: dict = Depends(get_current_user)):
    """Queries @SpamBot for all user accounts sequentially."""
    results = await client_manager.check_all_accounts_health(current_user["id"])
    return {"status": "success", "results": results}

# ----------------- Export & Import Sessions -----------------

@router.get("/export/json")
async def export_json(current_user: dict = Depends(get_current_user)):
    """Exports all accounts with decrypted StringSessions as downloadable JSON."""
    data = await client_manager.export_sessions(current_user["id"])
    json_str = json.dumps(data, indent=2)
    return Response(
        content=json_str,
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=telegram_sessions_backup.json"}
    )

@router.get("/export/txt")
async def export_txt(current_user: dict = Depends(get_current_user)):
    """Exports raw StringSessions one per line as downloadable TXT."""
    data = await client_manager.export_sessions(current_user["id"])
    txt_lines = [item["session_string"] for item in data if item.get("session_string")]
    txt_content = "\n".join(txt_lines)
    return Response(
        content=txt_content,
        media_type="text/plain",
        headers={"Content-Disposition": "attachment; filename=telegram_sessions_backup.txt"}
    )

@router.post("/import-sessions")
async def import_sessions(req: ImportSessionsRequest, current_user: dict = Depends(get_current_user)):
    """Imports one or more StringSessions directly into the dashboard."""
    if not req.sessions:
        raise HTTPException(status_code=400, detail="Tidak ada StringSession yang diberikan")
    results = await client_manager.import_bulk_sessions(current_user["id"], req.sessions)
    return {"status": "success", "results": results}

# ----------------- Mass Profile Manager -----------------

@router.post("/update-profile")
async def update_profile(
    first_name: Optional[str] = Form(None),
    last_name: Optional[str] = Form(None),
    about: Optional[str] = Form(None),
    account_ids: Optional[str] = Form(None),
    delay_seconds: int = Form(3),
    photo: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user)
):
    """Updates profile details and avatar for selected or all accounts."""
    parsed_ids = None
    if account_ids and account_ids.strip():
        try:
            parsed_ids = [int(i.strip()) for i in account_ids.split(",") if i.strip()]
        except Exception:
            parsed_ids = None

    photo_bytes = None
    photo_filename = "avatar.jpg"
    if photo and photo.filename:
        photo_bytes = await photo.read()
        photo_filename = photo.filename

    results = await client_manager.update_profile_bulk(
        user_id=current_user["id"],
        first_name=first_name,
        last_name=last_name,
        about=about,
        photo_bytes=photo_bytes,
        photo_filename=photo_filename,
        account_ids=parsed_ids,
        delay_seconds=delay_seconds
    )
    return {"status": "success", "results": results}

# ----------------- Join Group -----------------

@router.post("/join-group")
async def join_group(req: JoinGroupRequest, current_user: dict = Depends(get_current_user)):
    """Instructs active Telegram accounts to join a public or private group/channel."""
    link = req.group_link.strip()
    if not link:
        raise HTTPException(status_code=400, detail="Tautan atau username grup tidak boleh kosong")

    results = await client_manager.join_group_bulk(
        user_id=current_user["id"],
        group_link=link,
        account_ids=req.account_ids,
        delay_seconds=req.delay_seconds
    )
    return {"status": "success", "results": results}

# ----------------- Account Cleaner / Bersihkan Chat -----------------

class CleanDialogsRequest(BaseModel):
    account_ids: Optional[List[int]] = None
    leave_groups: bool = True
    leave_channels: bool = True
    delete_bots: bool = True
    delete_pms: bool = False
    max_dialogs: int = Field(default=100, ge=1, le=500)
    delay_chat: float = Field(default=0.8, ge=0.1, le=10.0)
    delay_account: int = Field(default=2, ge=0, le=60)

@router.post("/clean-dialogs")
async def clean_dialogs(req: CleanDialogsRequest, current_user: dict = Depends(get_current_user)):
    """Cleans Telegram dialogs (groups, channels, bots, pms) across selected or all accounts."""
    if not any([req.leave_groups, req.leave_channels, req.delete_bots, req.delete_pms]):
        raise HTTPException(status_code=400, detail="Pilih minimal satu filter pembersihan (Grup, Channel, Bot, atau PM)")

    results = await client_manager.clean_dialogs_bulk(
        user_id=current_user["id"],
        leave_groups=req.leave_groups,
        leave_channels=req.leave_channels,
        delete_bots=req.delete_bots,
        delete_pms=req.delete_pms,
        account_ids=req.account_ids,
        max_dialogs=req.max_dialogs,
        delay_chat=req.delay_chat,
        delay_account=req.delay_account
    )
    return {"status": "success", "results": results}

