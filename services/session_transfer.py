import os
import re
import sqlite3
import asyncio
import logging
import uuid
from enum import Enum
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any

from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.errors import (
    FloodWaitError,
    PhoneCodeInvalidError,
    PhoneCodeExpiredError,
    SessionPasswordNeededError,
    PasswordHashInvalidError,
    PhoneNumberInvalidError,
    AuthKeyDuplicatedError,
    AuthKeyUnregisteredError,
)

from config import settings
from database.models import TelegramAccountModel
from services.encryption import encryption_service
from services.session_importer import hex_auth_key_to_string_session

logger = logging.getLogger(__name__)

TRANSFER_WORK_DIR = Path("sessions") / "transfer_work"
TRANSFER_OUTPUT_DIR = Path("sessions") / "transfer_output"


class TransferStatus(str, Enum):
    IDLE = "idle"
    VALIDATING_OLD = "validating_old"
    REQUESTING_CODE = "requesting_code"
    WAITING_CODE = "waiting_code"
    WAITING_2FA = "waiting_2fa"
    VERIFYING_OUTPUT = "verifying_output"
    LOGGING_OUT_OLD = "logging_out_old"
    COMPLETED = "completed"
    PARTIAL_LOGOUT_UNCERTAIN = "partial_logout_uncertain"
    FAILED = "failed"
    CANCELLED = "cancelled"


def _mask_phone(phone: Optional[str]) -> str:
    if not phone:
        return "-"
    clean = str(phone).strip()
    if len(clean) <= 5:
        return clean
    return f"{clean[:4]}****{clean[-3:]}"


def _validate_sqlite_session_file(file_path: Path) -> None:
    if not file_path.is_file() or file_path.stat().st_size == 0:
        raise ValueError("File .session tidak ditemukan atau kosong.")
    with open(file_path, "rb") as f:
        header = f.read(16)
    if header != b"SQLite format 3\x00":
        raise ValueError("File bukan format SQLite .session Telethon yang valid.")
    try:
        conn = sqlite3.connect(str(file_path))
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
        row = cur.fetchone()
        if not row:
            conn.close()
            raise ValueError("Tabel 'sessions' tidak ditemukan dalam file .session.")
        cur.execute("SELECT dc_id, auth_key FROM sessions LIMIT 1")
        sess_row = cur.fetchone()
        conn.close()
        if not sess_row or not sess_row[1]:
            raise ValueError("Auth key kosong di dalam file .session.")
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"File .session rusak atau tidak dapat dibaca: {str(e)}")


def _normalize_string_session(raw_str: str) -> str:
    s = (raw_str or "").strip().strip('"\' ,;{}[]')
    if not s:
        raise ValueError("StringSession tidak boleh kosong.")
    if ":" in s and not s.startswith("1"):
        parts = s.split(":")
        if len(parts) == 2:
            p1, p2 = parts[0].strip(), parts[1].strip()
            if len(p1) == 512 and p2.isdigit():
                conv = hex_auth_key_to_string_session(p1, int(p2))
                if conv:
                    return conv
            elif len(p2) == 512 and p1.isdigit():
                conv = hex_auth_key_to_string_session(p2, int(p1))
                if conv:
                    return conv
    if len(s) == 512 and re.fullmatch(r"[0-9a-fA-F]{512}", s):
        conv = hex_auth_key_to_string_session(s, 5)
        if conv:
            return conv
    try:
        loaded = StringSession(s)
        if not loaded.auth_key:
            raise ValueError("StringSession tidak memiliki auth key.")
    except Exception as e:
        raise ValueError(f"Format StringSession tidak valid: {str(e)}")
    return s


