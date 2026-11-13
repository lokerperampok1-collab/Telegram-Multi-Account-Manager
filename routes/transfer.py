from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Form, File, UploadFile
from fastapi.responses import Response, FileResponse
from pydantic import BaseModel

from services.auth_service import get_current_user
from services.session_transfer import session_transfer_service

router = APIRouter()

NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
}


class SubmitCodeRequest(BaseModel):
    code: str


class Submit2FARequest(BaseModel):
    password: str


@router.post("/start")
async def start_transfer(
    source_type: str = Form(...),
    dashboard_account_id: Optional[int] = Form(None),
    string_session: Optional[str] = Form(None),
    auto_logout_old: bool = Form(True),
    save_to_dashboard: bool = Form(True),
    session_file: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user),
):
    """Starts an isolated session transfer job (creates new auth key & verifies before optional old logout)."""
    file_bytes = None
    if source_type == "file":
        if not session_file:
            raise HTTPException(status_code=400, detail="File .session wajib diunggah.")
        file_bytes = await session_file.read()
        if len(file_bytes) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Ukuran file .session maksimal 10MB.")

    try:
        job = await session_transfer_service.start_transfer(
            user_id=current_user["id"],
            source_type=source_type,
            dashboard_account_id=dashboard_account_id,
            string_session_data=string_session,
            file_bytes=file_bytes,
            auto_logout_old=auto_logout_old,
            save_to_dashboard=save_to_dashboard,
        )
        return {"status": "success", "job": job.to_public_dict()}
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal memulai transfer: {str(e)}")


@router.get("/status/{job_id}")
async def get_transfer_status(job_id: str, current_user: dict = Depends(get_current_user)):
    job = session_transfer_service.get_job(job_id, current_user["id"])
    if not job:
        raise HTTPException(status_code=404, detail="Job transfer tidak ditemukan.")
    return Response(
        content=json_dumps(job.to_public_dict()),
        media_type="application/json",
        headers=NO_CACHE_HEADERS,
    )


def json_dumps(data: dict) -> str:
    import json
    return json.dumps(data)


@router.post("/submit-code/{job_id}")
async def submit_code(job_id: str, req: SubmitCodeRequest, current_user: dict = Depends(get_current_user)):
    try:
        accepted = session_transfer_service.submit_manual_code(job_id, current_user["id"], req.code)
        if not accepted:
            raise HTTPException(status_code=400, detail="Job sedang tidak menunggu kode OTP.")
        return {"status": "success", "message": "Kode OTP diterima, melanjutkan proses login..."}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/submit-2fa/{job_id}")
async def submit_2fa(job_id: str, req: Submit2FARequest, current_user: dict = Depends(get_current_user)):
    try:
        accepted = session_transfer_service.submit_2fa_password(job_id, current_user["id"], req.password)
        if not accepted:
            raise HTTPException(status_code=400, detail="Job sedang tidak menunggu password 2FA.")
        return {"status": "success", "message": "Password 2FA diterima, memverifikasi..."}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/cancel/{job_id}")
async def cancel_transfer(job_id: str, current_user: dict = Depends(get_current_user)):
    try:
        job = await session_transfer_service.cancel_job(job_id, current_user["id"])
        return {"status": "success", "job": job.to_public_dict()}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/download/{job_id}")
async def download_transferred_session(job_id: str, current_user: dict = Depends(get_current_user)):
    job = session_transfer_service.get_job(job_id, current_user["id"])
    if not job or not job.output_ready or not job.output_file_path or not job.output_file_path.is_file():
        raise HTTPException(status_code=404, detail="File sesi baru belum tersedia atau sudah dihapus.")
    safe_name = f"new_auth_{job.account_id or job.job_id}.session"
    return FileResponse(
        path=str(job.output_file_path),
        filename=safe_name,
        media_type="application/octet-stream",
        headers=NO_CACHE_HEADERS,
    )


@router.get("/string/{job_id}")
async def get_transferred_string_session(job_id: str, current_user: dict = Depends(get_current_user)):
    job = session_transfer_service.get_job(job_id, current_user["id"])
    if not job or not job.output_ready or not job.new_string_session:
        raise HTTPException(status_code=404, detail="StringSession baru belum tersedia.")
    return Response(
        content=json_dumps({"status": "success", "string_session": job.new_string_session}),
        media_type="application/json",
        headers=NO_CACHE_HEADERS,
    )


@router.delete("/output/{job_id}")
async def delete_transferred_output(job_id: str, current_user: dict = Depends(get_current_user)):
    try:
        deleted = session_transfer_service.delete_output_file(job_id, current_user["id"])
        return {"status": "success", "deleted": deleted}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
