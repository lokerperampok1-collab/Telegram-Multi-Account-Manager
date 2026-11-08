import json
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Form, File, UploadFile, Query
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
    twofa_password: Optional[str] = None

class Check2FARequest(BaseModel):
    password: Optional[str] = None

class CheckFilterRequest(BaseModel):
    account_ids: Optional[List[int]] = None
    search: Optional[str] = None
    id_filter: Optional[str] = None
    status: Optional[str] = None
    twofa: Optional[str] = None
    spambot: Optional[str] = None

async def _resolve_account_ids_from_filter(user_id: int, req: Optional[CheckFilterRequest]) -> Optional[List[int]]:
    if not req:
        return None
    if req.account_ids is not None:
        return req.account_ids
    if any([
        req.search and req.search.strip(),
        req.id_filter and req.id_filter.strip(),
        req.status and req.status != 'all',
        req.twofa and req.twofa != 'all',
        req.spambot and req.spambot != 'all'
    ]):
        filtered = await TelegramAccountModel.list_paginated(
            user_id=user_id,
            limit=0,
            search=req.search,
            status=req.status,
            telegram_id_filter=req.id_filter,
            twofa_filter=req.twofa,
            spambot_filter=req.spambot
        )
        return [a["id"] for a in filtered["items"]]
    return None

class LogoutBulkRequest(BaseModel):
    account_ids: List[int]
    delete_from_db: bool = False

class TerminateOtherBulkRequest(BaseModel):
    account_ids: List[int]

# ----------------- Account CRUD -----------------

@router.get("")
async def list_accounts(
    page: int = 1,
    limit: int = 50,
    search: Optional[str] = None,
    status: Optional[str] = None,
    telegram_id: Optional[str] = None,
    id_filter: Optional[str] = None,
    twofa: Optional[str] = None,
    spambot: Optional[str] = None,
    sort: Optional[str] = "id_desc",
    current_user: dict = Depends(get_current_user)
):
    """Retrieves paginated and filtered Telegram accounts owned by current user."""
    tg_filter = telegram_id or id_filter
    res = await TelegramAccountModel.list_paginated(
        user_id=current_user["id"],
        page=page,
        limit=limit,
        search=search,
        status=status,
        telegram_id_filter=tg_filter,
        twofa_filter=twofa,
        spambot_filter=spambot,
        sort=sort
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

@router.post("/connect-offline")
async def connect_offline_accounts(
    req: Optional[CheckFilterRequest] = None,
    current_user: dict = Depends(get_current_user)
):
    """Connects offline/disconnected accounts in bulk (all or filtered)."""
    target_ids = await _resolve_account_ids_from_filter(current_user["id"], req)
    res = await client_manager.connect_all_offline_accounts(current_user["id"], account_ids=target_ids)
    return res

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

@router.post("/refresh-and-clean")
async def refresh_and_clean_accounts(current_user: dict = Depends(get_current_user)):
    """Verifies all account sessions and updates their online/offline status without deleting any accounts."""
    result = await client_manager.refresh_and_clean_accounts(current_user["id"])
    return result

# ----------------- Active Devices / Authorizations -----------------

@router.get("/{account_id}/devices")
async def get_account_devices(account_id: int, current_user: dict = Depends(get_current_user)):
    """Retrieves all active devices/sessions connected to a Telegram account."""
    res = await client_manager.get_account_authorizations(account_id, current_user["id"])
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res.get("message", "Gagal mengambil daftar perangkat"))
    return res

@router.post("/{account_id}/devices/{auth_hash}/terminate")
async def terminate_account_device(account_id: int, auth_hash: int, current_user: dict = Depends(get_current_user)):
    """Terminates an active session/device connected to a Telegram account."""
    res = await client_manager.terminate_account_authorization(account_id, current_user["id"], auth_hash)
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res.get("message", "Gagal memutuskan sesi perangkat"))
    return res

@router.post("/{account_id}/devices/terminate-other")
async def terminate_other_devices(account_id: int, current_user: dict = Depends(get_current_user)):
    """Terminates all other authorizations/sessions of an account except current bot session."""
    res = await client_manager.terminate_all_other_authorizations(account_id, current_user["id"])
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res.get("message"))
    return res

@router.post("/devices/terminate-other-bulk")
async def terminate_other_devices_bulk(req: TerminateOtherBulkRequest, current_user: dict = Depends(get_current_user)):
    """Terminates all other authorizations across multiple accounts in bulk."""
    results = await client_manager.terminate_other_devices_bulk(current_user["id"], req.account_ids)
    return {"status": "success", "results": results}