class TransferJob:
    def __init__(self, job_id: str, user_id: int, auto_logout_old: bool, save_to_dashboard: bool):
        self.job_id = job_id
        self.user_id = user_id
        self.status = TransferStatus.VALIDATING_OLD
        self.progress_pct = 5
        self.message = "Mempersiapkan proses transfer sesi..."
        self.account_id: Optional[int] = None
        self.dashboard_account_id: Optional[int] = None
        self.phone_masked: Optional[str] = None
        self.username: Optional[str] = None
        self.display_name: Optional[str] = None
        self.auto_logout_old = auto_logout_old
        self.save_to_dashboard = save_to_dashboard
        self.old_session_logged_out = False
        self.output_ready = False
        self.output_filename: Optional[str] = None
        self.output_file_path: Optional[Path] = None
        self.new_string_session: Optional[str] = None
        self.dashboard_updated = False
        self.code_delivery_hint: Optional[str] = None
        self.error_detail: Optional[str] = None
        self.created_at = datetime.now(timezone.utc).isoformat()
        self.updated_at = datetime.now(timezone.utc).isoformat()

        self.task: Optional[asyncio.Task] = None
        self.code_future: Optional[asyncio.Future] = None
        self.password_future: Optional[asyncio.Future] = None
        self.old_client: Optional[TelegramClient] = None
        self.new_client: Optional[TelegramClient] = None
        self.verify_client: Optional[TelegramClient] = None
        self.work_file: Optional[Path] = None
        self.cancelled = False

    def update(self, **kwargs) -> None:
        for k, v in kwargs.items():
            if hasattr(self, k):
                setattr(self, k, v)
        self.updated_at = datetime.now(timezone.utc).isoformat()

    def to_public_dict(self) -> Dict[str, Any]:
        return {
            "job_id": self.job_id,
            "status": self.status.value,
            "progress_pct": self.progress_pct,
            "message": self.message,
            "account_id": self.account_id,
            "dashboard_account_id": self.dashboard_account_id,
            "phone_masked": self.phone_masked,
            "username": self.username,
            "display_name": self.display_name,
            "auto_logout_old": self.auto_logout_old,
            "save_to_dashboard": self.save_to_dashboard,
            "old_session_logged_out": self.old_session_logged_out,
            "output_ready": self.output_ready,
            "output_filename": self.output_filename,
            "dashboard_updated": self.dashboard_updated,
            "code_delivery_hint": self.code_delivery_hint,
            "error_detail": self.error_detail,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class SessionTransferService:
    """TelePRO-inspired isolated session transfer service (new auth key + strict verification + isolated old logout)."""

    def __init__(self):
        self._jobs: Dict[str, TransferJob] = {}
        self._user_locks: Dict[int, asyncio.Lock] = {}
        TRANSFER_WORK_DIR.mkdir(parents=True, exist_ok=True)
        TRANSFER_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    def _get_user_lock(self, user_id: int) -> asyncio.Lock:
        if user_id not in self._user_locks:
            self._user_locks[user_id] = asyncio.Lock()
        return self._user_locks[user_id]

    def get_job(self, job_id: str, user_id: int) -> Optional[TransferJob]:
        job = self._jobs.get(job_id)
        if not job or job.user_id != user_id:
            return None
        return job

    def get_latest_user_job(self, user_id: int) -> Optional[TransferJob]:
        user_jobs = [j for j in self._jobs.values() if j.user_id == user_id]
        if not user_jobs:
            return None
        return sorted(user_jobs, key=lambda j: j.created_at, reverse=True)[0]

    async def start_transfer(
        self,
        user_id: int,
        source_type: str,
        dashboard_account_id: Optional[int] = None,
        string_session_data: Optional[str] = None,
        file_bytes: Optional[bytes] = None,
        auto_logout_old: bool = True,
        save_to_dashboard: bool = True,
    ) -> TransferJob:
        lock = self._get_user_lock(user_id)
        if lock.locked():
            raise RuntimeError("Proses transfer sesi lain sedang berjalan untuk akun Anda. Tunggu hingga selesai atau batalkan.")

        if not settings.API_ID or not settings.API_HASH:
            raise ValueError("API_ID dan API_HASH belum dikonfigurasi pada server.")

        job_id = uuid.uuid4().hex[:12]
        job = TransferJob(
            job_id=job_id,
            user_id=user_id,
            auto_logout_old=auto_logout_old,
            save_to_dashboard=save_to_dashboard,
        )
        job.dashboard_account_id = dashboard_account_id
        loop = asyncio.get_running_loop()
        job.code_future = loop.create_future()
        job.password_future = loop.create_future()

        work_file_path: Optional[Path] = None
        if source_type == "file":
            if not file_bytes:
                raise ValueError("File .session wajib diunggah.")
            work_file_path = TRANSFER_WORK_DIR / f"work_{job_id}.session"
            work_file_path.write_bytes(file_bytes)
            _validate_sqlite_session_file(work_file_path)
            job.work_file = work_file_path

        self._jobs[job_id] = job

        async def _runner():
            async with lock:
                try:
                    await self._execute_transfer(
                        job=job,
                        source_type=source_type,
                        dashboard_account_id=dashboard_account_id,
                        string_session_data=string_session_data,
                    )
                except asyncio.CancelledError:
                    job.update(
                        status=TransferStatus.CANCELLED,
                        progress_pct=0,
                        message="Proses transfer dibatalkan oleh pengguna.",
                    )
                except Exception as e:
                    logger.error(f"[Transfer {job_id}] Error: {e}", exc_info=True)
                    self._handle_error(job, e)
                finally:
                    await self._cleanup_job_clients(job)

        job.task = asyncio.create_task(_runner())
        return job

    async def _execute_transfer(
        self,
        job: TransferJob,
        source_type: str,
        dashboard_account_id: Optional[int],
        string_session_data: Optional[str],
    ) -> None:
        api_id = settings.API_ID
        api_hash = settings.API_HASH
        saved_twofa: Optional[str] = None

        job.update(status=TransferStatus.VALIDATING_OLD, progress_pct=15, message="Menghubungkan & memvalidasi sesi lama...")

        if source_type == "dashboard":
            if not dashboard_account_id:
                raise ValueError("Pilih akun dari dashboard terlebih dahulu.")
            acc = await TelegramAccountModel.get_by_id(dashboard_account_id, job.user_id)
            if not acc:
                raise ValueError("Akun tidak ditemukan di dashboard Anda.")
            saved_twofa = acc.get("twofa_password")
            decrypted = encryption_service.decrypt(acc["session_string"])
            job.old_client = TelegramClient(StringSession(decrypted), api_id, api_hash)
        elif source_type == "file":
            if not job.work_file or not job.work_file.is_file():
                raise ValueError("File sesi kerja tidak ditemukan.")
            job.old_client = TelegramClient(str(job.work_file.with_suffix("")), api_id, api_hash)
        elif source_type == "string":
            normalized = _normalize_string_session(string_session_data or "")
            job.old_client = TelegramClient(StringSession(normalized), api_id, api_hash)
        else:
            raise ValueError(f"Sumber sesi tidak dikenal: {source_type}")

        await job.old_client.connect()
        if not await job.old_client.is_user_authorized():
            raise ValueError("Sesi lama tidak terotorisasi atau sudah dicabut/mati di server Telegram.")

        old_me = await job.old_client.get_me()
        if not old_me or not old_me.phone:
            raise ValueError("Gagal mengambil nomor HP atau profil dari sesi lama.")

        account_tg_id = old_me.id
        phone_raw = old_me.phone
        username = old_me.username or ""
        display_name = f"{old_me.first_name or ''} {old_me.last_name or ''}".strip() or username or f"+{phone_raw}"

        job.update(
            account_id=account_tg_id,
            phone_masked=_mask_phone(phone_raw),
            username=username,
            display_name=display_name,
            progress_pct=30,
            message=f"Sesi lama valid ({display_name} / {job.phone_masked}).",
        )

        # Record checkpoint before requesting login code
        checkpoint_time = datetime.now(timezone.utc)
        last_msg_id = 0
        try:
            async for msg in job.old_client.iter_messages(777000, limit=1):
                last_msg_id = msg.id
        except Exception:
            pass

        # Create brand-new client with fresh output session file
        job.update(
            status=TransferStatus.REQUESTING_CODE,
            progress_pct=40,
            message="Membuat kunci otorisasi (Auth Key) baru & meminta kode login ke Telegram...",
        )

        output_path = TRANSFER_OUTPUT_DIR / f"telepro_{job.job_id}.session"
        job.output_file_path = output_path
        job.output_filename = output_path.name

        job.new_client = TelegramClient(str(output_path.with_suffix("")), api_id, api_hash)
        await job.new_client.connect()

        send_code_req = await job.new_client.send_code_request(phone_raw)
        phone_code_hash = send_code_req.phone_code_hash
        delivery_type = type(send_code_req.type).__name__ if send_code_req.type else "Telegram App"

        job.update(
            status=TransferStatus.WAITING_CODE,
            progress_pct=50,
            code_delivery_hint=f"Kode dikirim via {delivery_type}. Memantau chat 777000 secara otomatis...",
            message="Menunggu kode login (otomatis dipantau dari pesan 777000 atau input manual di bawah)...",
        )

        code = await self._wait_for_login_code(job, checkpoint_time, last_msg_id)

        job.update(progress_pct=65, message="Melakukan Sign-In ke sesi baru dengan kode OTP...")

        sign_in_success = False
        try:
            await job.new_client.sign_in(phone=phone_raw, code=code, phone_code_hash=phone_code_hash)
            sign_in_success = True
        except SessionPasswordNeededError:
            # Try saved 2FA password automatically if available
            if saved_twofa:
                job.update(progress_pct=70, message="Akun memakai 2FA. Mencoba sandi 2FA yang tersimpan di dashboard...")
                try:
                    await job.new_client.sign_in(password=saved_twofa)
                    sign_in_success = True
                except PasswordHashInvalidError:
                    sign_in_success = False

            if not sign_in_success:
                job.update(
                    status=TransferStatus.WAITING_2FA,
                    progress_pct=72,
                    message="Akun dilindungi 2FA. Silakan masukkan kata sandi 2FA Anda.",
                )
                job.password_future = asyncio.get_running_loop().create_future()
                two_fa_pwd = await job.password_future
                job.update(progress_pct=76, message="Memverifikasi kata sandi 2FA pada sesi baru...")
                try:
                    await job.new_client.sign_in(password=two_fa_pwd)
                    sign_in_success = True
                finally:
                    del two_fa_pwd

        if not sign_in_success:
            raise ValueError("Proses login pada sesi baru gagal diselesaikan.")

        # STRICT VERIFICATION BEFORE TOUCHING OLD SESSION
        job.update(
            status=TransferStatus.VERIFYING_OUTPUT,
            progress_pct=80,
            message="Login berhasil! Memverifikasi keaslian & kemandirian Auth Key sesi baru...",
        )

        old_auth_key = getattr(job.old_client.session, "auth_key", None)
        old_auth_key_bytes = old_auth_key.key if old_auth_key else None

        await job.new_client.disconnect()
        job.new_client = None
        await asyncio.sleep(0.5)

        if not output_path.is_file():
            raise IOError("File sesi baru tidak ditemukan di penyimpanan output.")

        job.verify_client = TelegramClient(str(output_path.with_suffix("")), api_id, api_hash)
        await job.verify_client.connect()

        if not await job.verify_client.is_user_authorized():
            raise ValueError("Verifikasi gagal: File sesi baru tidak terotorisasi saat dibuka ulang.")

        new_me = await job.verify_client.get_me()
        if not new_me or new_me.id != account_tg_id:
            raise ValueError(
                f"Verifikasi gagal: ID akun sesi baru ({getattr(new_me, 'id', None)}) tidak cocok dengan sesi lama ({account_tg_id})."
            )

        new_auth_key = getattr(job.verify_client.session, "auth_key", None)
        new_auth_key_bytes = new_auth_key.key if new_auth_key else None

        if old_auth_key_bytes and new_auth_key_bytes and (old_auth_key_bytes == new_auth_key_bytes):
            raise ValueError("Verifikasi gagal: Auth key baru identik dengan sesi lama (bukan sesi independen).")

        new_string_session = StringSession.save(job.verify_client.session)
        job.update(
            new_string_session=new_string_session,
            output_ready=True,
            progress_pct=88,
            message="Sesi baru terverifikasi sah dengan Auth Key baru yang independen!",
        )

        # ISOLATED LOGOUT OF OLD SESSION
        if job.auto_logout_old:
            job.update(
                status=TransferStatus.LOGGING_OUT_OLD,
                progress_pct=92,
                message="Melakukan logout HANYA pada sesi lama (perangkat lain tidak disentuh)...",
            )
            logout_confirmed = False
            try:
                await asyncio.wait_for(job.old_client.log_out(), timeout=20.0)
                logout_confirmed = True
            except Exception as logout_err:
                logger.warning(f"[Transfer {job.job_id}] Logout old session uncertain: {logout_err}")
                await self._save_to_dashboard_if_needed(job, new_me, new_string_session, source_type)
                job.update(
                    status=TransferStatus.PARTIAL_LOGOUT_UNCERTAIN,
                    progress_pct=96,
                    old_session_logged_out=False,
                    message="Sesi baru berhasil dibuat & diverifikasi, namun konfirmasi logout sesi lama tidak pasti (timeout/jaringan). Sesi baru tetap aman siap digunakan.",
                    error_detail=str(logout_err),
                )
                return

            if logout_confirmed:
                job.update(old_session_logged_out=True)
                if not await job.verify_client.is_user_authorized():
                    job.update(
                        status=TransferStatus.FAILED,
                        message="Peringatan: Sesi baru ikut terpengaruh setelah logout sesi lama.",
                    )
                    return

        await self._save_to_dashboard_if_needed(job, new_me, new_string_session, source_type)

        job.update(
            status=TransferStatus.COMPLETED,
            progress_pct=100,
            message=(
                "Transfer Sesi Selesai! Auth Key baru aktif, sesi lama telah di-logout permanen"
                + (" & dashboard diperbarui." if job.dashboard_updated else ".")
                if job.auto_logout_old
                else "Transfer Sesi Selesai! Sesi baru dengan Auth Key baru siap digunakan (sesi lama tetap dipertahankan)."
            ),
        )

    async def _save_to_dashboard_if_needed(
        self,
        job: TransferJob,
        me,
        new_string_session: str,
        source_type: str,
    ) -> None:
        if not job.save_to_dashboard and source_type != "dashboard":
            return
        if not job.save_to_dashboard:
            return
        try:
            from services.client_manager import client_manager

            encrypted = encryption_service.encrypt(new_string_session)
            display_name = f"{me.first_name or ''} {me.last_name or ''}".strip()
            phone = me.phone
            if phone and not str(phone).startswith("+"):
                phone = f"+{phone}"

            acc_id, _ = await TelegramAccountModel.upsert(
                user_id=job.user_id,
                session_string=encrypted,
                phone_number=phone,
                display_name=display_name,
                username=me.username,
                telegram_id=me.id,
                is_active=True,
            )
            # Disconnect old active client in client_manager if cached
            old_cached = client_manager._active_clients.pop(acc_id, None)
            if old_cached:
                try:
                    if old_cached.is_connected():
                        await old_cached.disconnect()
                except Exception:
                    pass
            job.update(dashboard_updated=True, dashboard_account_id=acc_id)
        except Exception as e:
            logger.warning(f"[Transfer {job.job_id}] Failed updating dashboard DB: {e}")

    async def _wait_for_login_code(
        self,
        job: TransferJob,
        checkpoint_time: datetime,
        last_msg_id: int,
        timeout_seconds: int = 180,
    ) -> str:
        start_time = asyncio.get_running_loop().time()
        while True:
            if job.cancelled:
                raise asyncio.CancelledError()

            if job.code_future and job.code_future.done():
                manual_code = job.code_future.result()
                if manual_code:
                    return manual_code.strip()

            if job.old_client and job.old_client.is_connected():
                try:
                    async for msg in job.old_client.iter_messages(777000, limit=3):
                        msg_date = msg.date
                        if msg_date.tzinfo is None:
                            msg_date = msg_date.replace(tzinfo=timezone.utc)
                        is_newer = (msg.id > last_msg_id) or (msg_date >= checkpoint_time)
                        if is_newer and msg.text:
                            extracted = self._extract_code_from_text(msg.text)
                            if extracted:
                                job.update(message=f"Kode OTP otomatis terdeteksi dari chat 777000!")
                                return extracted
                except Exception:
                    pass

            if asyncio.get_running_loop().time() - start_time > timeout_seconds:
                raise TimeoutError("Waktu tunggu kode OTP habis (180 detik). Silakan coba ulangi atau input manual lebih cepat.")

            await asyncio.sleep(1.5)

    @staticmethod
    def _extract_code_from_text(text: str) -> Optional[str]:
        if not text:
            return None
        m = re.search(r"(?:code|kode|login\s+code)[^\d]*(\d{5,6})", text, re.IGNORECASE)
        if m:
            return m.group(1)
        m5 = re.search(r"\b(\d{5})\b", text)
        if m5:
            return m5.group(1)
        return None

    def submit_manual_code(self, job_id: str, user_id: int, code: str) -> bool:
        job = self.get_job(job_id, user_id)
        if not job:
            raise ValueError("Job transfer tidak ditemukan.")
        clean_code = re.sub(r"[^\d]", "", (code or "").strip())
        if len(clean_code) < 5 or len(clean_code) > 6:
            raise ValueError("Kode login Telegram terdiri dari 5 atau 6 angka.")
        if job.code_future and not job.code_future.done():
            job.code_future.set_result(clean_code)
            return True
        return False

    def submit_2fa_password(self, job_id: str, user_id: int, password: str) -> bool:
        job = self.get_job(job_id, user_id)
        if not job:
            raise ValueError("Job transfer tidak ditemukan.")
        if not password:
            raise ValueError("Password 2FA tidak boleh kosong.")
        if job.password_future and not job.password_future.done():
            job.password_future.set_result(password)
            return True
        return False

    async def cancel_job(self, job_id: str, user_id: int) -> TransferJob:
        job = self.get_job(job_id, user_id)
        if not job:
            raise ValueError("Job transfer tidak ditemukan.")
        job.cancelled = True
        if job.task and not job.task.done():
            job.task.cancel()
        msg = (
            "Proses dibatalkan. Sesi baru sudah sempat dibuat & siap diunduh, sesi lama tidak di-logout."
            if job.output_ready
            else "Proses transfer sesi berhasil dibatalkan."
        )
        job.update(status=TransferStatus.CANCELLED, progress_pct=0, message=msg)
        return job

    def delete_output_file(self, job_id: str, user_id: int) -> bool:
        job = self.get_job(job_id, user_id)
        if not job:
            raise ValueError("Job transfer tidak ditemukan.")
        deleted = False
        if job.output_file_path and job.output_file_path.is_file():
            job.output_file_path.unlink()
            deleted = True
            journal = job.output_file_path.with_suffix(".session-journal")
            if journal.is_file():
                journal.unlink()
        job.update(output_ready=False, output_filename=None, message="File sementara .session telah dihapus dari server.")
        return deleted

    def _handle_error(self, job: TransferJob, err: Exception) -> None:
        err_msg = str(err)
        if isinstance(err, FloodWaitError):
            seconds = getattr(err, "seconds", 60)
            err_msg = f"Terkena batas FloodWait Telegram. Tunggu {seconds} detik sebelum mencoba lagi."
        elif isinstance(err, PhoneCodeInvalidError):
            err_msg = "Kode OTP yang dimasukkan salah."
        elif isinstance(err, PhoneCodeExpiredError):
            err_msg = "Kode OTP sudah kedaluwarsa. Silakan ulangi proses transfer."
        elif isinstance(err, PasswordHashInvalidError):
            err_msg = "Password Verifikasi Dua Langkah (2FA) salah."
        elif isinstance(err, PhoneNumberInvalidError):
            err_msg = "Nomor telepon pada sesi lama tidak valid."
        elif isinstance(err, (AuthKeyDuplicatedError, AuthKeyUnregisteredError)):
            err_msg = "Sesi lama telah dicabut atau tidak berlaku di server Telegram."
        job.update(status=TransferStatus.FAILED, message=f"Gagal: {err_msg}", error_detail=type(err).__name__)

    @staticmethod
    async def _cleanup_job_clients(job: TransferJob) -> None:
        for client in (job.old_client, job.new_client, job.verify_client):
            if client:
                try:
                    if client.is_connected():
                        await client.disconnect()
                except Exception:
                    pass
        job.old_client = None
        job.new_client = None
        job.verify_client = None
        if job.work_file and job.work_file.is_file():
            try:
                job.work_file.unlink()
            except Exception:
                pass
        job.work_file = None


session_transfer_service = SessionTransferService()