@router.post("/{account_id}/logout")
async def logout_single_account(account_id: int, delete_from_db: bool = Query(False), current_user: dict = Depends(get_current_user)):
    """Logs out an account from Telegram permanently (revoking auth key)."""
    res = await client_manager.logout_account(account_id, current_user["id"], delete_from_db=delete_from_db)
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res.get("message"))
    return res

@router.post("/logout-bulk")
async def logout_bulk(req: LogoutBulkRequest, current_user: dict = Depends(get_current_user)):
    """Logs out multiple accounts from Telegram in bulk."""
    results = await client_manager.logout_bulk_accounts(current_user["id"], req.account_ids, delete_from_db=req.delete_from_db)
    return {"status": "success", "results": results}

@router.post("/clean-dead-sessions")
async def clean_dead_sessions_route(current_user: dict = Depends(get_current_user)):
    """Scans all accounts and automatically purges dead / revoked sessions from database and dashboard."""
    res = await client_manager.clean_dead_sessions(current_user["id"])
    return res

# ----------------- Health & SpamBot Check -----------------

@router.post("/{account_id}/check-health")
async def check_single_health(account_id: int, current_user: dict = Depends(get_current_user)):
    """Queries @SpamBot for a single account."""
    res = await client_manager.check_account_health(account_id, current_user["id"])
    return res

@router.post("/check-health-all")
async def check_all_health(
    req: Optional[CheckFilterRequest] = None,
    current_user: dict = Depends(get_current_user)
):
    """Queries @SpamBot for filtered or all user accounts sequentially."""
    target_ids = await _resolve_account_ids_from_filter(current_user["id"], req)
    results = await client_manager.check_all_accounts_health(current_user["id"], account_ids=target_ids)
    return {"status": "success", "results": results}

# ----------------- 2FA Check & Change (Two-Step Verification) -----------------

class Change2FARequest(BaseModel):
    account_ids: Optional[List[int]] = None
    new_password: str
    current_password: Optional[str] = None
    hint: Optional[str] = ""
    delay_seconds: int = Field(default=1, ge=0, le=60)

@router.post("/{account_id}/check-2fa")
async def check_account_2fa(
    account_id: int,
    req: Optional[Check2FARequest] = None,
    current_user: dict = Depends(get_current_user)
):
    """Checks Two-Step Verification (2FA / Cloud Password) status for a single account."""
    custom_pwd = req.password.strip() if (req and req.password) else None
    res = await client_manager.check_account_2fa(account_id, current_user["id"], custom_password=custom_pwd)
    return res

@router.post("/{account_id}/reset-2fa")
async def reset_account_2fa(account_id: int, current_user: dict = Depends(get_current_user)):
    """Explicitly requests a 2FA reset from Telegram for an account."""
    res = await client_manager.reset_account_2fa(account_id, current_user["id"])
    return res

@router.post("/check-2fa-all")
async def check_all_2fa(
    req: Optional[CheckFilterRequest] = None,
    current_user: dict = Depends(get_current_user)
):
    """Checks Two-Step Verification (2FA) for filtered or all user accounts sequentially."""
    target_ids = await _resolve_account_ids_from_filter(current_user["id"], req)
    results = await client_manager.check_all_accounts_2fa(current_user["id"], account_ids=target_ids)
    return {"status": "success", "results": results}

@router.post("/change-2fa")
async def change_2fa_bulk(req: Change2FARequest, current_user: dict = Depends(get_current_user)):
    """Sets or changes 2FA password across selected or all accounts."""
    new_pwd = (req.new_password or "").strip()
    if not new_pwd:
        raise HTTPException(status_code=400, detail="Sandi 2FA baru tidak boleh kosong")

    results = await client_manager.change_accounts_2fa_bulk(
        user_id=current_user["id"],
        new_password=new_pwd,
        current_password=req.current_password,
        hint=req.hint or "",
        account_ids=req.account_ids,
        delay_seconds=req.delay_seconds
    )
    return {"status": "success", "results": results}

@router.post("/{account_id}/change-2fa")
async def change_single_account_2fa(account_id: int, req: Change2FARequest, current_user: dict = Depends(get_current_user)):
    """Sets or changes 2FA password for a single account."""
    new_pwd = (req.new_password or "").strip()
    if not new_pwd:
        raise HTTPException(status_code=400, detail="Sandi 2FA baru tidak boleh kosong")

    res = await client_manager.change_account_2fa(
        account_id=account_id,
        user_id=current_user["id"],
        new_password=new_pwd,
        current_password=req.current_password,
        hint=req.hint or ""
    )
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res.get("message", "Gagal mengganti 2FA"))
    return res

# ----------------- Telegram Login OTP Retrieval -----------------

@router.get("/{account_id}/otp")
async def get_account_otp(account_id: int, current_user: dict = Depends(get_current_user)):
    """Retrieves the latest login OTP code and notifications from Telegram (777000)."""
    res = await client_manager.get_account_otp(account_id, current_user["id"])
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res.get("message"))
    return res

# ----------------- Export & Import Sessions -----------------

class ExportSessionsRequest(BaseModel):
    account_ids: Optional[List[int]] = None

def _parse_ids_query(ids: Optional[str]) -> Optional[List[int]]:
    if not ids or not ids.strip():
        return None
    parsed = []
    for part in ids.split(","):
        part = part.strip()
        if part.isdigit():
            parsed.append(int(part))
    return parsed

@router.get("/export/json")
async def export_json(ids: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Exports all or selected accounts with decrypted StringSessions as downloadable JSON."""
    parsed_ids = _parse_ids_query(ids)
    data = await client_manager.export_sessions(current_user["id"], account_ids=parsed_ids)
    json_str = json.dumps(data, indent=2)
    return Response(
        content=json_str,
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=telegram_sessions_backup.json"}
    )

@router.post("/export/json")
async def export_json_post(req: Optional[ExportSessionsRequest] = None, current_user: dict = Depends(get_current_user)):
    """Exports all or selected accounts with decrypted StringSessions as downloadable JSON via POST."""
    target_ids = req.account_ids if req else None
    data = await client_manager.export_sessions(current_user["id"], account_ids=target_ids)
    json_str = json.dumps(data, indent=2)
    return Response(
        content=json_str,
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=telegram_sessions_backup.json"}
    )

@router.get("/export/txt")
async def export_txt(ids: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Exports raw StringSessions one per line as downloadable TXT."""
    parsed_ids = _parse_ids_query(ids)
    data = await client_manager.export_sessions(current_user["id"], account_ids=parsed_ids)
    txt_lines = [item["session_string"] for item in data if item.get("session_string")]
    txt_content = "\n".join(txt_lines)
    return Response(
        content=txt_content,
        media_type="text/plain",
        headers={"Content-Disposition": "attachment; filename=telegram_sessions_backup.txt"}
    )

@router.post("/export/txt")
async def export_txt_post(req: Optional[ExportSessionsRequest] = None, current_user: dict = Depends(get_current_user)):
    """Exports raw StringSessions of all or selected accounts one per line as downloadable TXT via POST."""
    target_ids = req.account_ids if req else None
    data = await client_manager.export_sessions(current_user["id"], account_ids=target_ids)
    txt_lines = [item["session_string"] for item in data if item.get("session_string")]
    txt_content = "\n".join(txt_lines)
    return Response(
        content=txt_content,
        media_type="text/plain",
        headers={"Content-Disposition": "attachment; filename=telegram_sessions_backup.txt"}
    )

@router.get("/export/zip")
async def export_zip(ids: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Exports all or selected accounts as a downloadable ZIP containing .session and .json files."""
    parsed_ids = _parse_ids_query(ids)
    zip_bytes = await client_manager.export_sessions_zip(current_user["id"], account_ids=parsed_ids)
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=telegram_sessions_archive.zip"}
    )

@router.post("/export/zip")
async def export_zip_post(req: Optional[ExportSessionsRequest] = None, current_user: dict = Depends(get_current_user)):
    """Exports all or selected accounts as a downloadable ZIP via POST."""
    target_ids = req.account_ids if req else None
    zip_bytes = await client_manager.export_sessions_zip(current_user["id"], account_ids=target_ids)
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=telegram_sessions_archive.zip"}
    )

@router.get("/export/nicegram")
async def export_nicegram(ids: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Exports all or selected accounts as a Nicegram-compatible ZIP archive."""
    parsed_ids = _parse_ids_query(ids)
    zip_bytes = await client_manager.export_sessions_nicegram_zip(current_user["id"], account_ids=parsed_ids)
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=nicegram_exported_accounts.zip"}
    )

@router.post("/export/nicegram")
async def export_nicegram_post(req: Optional[ExportSessionsRequest] = None, current_user: dict = Depends(get_current_user)):
    """Exports all or selected accounts as a Nicegram-compatible ZIP archive via POST."""
    target_ids = req.account_ids if req else None
    zip_bytes = await client_manager.export_sessions_nicegram_zip(current_user["id"], account_ids=target_ids)
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=nicegram_exported_accounts.zip"}
    )

@router.post("/import-sessions")
async def import_sessions(req: ImportSessionsRequest, current_user: dict = Depends(get_current_user)):
    """Imports one or more StringSessions directly into the dashboard."""
    if not req.sessions:
        raise HTTPException(status_code=400, detail="Tidak ada StringSession yang diberikan")
    twofa_pwd = req.twofa_password.strip() if req.twofa_password else None
    results = await client_manager.import_bulk_sessions(current_user["id"], req.sessions, twofa_password=twofa_pwd)
    return {"status": "success", "results": results}

@router.post("/upload-sessions")
async def upload_sessions(
    files: list[UploadFile] = File(...),
    twofa_password: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user)
):
    """Uploads one or multiple Telethon session files (.session, .zip, .txt, .json) and imports them."""
    if not files:
        raise HTTPException(status_code=400, detail="Tidak ada file yang diunggah")

    files_data = []
    for f in files:
        content = await f.read()
        if content:
            files_data.append((f.filename or "unknown.session", content))

    if not files_data:
        raise HTTPException(status_code=400, detail="File yang diunggah kosong")

    twofa_pwd = twofa_password.strip() if twofa_password else None
    res = await client_manager.import_uploaded_sessions(current_user["id"], files_data, twofa_password=twofa_pwd)
    return res

# ----------------- Mass Profile Manager -----------------

@router.post("/update-profile")
async def update_profile(
    first_name: Optional[str] = Form(None),
    last_name: Optional[str] = Form(None),
    about: Optional[str] = Form(None),
    name_mode: str = Form("fixed"),
    numbering_start: int = Form(1),
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
        name_mode=name_mode,
        numbering_start=numbering_start,
        photo_bytes=photo_bytes,
        photo_filename=photo_filename,
        account_ids=parsed_ids,
        delay_seconds=delay_seconds
    )
    return {"status": "success", "results": results}

@router.post("/{account_id}/update-profile")
async def update_single_profile(
    account_id: int,
    first_name: Optional[str] = Form(None),
    last_name: Optional[str] = Form(None),
    about: Optional[str] = Form(None),
    photo: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user)
):
    """Updates profile details and avatar for a single account directly."""
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
        name_mode="fixed",
        numbering_start=1,
        photo_bytes=photo_bytes,
        photo_filename=photo_filename,
        account_ids=[account_id],
        delay_seconds=0
    )
    if results and results[0].get("status") == "success":
        return {"status": "success", "message": results[0].get("message", "Profil berhasil diperbarui")}
    error_msg = results[0].get("message") if results else "Gagal memperbarui profil"
    raise HTTPException(status_code=400, detail=error_msg)

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

# ----------------- Send Group Messages (Chat Massal) -----------------

class SendGroupMessageRequest(BaseModel):
    account_ids: Optional[List[int]] = None
    group_link: str
    messages: List[str]
    distribution_mode: str = "random" # "random" or "round_robin"
    auto_join: bool = True
    delay_seconds: int = Field(default=5, ge=1, le=60)

@router.post("/send-group-message")
async def send_group_message(req: SendGroupMessageRequest, current_user: dict = Depends(get_current_user)):
    """Instructs active Telegram accounts to send distributed message variations to a group."""
    link = req.group_link.strip()
    if not link:
        raise HTTPException(status_code=400, detail="Tautan atau username grup tidak boleh kosong")
    if not req.messages or not [m for m in req.messages if m.strip()]:
        raise HTTPException(status_code=400, detail="Variasi pesan tidak boleh kosong")

    results = await client_manager.send_group_message_bulk(
        user_id=current_user["id"],
        group_link=link,
        messages=req.messages,
        distribution_mode=req.distribution_mode,
        auto_join=req.auto_join,
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
    delete_pms: bool = True
    max_dialogs: Optional[int] = None
    delay_chat: float = Field(default=0.0, ge=0.0, le=10.0)
    delay_account: int = Field(default=0, ge=0, le=60)

@router.post("/clean-dialogs")
async def clean_dialogs(req: CleanDialogsRequest, current_user: dict = Depends(get_current_user)):
    """Cleans all Telegram dialogs (groups, channels, bots, pms) instantly across selected or all accounts."""
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

# ----------------- Hapus Kontak Sinkron -----------------

class DeleteContactsApiRequest(BaseModel):
    account_ids: Optional[List[int]] = None
    delay_ms: int = Field(default=0, ge=0, le=10000)

@router.post("/delete-contacts")
async def delete_contacts(req: DeleteContactsApiRequest, current_user: dict = Depends(get_current_user)):
    """Deletes all synchronized cloud contacts and account contacts across accounts with zero/millisecond delay."""
    results = await client_manager.delete_contacts_bulk(
        user_id=current_user["id"],
        account_ids=req.account_ids,
        delay_ms=req.delay_ms
    )
    return {"status": "success", "results": results}

# ----------------- Cancel / Hentikan Proses -----------------

@router.post("/cancel-operation")
async def cancel_operation(current_user: dict = Depends(get_current_user)):
    """Requests cancellation of all currently running bulk operations."""
    result = client_manager.request_cancel_all()
    return result

@router.get("/running-operations")
async def running_operations(current_user: dict = Depends(get_current_user)):
    """Returns list of currently running bulk operations."""
    return client_manager.get_running_operations()

