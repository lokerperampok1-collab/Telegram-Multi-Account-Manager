import io
import re
import uuid
import base64
import asyncio
from datetime import datetime, timezone
from typing import Dict, Any, Optional
import qrcode
from PIL import Image

from telethon import TelegramClient, password as pwd_mod
from telethon.sessions import StringSession
from telethon.tl.functions.channels import JoinChannelRequest
from telethon.tl.functions.messages import ImportChatInviteRequest, CheckChatInviteRequest
from telethon.tl.functions.account import UpdateProfileRequest, GetPasswordRequest, GetPasswordSettingsRequest, ResetPasswordRequest
from telethon.tl.functions.contacts import GetContactsRequest, DeleteContactsRequest, ResetSavedRequest
from telethon.tl.types import account as account_types, ChatInviteAlready, ChatInvite, InputUser
from telethon.tl.functions.photos import UploadProfilePhotoRequest
from telethon.errors import (
    SessionPasswordNeededError,
    PhoneNumberInvalidError,
    PhoneCodeInvalidError,
    PhoneCodeExpiredError,
    PasswordHashInvalidError,
    UserAlreadyParticipantError,
    InviteHashExpiredError,
    InviteHashInvalidError,
    ChannelPrivateError,
    ChannelInvalidError,
    UsernameInvalidError,
    UsernameNotOccupiedError,
    PeerFloodError,
    UserDeactivatedError,
    UserDeactivatedBanError,
    AuthKeyUnregisteredError,
    FloodWaitError,
    ChatWriteForbiddenError,
    UserBannedInChannelError,
    SlowModeWaitError
)

from config import settings
from services.encryption import encryption_service
from database.models import TelegramAccountModel

class ClientManager:
    """Singleton to manage Telethon clients, login sessions, and connections."""
    
    def __init__(self):
        self._active_clients: Dict[int, TelegramClient] = {}
        self._pending_logins: Dict[str, Dict[str, Any]] = {}
        self._pending_qr_logins: Dict[str, Dict[str, Any]] = {}
        # Cancellation system: tracks running operations and cancel requests
        self._running_operations: Dict[str, str] = {}  # op_id -> description
        self._cancel_requested: set = set()  # set of op_ids to cancel

    def _start_operation(self, op_id: str, description: str):
        """Registers a new running operation."""
        self._running_operations[op_id] = description
        self._cancel_requested.discard(op_id)

    def _finish_operation(self, op_id: str):
        """Unregisters a completed operation."""
        self._running_operations.pop(op_id, None)
        self._cancel_requested.discard(op_id)

    def _is_cancelled(self, op_id: str) -> bool:
        """Checks if an operation has been requested to cancel."""
        return op_id in self._cancel_requested

    def request_cancel_all(self) -> dict:
        """Requests cancellation of all currently running operations."""
        cancelled = list(self._running_operations.keys())
        for op_id in cancelled:
            self._cancel_requested.add(op_id)
        return {
            "status": "success",
            "cancelled_count": len(cancelled),
            "operations": {k: v for k, v in self._running_operations.items() if k in cancelled}
        }

    def get_running_operations(self) -> dict:
        """Returns currently running operations."""
        return {
            "running": dict(self._running_operations),
            "count": len(self._running_operations)
        }

    async def _interruptible_sleep(self, seconds: float, op_id: Optional[str] = None):
        """Sleeps in small increments and breaks immediately if operation is cancelled."""
        if seconds <= 0:
            return
        elapsed = 0.0
        while elapsed < seconds:
            if op_id and self._is_cancelled(op_id):
                break
            step = min(0.3, seconds - elapsed)
            await asyncio.sleep(step)
            elapsed += step

    def _get_credentials(self) -> tuple[int, str]:
        if not settings.API_ID or not settings.API_HASH:
            raise ValueError("API_ID and API_HASH are not configured in .env file! Please set them first.")
        return settings.API_ID, settings.API_HASH

    def _generate_qr_base64(self, url: str) -> str:
        """Generates a high-contrast base64 encoded PNG data URL of the QR code for instant smartphone camera scanning."""
        from qrcode.image.pil import PilImage
        qr = qrcode.QRCode(
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=10,
            border=4,
            image_factory=PilImage
        )
        qr.add_data(url)
        qr.make(fit=True)
        # High contrast black-on-white is standard for optical camera and Telegram QR scanner detection
        img = qr.make_image(fill_color="#000000", back_color="#ffffff")
        
        buffered = io.BytesIO()
        img.get_image().save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
        return f"data:image/png;base64,{img_str}"

    # ------------------ Phone Login Flow ------------------

    async def start_phone_login(self, phone: str, user_id: int) -> dict:
        """Initiates login with a phone number and sends OTP code."""
        api_id, api_hash = self._get_credentials()
        client = TelegramClient(StringSession(), api_id, api_hash)
        await client.connect()

        try:
            code_result = await client.send_code_request(phone)
            token = str(uuid.uuid4())
            self._pending_logins[token] = {
                "client": client,
                "phone": phone,
                "phone_code_hash": code_result.phone_code_hash,
                "user_id": user_id,
                "created_at": datetime.now(timezone.utc),
                "status": "code_sent"
            }
            return {
                "status": "success",
                "token": token,
                "phone": phone,
                "message": "OTP code sent to Telegram app or SMS"
            }
        except FloodWaitError as e:
            await client.disconnect()
            return {"status": "error", "error_type": "flood_wait", "seconds": e.seconds, "message": f"Too many attempts. Please wait {e.seconds} seconds."}
        except PhoneNumberInvalidError:
            await client.disconnect()
            return {"status": "error", "error_type": "invalid_phone", "message": "Phone number is invalid. Use international format (e.g. +62812345678)."}
        except Exception as e:
            await client.disconnect()
            return {"status": "error", "message": str(e)}

    async def verify_code(self, token: str, code: str) -> dict:
        """Verifies OTP code received on phone."""
        session_data = self._pending_logins.get(token)
        if not session_data:
            return {"status": "error", "message": "Login session expired or invalid"}

        client: TelegramClient = session_data["client"]
        phone = session_data["phone"]
        phone_code_hash = session_data["phone_code_hash"]
        user_id = session_data["user_id"]

        try:
            await client.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
            # Login successful without 2FA
            return await self._finalize_login(token, client, user_id, phone)
        except SessionPasswordNeededError:
            session_data["status"] = "2fa_needed"
            return {
                "status": "2fa_required",
                "token": token,
                "message": "Two-Step Verification (2FA) password is required"
            }
        except (PhoneCodeInvalidError, PhoneCodeExpiredError) as e:
            return {"status": "error", "message": "Invalid or expired verification code"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    async def verify_2fa(self, token: str, password: str) -> dict:
        """Submits 2FA password to complete login."""
        session_data = self._pending_logins.get(token)
        if not session_data:
            return {"status": "error", "message": "Login session expired or invalid"}

        client: TelegramClient = session_data["client"]
        user_id = session_data["user_id"]
        phone = session_data.get("phone")

        try:
            await client.sign_in(password=password)
            return await self._finalize_login(token, client, user_id, phone)
        except PasswordHashInvalidError:
            return {"status": "error", "message": "Incorrect 2FA password"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    # ------------------ QR Code Login Flow ------------------

    async def start_qr_login(self, user_id: int) -> dict:
        """Initiates QR code login flow."""
        api_id, api_hash = self._get_credentials()
        client = TelegramClient(StringSession(), api_id, api_hash)
        await client.connect()

        try:
            qr_login = await client.qr_login()
            token = str(uuid.uuid4())
            qr_image_base64 = self._generate_qr_base64(qr_login.url)

            session_record = {
                "client": client,
                "qr_login": qr_login,
                "user_id": user_id,
                "status": "pending",
                "account_info": None,
                "created_at": datetime.now(timezone.utc)
            }
            self._pending_qr_logins[token] = session_record

            # Launch background waiting task
            asyncio.create_task(self._wait_for_qr_scan(token))

            return {
                "status": "success",
                "token": token,
                "qr_image": qr_image_base64,
                "expires_in": 30
            }
        except Exception as e:
            await client.disconnect()
            return {"status": "error", "message": str(e)}

    async def _wait_for_qr_scan(self, token: str):
        """Asynchronously waits for the user to scan the QR code."""
        record = self._pending_qr_logins.get(token)
        if not record:
            return

        client: TelegramClient = record["client"]
        qr_login = record["qr_login"]
        user_id = record["user_id"]

        try:
            # Wait up to 35 seconds for QR confirmation
            user = await qr_login.wait(timeout=35)
            # Finalize login
            res = await self._finalize_login(token, client, user_id, is_qr=True)
            record["status"] = res.get("status", "success")
            record["account_info"] = res
        except SessionPasswordNeededError:
            record["status"] = "2fa_needed"
            # Keep client alive for 2FA password input
            self._pending_logins[token] = {
                "client": client,
                "user_id": user_id,
                "phone": None,
                "status": "2fa_needed"
            }
        except asyncio.TimeoutError:
            record["status"] = "expired"
        except Exception as e:
            record["status"] = "failed"
            record["error"] = str(e)
            try:
                await client.disconnect()
            except Exception:
                pass

    async def get_qr_status(self, token: str) -> dict:
        """Polls the status of the QR login flow."""
        record = self._pending_qr_logins.get(token)
        if not record:
            return {"status": "not_found", "message": "QR login session not found"}
        
        status = record.get("status", "pending")
        response = {"status": status}
        if status == "success":
            response["account"] = record.get("account_info")
        elif status == "failed":
            response["message"] = record.get("error", "Login failed")
        elif status == "2fa_needed":
            response["token"] = token
            response["message"] = "2FA password is required"
        return response

    async def refresh_qr(self, token: str) -> dict:
        """Recreates QR code if expired."""
        record = self._pending_qr_logins.get(token)
        if not record:
            return {"status": "error", "message": "Session not found"}

        client: TelegramClient = record["client"]
        qr_login = record["qr_login"]

        try:
            await qr_login.recreate()
            qr_image_base64 = self._generate_qr_base64(qr_login.url)
            record["status"] = "pending"
            asyncio.create_task(self._wait_for_qr_scan(token))
            return {
                "status": "success",
                "token": token,
                "qr_image": qr_image_base64,
                "expires_in": 30
            }
        except Exception as e:
            return {"status": "error", "message": str(e)}

    # ------------------ Finalization & Helper ------------------

    async def _finalize_login(self, token: str, client: TelegramClient, user_id: int, phone: Optional[str] = None, is_qr: bool = False) -> dict:
        """Finalizes authorized client, saves encrypted StringSession to DB, registers client."""
        try:
            me = await client.get_me()
            session_str = client.session.save()
            encrypted_session = encryption_service.encrypt(session_str)

            display_name = f"{me.first_name or ''} {me.last_name or ''}".strip()
            phone_number = phone or me.phone
            if phone_number and not phone_number.startswith("+"):
                phone_number = f"+{phone_number}"

            account_id, is_updated = await TelegramAccountModel.upsert(
                user_id=user_id,
                session_string=encrypted_session,
                phone_number=phone_number,
                display_name=display_name,
                username=me.username,
                telegram_id=me.id,
                is_active=True
            )

            # Disconnect existing client instance if any
            old_client = self._active_clients.get(account_id)
            if old_client and old_client != client:
                try:
                    await old_client.disconnect()
                except Exception:
                    pass

            # Keep active in memory
            self._active_clients[account_id] = client

            # Clean pending references
            self._pending_logins.pop(token, None)

            msg = f"Berhasil memperbarui sesi akun {display_name or phone_number}!" if is_updated else f"Berhasil menghubungkan akun {display_name or phone_number}!"
            return {
                "status": "success",
                "account_id": account_id,
                "telegram_id": me.id,
                "phone_number": phone_number,
                "display_name": display_name,
                "username": me.username,
                "is_updated": is_updated,
                "message": msg
            }
        except Exception as e:
            return {"status": "error", "message": f"Failed to save account: {str(e)}"}

    # ------------------ Account State & Actions ------------------

    async def connect_account(self, account_id: int, user_id: int) -> dict:
        """Connects a stored account from DB using its saved StringSession."""
        account = await TelegramAccountModel.get_by_id(account_id, user_id)
        if not account:
            return {"status": "error", "message": "Account not found"}

        if account_id in self._active_clients and self._active_clients[account_id].is_connected():
            return {"status": "success", "message": "Already connected", "is_active": True}

        try:
            api_id, api_hash = self._get_credentials()
            session_str = encryption_service.decrypt(account["session_string"])
            client = TelegramClient(StringSession(session_str), api_id, api_hash)
            await client.connect()

            if not await client.is_user_authorized():
                await client.disconnect()
                await TelegramAccountModel.update_status(account_id, False)
                return {"status": "error", "message": "Session is revoked or expired. Please re-login."}

            self._active_clients[account_id] = client
            await TelegramAccountModel.update_status(account_id, True)
            return {"status": "success", "message": "Account connected successfully", "is_active": True}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    async def disconnect_account(self, account_id: int, user_id: int) -> dict:
        """Disconnects an active client without deleting from database."""
        if account_id in self._active_clients:
            client = self._active_clients.pop(account_id)
            try:
                await client.disconnect()
            except Exception:
                pass
        
        await TelegramAccountModel.update_status(account_id, False)
        return {"status": "success", "message": "Account disconnected", "is_active": False}

    async def remove_account(self, account_id: int, user_id: int) -> dict:
        """Disconnects and permanently removes account from DB."""
        if account_id in self._active_clients:
            client = self._active_clients.pop(account_id)
            try:
                # Optionally call log_out() to revoke session or just disconnect
                await client.disconnect()
            except Exception:
                pass

        deleted = await TelegramAccountModel.delete(account_id, user_id)
        if deleted:
            return {"status": "success", "message": "Account removed"}
        return {"status": "error", "message": "Account not found"}

    # ------------------ Group Join Methods ------------------

    def _parse_group_target(self, group_input: str) -> dict:
        """Parses group input link or username into structured target format."""
        clean = group_input.strip()
        if "?" in clean:
            clean = clean.split("?")[0]
        clean = clean.rstrip("/")

        # Private invite link with '+' or 'joinchat/'
        if "/+" in clean or clean.startswith("+"):
            hash_part = clean.split("+")[-1].strip()
            return {"type": "private", "hash": hash_part}
        elif "joinchat/" in clean:
            hash_part = clean.split("joinchat/")[-1].strip()
            return {"type": "private", "hash": hash_part}
        else:
            # Public username
            username = clean
            for prefix in ["https://t.me/", "http://t.me/", "t.me/", "@"]:
                if username.startswith(prefix):
                    username = username[len(prefix):]
            username = username.strip().split("/")[0]
            return {"type": "public", "username": username}

    async def join_group_single(self, client: TelegramClient, target: dict) -> dict:
        """Executes group join on a single active TelegramClient."""
        try:
            if target["type"] == "private":
                await client(ImportChatInviteRequest(target["hash"]))
                return {"status": "success", "message": "Berhasil bergabung ke grup privat"}
            else:
                entity = await client.get_entity(target["username"])
                await client(JoinChannelRequest(entity))
                return {"status": "success", "message": f"Berhasil bergabung ke @{target['username']}"}
        except UserAlreadyParticipantError:
            return {"status": "already_joined", "message": "Sudah menjadi anggota grup ini"}
        except (InviteHashExpiredError, InviteHashInvalidError):
            return {"status": "error", "message": "Link undangan privat kedaluwarsa atau tidak valid"}
        except (UsernameInvalidError, UsernameNotOccupiedError):
            return {"status": "error", "message": "Username grup/channel tidak ditemukan"}
        except ChannelPrivateError:
            return {"status": "error", "message": "Grup bersifat privat atau akun dibatasi/di-ban"}
        except FloodWaitError as e:
            return {"status": "flood_wait", "seconds": e.seconds, "message": f"Terkena limit Telegram, tunggu {e.seconds}s"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    async def join_group_bulk(
        self,
        user_id: int,
        group_link: str,
        account_ids: Optional[list[int]] = None,
        delay_seconds: int = 3
    ) -> list[dict]:
        """Iterates through user's accounts to join specified group with safe delays."""
        op_id = f"join_group_{uuid.uuid4().hex[:8]}"
        self._start_operation(op_id, f"Join Grup: {group_link}")
        target = self._parse_group_target(group_link)
        results = []

        try:
            all_accounts = await TelegramAccountModel.list_by_user(user_id)
            if account_ids:
                accounts_to_process = [acc for acc in all_accounts if acc["id"] in account_ids]
            else:
                accounts_to_process = all_accounts

            if not accounts_to_process:
                return [{"status": "error", "message": "Tidak ada akun Telegram yang tersedia"}]

            for idx, acc in enumerate(accounts_to_process):
                # Check cancellation before each account
                if self._is_cancelled(op_id):
                    results.append({"status": "cancelled", "name": "—", "message": f"Proses dihentikan oleh pengguna ({idx}/{len(accounts_to_process)} selesai)"})
                    break

                acc_id = acc["id"]
                acc_name = acc.get("display_name") or acc.get("phone_number") or f"Akun #{acc_id}"
                
                # Ensure client is connected
                client = self._active_clients.get(acc_id)
                if not client or not client.is_connected():
                    connect_res = await self.connect_account(acc_id, user_id)
                    if connect_res.get("status") != "success":
                        results.append({
                            "account_id": acc_id,
                            "name": acc_name,
                            "status": "error",
                            "message": f"Gagal menghubungkan akun: {connect_res.get('message')}"
                        })
                        continue
                    client = self._active_clients.get(acc_id)

                # Execute group join
                res = await self.join_group_single(client, target)
                results.append({
                    "account_id": acc_id,
                    "name": acc_name,
                    "status": res["status"],
                    "message": res["message"]
                })

                # Safe delay before next account
                if idx < len(accounts_to_process) - 1 and delay_seconds > 0:
                    await self._interruptible_sleep(delay_seconds, op_id)
        finally:
            self._finish_operation(op_id)

        return results

    # ------------------ Mass Group Messaging (Chat Grup) ------------------

    async def send_group_message_single(
        self,
        client: TelegramClient,
        target: dict,
        message_text: str,
        auto_join: bool = True
    ) -> dict:
        """Sends a message to target group/channel from a single active TelegramClient."""
        try:
            entity = None
            if target["type"] == "private":
                try:
                    invite = await client(CheckChatInviteRequest(target["hash"]))
                    if isinstance(invite, ChatInviteAlready):
                        entity = invite.chat
                    elif auto_join:
                        joined = await client(ImportChatInviteRequest(target["hash"]))
                        if hasattr(joined, 'chats') and joined.chats:
                            entity = joined.chats[0]
                        else:
                            invite_after = await client(CheckChatInviteRequest(target["hash"]))
                            if isinstance(invite_after, ChatInviteAlready):
                                entity = invite_after.chat
                    else:
                        return {"status": "not_joined", "message": "Akun belum bergabung ke grup privat ini"}
                except UserAlreadyParticipantError:
                    pass
                except (InviteHashExpiredError, InviteHashInvalidError):
                    return {"status": "error", "message": "Link undangan privat kedaluwarsa atau tidak valid"}
                except Exception as e:
                    return {"status": "error", "message": f"Gagal memproses grup privat: {str(e)}"}
            else:
                try:
                    entity = await client.get_entity(target["username"])
                    if auto_join:
                        try:
                            await client(JoinChannelRequest(entity))
                        except UserAlreadyParticipantError:
                            pass
                        except Exception:
                            pass
                except (UsernameInvalidError, UsernameNotOccupiedError):
                    return {"status": "error", "message": "Username grup tidak ditemukan"}
                except Exception as e:
                    return {"status": "error", "message": f"Gagal menemukan grup: {str(e)}"}

            if not entity:
                return {"status": "error", "message": "Target grup tidak dapat diakses"}

            # Send the message
            sent_msg = await client.send_message(entity, message_text)
            return {
                "status": "success",
                "message_id": getattr(sent_msg, 'id', None),
                "message": "Pesan berhasil terkirim"
            }
        except ChatWriteForbiddenError:
            return {"status": "forbidden", "message": "Grup membatasi izin chat untuk anggota / hanya admin yang bisa kirim pesan"}
        except UserBannedInChannelError:
            return {"status": "banned", "message": "Akun dibatasi atau di-banned di grup ini"}
        except ChannelPrivateError:
            return {"status": "error", "message": "Grup bersifat privat atau akun tidak memiliki akses"}
        except SlowModeWaitError as e:
            return {"status": "slowmode", "message": f"Grup mengaktifkan slowmode, perlu tunggu {e.seconds} detik"}
        except FloodWaitError as e:
            return {"status": "flood_wait", "seconds": e.seconds, "message": f"Limit Telegram (FloodWait {e.seconds}s)"}
        except Exception as e:
            return {"status": "error", "message": f"Gagal kirim pesan: {str(e)}"}

    async def send_group_message_bulk(
        self,
        user_id: int,
        group_link: str,
        messages: list[str],
        distribution_mode: str = "random",
        auto_join: bool = True,
        account_ids: Optional[list[int]] = None,
        delay_seconds: int = 5
    ) -> list[dict]:
        """Sends distributed message variations across user's active accounts to target group."""
        import random
        op_id = f"send_msg_{uuid.uuid4().hex[:8]}"
        self._start_operation(op_id, f"Kirim Pesan Grup: {group_link}")
        target = self._parse_group_target(group_link)
        results = []

        try:
            all_accounts = await TelegramAccountModel.list_by_user(user_id)
            if account_ids:
                accounts_to_process = [acc for acc in all_accounts if acc["id"] in account_ids]
            else:
                accounts_to_process = all_accounts

            if not accounts_to_process:
                return [{"status": "error", "message": "Tidak ada akun Telegram yang tersedia"}]

            clean_messages = [m.strip() for m in messages if m and m.strip()]
            if not clean_messages:
                clean_messages = ["Halo semua, salam kenal!"]

            for idx, acc in enumerate(accounts_to_process):
                if self._is_cancelled(op_id):
                    results.append({"status": "cancelled", "name": "—", "phone": "", "text": "", "message": f"Proses dihentikan oleh pengguna ({idx}/{len(accounts_to_process)} selesai)"})
                    break

                acc_id = acc["id"]
                acc_name = acc.get("display_name") or acc.get("phone_number") or f"Akun #{acc_id}"

                # Select message variation
                if distribution_mode == "round_robin":
                    selected_text = clean_messages[idx % len(clean_messages)]
                else:
                    selected_text = random.choice(clean_messages)

                # Ensure client is connected
                client = self._active_clients.get(acc_id)
                if not client or not client.is_connected():
                    connect_res = await self.connect_account(acc_id, user_id)
                    if connect_res.get("status") != "success":
                        results.append({
                            "account_id": acc_id,
                            "name": acc_name,
                            "phone": acc.get("phone_number"),
                            "text": selected_text,
                            "status": "error",
                            "message": f"Gagal menghubungkan akun: {connect_res.get('message')}"
                        })
                        continue
                    client = self._active_clients.get(acc_id)

                res = await self.send_group_message_single(client, target, selected_text, auto_join)
                results.append({
                    "account_id": acc_id,
                    "name": acc_name,
                    "phone": acc.get("phone_number"),
                    "text": selected_text,
                    "status": res["status"],
                    "message": res["message"]
                })

                # Safe delay before next account
                if idx < len(accounts_to_process) - 1 and delay_seconds > 0:
                    await self._interruptible_sleep(delay_seconds, op_id)
        finally:
            self._finish_operation(op_id)

        return results

    # ------------------ Health & SpamBot Checker ------------------

    async def check_account_health(self, account_id: int, user_id: int) -> dict:
        """Queries official @SpamBot to verify account limitations and health."""
        account = await TelegramAccountModel.get_by_id(account_id, user_id)
        if not account:
            return {"status": "error", "badge": "Error", "message": "Akun tidak ditemukan"}

        # Ensure client is connected
        client = self._active_clients.get(account_id)
        if not client or not client.is_connected():
            connect_res = await self.connect_account(account_id, user_id)
            if connect_res.get("status") != "success":
                return {"status": "banned", "badge": "Banned / Mati", "message": connect_res.get("message", "Sesi mati / kedaluwarsa")}
            client = self._active_clients.get(account_id)

        try:
            if not await client.is_user_authorized():
                await TelegramAccountModel.update_status(account_id, False)
                return {"status": "banned", "badge": "Banned / Mati", "message": "Sesi tidak terotorisasi atau akun di-banned"}
        except (UserDeactivatedError, UserDeactivatedBanError, AuthKeyUnregisteredError):
            await TelegramAccountModel.update_status(account_id, False)
            return {"status": "banned", "badge": "Banned / Mati", "message": "Akun Telegram telah dinonaktifkan / di-banned"}
        except Exception as e:
            return {"status": "banned", "badge": "Banned / Mati", "message": f"Error otorisasi: {str(e)}"}

        # Conversation with @SpamBot
        try:
            async with client.conversation("@SpamBot", timeout=12) as conv:
                await conv.send_message("/start")
                response = await conv.get_response()
                text = response.text.lower()
                if "no limits" in text or "free" in text or "tidak ada batasan" in text or "good news" in text:
                    return {
                        "status": "clean",
                        "badge": "Clean / Normal",
                        "message": "Akun normal, tidak ada pembatasan dari Telegram."
                    }
                else:
                    return {
                        "status": "limited",
                        "badge": "Limited / Muted",
                        "message": response.text[:200]
                    }
        except PeerFloodError:
            return {
                "status": "limited",
                "badge": "Limited / Muted",
                "message": "PeerFloodError: Akun dibatasi untuk mengirim pesan baru."
            }
        except FloodWaitError as e:
            return {
                "status": "flood_wait",
                "badge": "Flood Wait",
                "message": f"Terkena FloodWait Telegram, tunggu {e.seconds} detik."
            }
        except asyncio.TimeoutError:
            return {
                "status": "unknown",
                "badge": "Tidak Merespon",
                "message": "@SpamBot tidak merespon dalam 12 detik."
            }
        except Exception as e:
            return {
                "status": "unknown",
                "badge": "Error",
                "message": str(e)
            }

    async def check_all_accounts_health(self, user_id: int) -> list[dict]:
        """Runs health checks on all user accounts sequentially."""
        op_id = f"health_{uuid.uuid4().hex[:8]}"
        self._start_operation(op_id, "Cek Status @SpamBot Semua Akun")
        accounts = await TelegramAccountModel.list_by_user(user_id)
        results = []
        try:
            for idx, acc in enumerate(accounts):
                if self._is_cancelled(op_id):
                    results.append({"account_id": 0, "name": "—", "phone": "", "status": "cancelled", "badge": "Dibatalkan", "message": f"Proses dihentikan ({idx}/{len(accounts)} selesai)"})
                    break
                acc_id = acc["id"]
                acc_name = acc.get("display_name") or acc.get("phone_number") or f"Akun #{acc_id}"
                health = await self.check_account_health(acc_id, user_id)
                results.append({
                    "account_id": acc_id,
                    "name": acc_name,
                    "phone": acc.get("phone_number"),
                    "status": health["status"],
                    "badge": health.get("badge", health["status"]),
                    "message": health["message"]
                })
                if idx < len(accounts) - 1:
                    await self._interruptible_sleep(2, op_id)
        finally:
            self._finish_operation(op_id)
        return results

    # ------------------ Telegram Login OTP Retrieval ------------------

    @staticmethod
    def _extract_otp_from_text(text: str) -> Optional[str]:
        """Extracts 5 or 6 digit login code from Telegram Service Notification text."""
        if not text:
            return None
        # Priority 1: explicitly labeled code (Indonesian, English, Russian, Spanish, etc.)
        m = re.search(r'(?:kode masuk|kode login|login code|confirmation code|verification code|código de inicio de sesión|код подтверждения)[^0-9]*([0-9]{5,6})', text, re.IGNORECASE)
        if m:
            return m.group(1)
        # Priority 2: 5 consecutive digits
        m5 = re.search(r'(?<!\d)(\d{5})(?!\d)', text)
        if m5:
            return m5.group(1)
        # Priority 3: 6 consecutive digits
        m6 = re.search(r'(?<!\d)(\d{6})(?!\d)', text)
        if m6:
            return m6.group(1)
        return None

    async def get_account_otp(self, account_id: int, user_id: int, limit: int = 5) -> dict:
        """Fetches the latest OTP login code and messages from Telegram Service Notifications (777000)."""
        account = await TelegramAccountModel.get_by_id(account_id, user_id)
        if not account:
            return {"status": "error", "message": "Akun tidak ditemukan"}

        # Ensure client is connected
        client = self._active_clients.get(account_id)
        if not client or not client.is_connected():
            connect_res = await self.connect_account(account_id, user_id)
            if connect_res.get("status") != "success":
                return {
                    "status": "error",
                    "message": f"Gagal menghubungkan sesi akun: {connect_res.get('message', 'Sesi mati / kedaluwarsa')}"
                }
            client = self._active_clients.get(account_id)

        try:
            if not await client.is_user_authorized():
                await TelegramAccountModel.update_status(account_id, False)
                return {"status": "error", "message": "Sesi tidak terotorisasi atau sudah kedaluwarsa"}

            # Fetch messages from official Telegram Notifications peer (777000)
            messages = await client.get_messages(777000, limit=limit)
            
            parsed_messages = []
            latest_otp = None
            latest_otp_time = None
            latest_otp_message = None

            for msg in messages:
                text = msg.text or ""
                code = self._extract_otp_from_text(text)
                date_iso = msg.date.isoformat() if msg.date else None
                
                parsed_messages.append({
                    "id": msg.id,
                    "date": date_iso,
                    "text": text,
                    "otp_code": code
                })

                if not latest_otp and code:
                    latest_otp = code
                    latest_otp_time = date_iso
                    latest_otp_message = text

            # Check 2FA status if not already checked or if requested
            raw_has_2fa = account.get("has_2fa")
            bool_has_2fa = bool(raw_has_2fa) if raw_has_2fa is not None else None
            twofa_info = {
                "has_2fa": bool_has_2fa,
                "twofa_password": account.get("twofa_password"),
                "twofa_status": account.get("twofa_status"),
                "twofa_reset_until": account.get("twofa_reset_until"),
                "twofa_hint": account.get("twofa_hint")
            }

            # If 2FA status is unknown in DB, run a check automatically
            if account.get("has_2fa") is None:
                try:
                    check_2fa_res = await self.check_account_2fa(account_id, user_id)
                    if check_2fa_res.get("status") == "success":
                        twofa_info = {
                            "has_2fa": check_2fa_res.get("has_2fa"),
                            "twofa_password": check_2fa_res.get("twofa_password"),
                            "twofa_status": check_2fa_res.get("twofa_status"),
                            "twofa_reset_until": check_2fa_res.get("twofa_reset_until"),
                            "twofa_hint": check_2fa_res.get("hint")
                        }
                except Exception:
                    pass

            return {
                "status": "success",
                "account_id": account_id,
                "phone_number": account.get("phone_number"),
                "display_name": account.get("display_name"),
                "latest_otp": latest_otp,
                "latest_otp_time": latest_otp_time,
                "latest_otp_message": latest_otp_message,
                "twofa": twofa_info,
                "messages": parsed_messages,
                "count": len(parsed_messages)
            }
        except (UserDeactivatedError, UserDeactivatedBanError, AuthKeyUnregisteredError):
            await TelegramAccountModel.update_status(account_id, False)
            return {"status": "error", "message": "Akun Telegram telah dinonaktifkan / di-banned"}
        except Exception as e:
            return {"status": "error", "message": f"Gagal mengambil pesan OTP: {str(e)}"}

    # ------------------ 2FA Status Checker ------------------

    async def check_account_2fa(self, account_id: int, user_id: int) -> dict:
        """Queries Telegram to check if Two-Step Verification (2FA) is enabled and retrieves hint."""
        account = await TelegramAccountModel.get_by_id(account_id, user_id)
        if not account:
            return {"status": "error", "message": "Akun tidak ditemukan"}

        client = self._active_clients.get(account_id)
        if not client or not client.is_connected():
            connect_res = await self.connect_account(account_id, user_id)
            if connect_res.get("status") != "success":
                return {
                    "status": "error",
                    "message": f"Gagal menghubungkan sesi akun: {connect_res.get('message', 'Sesi mati / kedaluwarsa')}"
                }
            client = self._active_clients.get(account_id)

        try:
            if not await client.is_user_authorized():
                await TelegramAccountModel.update_status(account_id, False)
                return {"status": "error", "message": "Sesi tidak terotorisasi atau sudah kedaluwarsa"}

            pwd = await client(GetPasswordRequest())
            has_2fa = bool(pwd.has_password)
            hint = getattr(pwd, 'hint', None)
            has_recovery = getattr(pwd, 'has_recovery', False)
            pending_reset_date = getattr(pwd, 'pending_reset_date', None)

            if not has_2fa:
                await TelegramAccountModel.update_2fa_status(
                    account_id=account_id,
                    has_2fa=False,
                    hint=hint,
                    twofa_password=None,
                    twofa_status="no_2fa",
                    twofa_reset_until=None
                )
                return {
                    "status": "success",
                    "account_id": account_id,
                    "phone_number": account.get("phone_number"),
                    "display_name": account.get("display_name"),
                    "has_2fa": False,
                    "twofa_password": None,
                    "twofa_status": "no_2fa",
                    "twofa_reset_until": None,
                    "hint": hint,
                    "message": "2FA Tidak Aktif (Tanpa Password)"
                }

            # If 2FA is active, test candidate passwords: "0707" and "7"
            candidates = ["0707", "7"]
            matched_pwd = None
            for cand in candidates:
                try:
                    check_srp = pwd_mod.compute_check(pwd, cand)
                    await client(GetPasswordSettingsRequest(password=check_srp))
                    matched_pwd = cand
                    break
                except PasswordHashInvalidError:
                    continue
                except Exception:
                    pass

            if matched_pwd:
                await TelegramAccountModel.update_2fa_status(
                    account_id=account_id,
                    has_2fa=True,
                    hint=hint,
                    twofa_password=matched_pwd,
                    twofa_status="matched",
                    twofa_reset_until=None
                )
                return {
                    "status": "success",
                    "account_id": account_id,
                    "phone_number": account.get("phone_number"),
                    "display_name": account.get("display_name"),
                    "has_2fa": True,
                    "twofa_password": matched_pwd,
                    "twofa_status": "matched",
                    "twofa_reset_until": None,
                    "hint": hint,
                    "message": f"2FA Aktif - Password Cocok: '{matched_pwd}'"
                }

            # Neither "0707" nor "7" matched -> Reset 2FA and wait 7 days
            reset_until_str = None
            if pending_reset_date:
                reset_until_str = pending_reset_date.strftime("%Y-%m-%d %H:%M:%S")
            else:
                try:
                    reset_res = await client(ResetPasswordRequest())
                    if isinstance(reset_res, account_types.ResetPasswordRequestedWait):
                        if reset_res.until_date:
                            reset_until_str = reset_res.until_date.strftime("%Y-%m-%d %H:%M:%S")
                        else:
                            reset_until_str = "Menunggu 7 Hari"
                    elif isinstance(reset_res, account_types.ResetPasswordOk):
                        await TelegramAccountModel.update_2fa_status(
                            account_id=account_id,
                            has_2fa=False,
                            hint=hint,
                            twofa_password=None,
                            twofa_status="no_2fa",
                            twofa_reset_until=None
                        )
                        return {
                            "status": "success",
                            "account_id": account_id,
                            "phone_number": account.get("phone_number"),
                            "display_name": account.get("display_name"),
                            "has_2fa": False,
                            "twofa_password": None,
                            "twofa_status": "no_2fa",
                            "twofa_reset_until": None,
                            "hint": hint,
                            "message": "Password langsung di-reset oleh Telegram (Tanpa 2FA)."
                        }
                    elif isinstance(reset_res, account_types.ResetPasswordFailedWait):
                        if reset_res.retry_date:
                            reset_until_str = reset_res.retry_date.strftime("%Y-%m-%d %H:%M:%S")
                        else:
                            reset_until_str = "Menunggu 7 Hari"
                    else:
                        reset_until_str = "Menunggu 7 Hari"
                except Exception as e:
                    reset_until_str = "Menunggu 7 Hari"

            await TelegramAccountModel.update_2fa_status(
                account_id=account_id,
                has_2fa=True,
                hint=hint,
                twofa_password=None,
                twofa_status="reset_pending",
                twofa_reset_until=reset_until_str
            )

            return {
                "status": "success",
                "account_id": account_id,
                "phone_number": account.get("phone_number"),
                "display_name": account.get("display_name"),
                "has_2fa": True,
                "twofa_password": None,
                "twofa_status": "reset_pending",
                "twofa_reset_until": reset_until_str,
                "hint": hint,
                "message": f"Password salah (bukan 0707 / 7). 2FA di-reset: Menunggu 7 hari ({reset_until_str})."
            }
        except (UserDeactivatedError, UserDeactivatedBanError, AuthKeyUnregisteredError):
            await TelegramAccountModel.update_status(account_id, False)
            return {"status": "error", "message": "Akun Telegram telah dinonaktifkan / di-banned"}
        except FloodWaitError as e:
            return {"status": "error", "message": f"Terkena FloodWait Telegram, tunggu {e.seconds} detik."}
        except Exception as e:
            return {"status": "error", "message": f"Gagal mengecek status 2FA: {str(e)}"}

    async def check_all_accounts_2fa(self, user_id: int) -> list[dict]:
        """Runs 2FA check on all user accounts sequentially."""
        op_id = f"2fa_{uuid.uuid4().hex[:8]}"
        self._start_operation(op_id, "Cek 2FA Semua Akun")
        accounts = await TelegramAccountModel.list_by_user(user_id)
        results = []
        try:
            for idx, acc in enumerate(accounts):
                if self._is_cancelled(op_id):
                    results.append({"account_id": 0, "name": "—", "phone": "", "status": "cancelled", "message": f"Proses dihentikan ({idx}/{len(accounts)} selesai)"})
                    break
                acc_id = acc["id"]
                acc_name = acc.get("display_name") or acc.get("phone_number") or f"Akun #{acc_id}"
                res = await self.check_account_2fa(acc_id, user_id)
                results.append({
                    "account_id": acc_id,
                    "name": acc_name,
                    "phone": acc.get("phone_number"),
                    "has_2fa": res.get("has_2fa"),
                    "twofa_password": res.get("twofa_password"),
                    "twofa_status": res.get("twofa_status"),
                    "twofa_reset_until": res.get("twofa_reset_until"),
                    "hint": res.get("hint"),
                    "status": res.get("status"),
                    "message": res.get("message")
                })
                if idx < len(accounts) - 1:
                    await self._interruptible_sleep(1, op_id)
        finally:
            self._finish_operation(op_id)
        return results

    # ------------------ Session Export & Import ------------------

    async def export_sessions(self, user_id: int) -> list[dict]:
        """Returns decrypted StringSessions of all accounts for backup/export."""
        accounts = await TelegramAccountModel.list_by_user_with_sessions(user_id)
        exported = []
        for acc in accounts:
            raw_session = ""
            try:
                raw_session = encryption_service.decrypt(acc["session_string"])
            except Exception:
                raw_session = ""
            exported.append({
                "id": acc["id"],
                "phone_number": acc.get("phone_number"),
                "display_name": acc.get("display_name"),
                "username": acc.get("username"),
                "telegram_id": acc.get("telegram_id"),
                "is_active": bool(acc.get("is_active")),
                "session_string": raw_session
            })
        return exported

    async def import_session_string(self, user_id: int, session_str: str) -> dict:
        """Validates and imports a single StringSession into database."""
        s = session_str.strip()
        if not s:
            return {"status": "error", "message": "StringSession tidak boleh kosong"}

        try:
            api_id, api_hash = self._get_credentials()
            client = TelegramClient(StringSession(s), api_id, api_hash)
            await client.connect()

            if not await client.is_user_authorized():
                await client.disconnect()
                return {"status": "error", "message": "StringSession tidak terotorisasi atau sudah kedaluwarsa"}

            me = await client.get_me()
            encrypted_session = encryption_service.encrypt(s)
            display_name = f"{me.first_name or ''} {me.last_name or ''}".strip()
            phone_number = me.phone
            if phone_number and not phone_number.startswith("+"):
                phone_number = f"+{phone_number}"

            account_id, is_updated = await TelegramAccountModel.upsert(
                user_id=user_id,
                session_string=encrypted_session,
                phone_number=phone_number,
                display_name=display_name,
                username=me.username,
                telegram_id=me.id,
                is_active=True
            )
            old_client = self._active_clients.get(account_id)
            if old_client and old_client != client:
                try:
                    await old_client.disconnect()
                except Exception:
                    pass
            self._active_clients[account_id] = client

            msg = f"Berhasil memperbarui sesi akun: {display_name or phone_number}!" if is_updated else f"Berhasil mengimpor akun baru: {display_name or phone_number}!"
            return {
                "status": "success",
                "account_id": account_id,
                "name": display_name,
                "phone": phone_number,
                "username": me.username,
                "is_updated": is_updated,
                "message": msg
            }
        except Exception as e:
            return {"status": "error", "message": f"Gagal memvalidasi StringSession: {str(e)}"}

    async def import_bulk_sessions(self, user_id: int, session_strings: list[str]) -> list[dict]:
        """Imports multiple StringSessions sequentially."""
        results = []
        for s in session_strings:
            cleaned = s.strip()
            if cleaned:
                res = await self.import_session_string(user_id, cleaned)
                results.append(res)
                await asyncio.sleep(1)
        return results

    # ------------------ Mass Profile Update ------------------

    async def update_profile_bulk(
        self,
        user_id: int,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        about: Optional[str] = None,
        photo_bytes: Optional[bytes] = None,
        photo_filename: str = "avatar.jpg",
        account_ids: Optional[list[int]] = None,
        delay_seconds: int = 3
    ) -> list[dict]:
        """Batch updates profile name, bio, and avatar for selected accounts."""
        op_id = f"profile_{uuid.uuid4().hex[:8]}"
        self._start_operation(op_id, "Update Profil Massal")
        results = []
        try:
            all_accounts = await TelegramAccountModel.list_by_user(user_id)
            if account_ids:
                accounts_to_process = [acc for acc in all_accounts if acc["id"] in account_ids]
            else:
                accounts_to_process = all_accounts

            if not accounts_to_process:
                return [{"status": "error", "message": "Tidak ada akun Telegram yang dipilih"}]

            for idx, acc in enumerate(accounts_to_process):
                if self._is_cancelled(op_id):
                    results.append({"account_id": 0, "name": "—", "status": "cancelled", "message": f"Proses dihentikan ({idx}/{len(accounts_to_process)} selesai)"})
                    break

                acc_id = acc["id"]
                acc_name = acc.get("display_name") or acc.get("phone_number") or f"Akun #{acc_id}"

                client = self._active_clients.get(acc_id)
                if not client or not client.is_connected():
                    connect_res = await self.connect_account(acc_id, user_id)
                    if connect_res.get("status") != "success":
                        results.append({
                            "account_id": acc_id,
                            "name": acc_name,
                            "status": "error",
                            "message": f"Gagal menghubungkan: {connect_res.get('message')}"
                        })
                        continue
                    client = self._active_clients.get(acc_id)

                try:
                    actions_done = []
                    # Update text profile (first_name, last_name, about)
                    if first_name is not None or last_name is not None or about is not None:
                        kwargs = {}
                        if first_name is not None and first_name != "":
                            kwargs["first_name"] = first_name
                        if last_name is not None and last_name != "":
                            kwargs["last_name"] = last_name
                        if about is not None and about != "":
                            kwargs["about"] = about[:70]

                        if kwargs:
                            await client(UpdateProfileRequest(**kwargs))
                            new_display = f"{kwargs.get('first_name', acc.get('display_name', ''))} {kwargs.get('last_name', '')}".strip()
                            if new_display:
                                await TelegramAccountModel.update_display_name(acc_id, new_display)
                            actions_done.append("Nama/Bio diubah")

                    # Update photo if provided
                    if photo_bytes:
                        file = await client.upload_file(io.BytesIO(photo_bytes), file_name=photo_filename)
                        await client(UploadProfilePhotoRequest(file=file))
                        actions_done.append("Foto profil diperbarui")

                    results.append({
                        "account_id": acc_id,
                        "name": acc_name,
                        "status": "success",
                        "message": ", ".join(actions_done) if actions_done else "Tidak ada perubahan profil"
                    })
                except FloodWaitError as e:
                    results.append({
                        "account_id": acc_id,
                        "name": acc_name,
                        "status": "flood_wait",
                        "message": f"FloodWait: Tunggu {e.seconds} detik"
                    })
                except Exception as e:
                    results.append({
                        "account_id": acc_id,
                        "name": acc_name,
                        "status": "error",
                        "message": str(e)
                    })

                if idx < len(accounts_to_process) - 1 and delay_seconds > 0:
                    await self._interruptible_sleep(delay_seconds, op_id)
        finally:
            self._finish_operation(op_id)

        return results

    # ------------------ Account Cleaner / Bersihkan Chat ------------------

    async def clean_account_dialogs(
        self,
        client: TelegramClient,
        leave_groups: bool = True,
        leave_channels: bool = True,
        delete_bots: bool = True,
        delete_pms: bool = False,
        max_dialogs: int = 100,
        delay_chat: float = 0.8,
        op_id: Optional[str] = None
    ) -> dict:
        """Iterates through dialogs and deletes / leaves them based on filter settings."""
        stats = {
            "groups_left": 0,
            "channels_left": 0,
            "bots_deleted": 0,
            "pms_deleted": 0,
            "total_cleaned": 0,
            "errors": 0
        }

        try:
            dialogs = await client.get_dialogs(limit=max_dialogs)

            for dialog in dialogs:
                if op_id and self._is_cancelled(op_id):
                    break

                should_delete = False
                category = ""

                # Check if group
                if dialog.is_group:
                    if leave_groups:
                        should_delete = True
                        category = "group"
                # Check if channel (not a group)
                elif dialog.is_channel:
                    if leave_channels:
                        should_delete = True
                        category = "channel"
                # Check if user
                elif dialog.is_user:
                    is_bot = getattr(dialog.entity, 'bot', False)
                    if is_bot and delete_bots:
                        should_delete = True
                        category = "bot"
                    elif not is_bot and delete_pms:
                        should_delete = True
                        category = "pm"

                if should_delete:
                    try:
                        await client.delete_dialog(dialog.input_entity, revoke=False)
                        stats["total_cleaned"] += 1
                        if category == "group":
                            stats["groups_left"] += 1
                        elif category == "channel":
                            stats["channels_left"] += 1
                        elif category == "bot":
                            stats["bots_deleted"] += 1
                        elif category == "pm":
                            stats["pms_deleted"] += 1

                        if delay_chat > 0:
                            await self._interruptible_sleep(delay_chat, op_id)
                    except FloodWaitError as e:
                        return {
                            "status": "flood_wait",
                            "stats": stats,
                            "message": f"FloodWait: Dihentikan sementara, tunggu {e.seconds} detik."
                        }
                    except Exception:
                        stats["errors"] += 1

            return {
                "status": "success",
                "stats": stats,
                "message": f"Selesai: {stats['groups_left']} grup, {stats['channels_left']} channel, {stats['bots_deleted']} bot, {stats['pms_deleted']} PM dibersihkan."
            }
        except Exception as e:
            return {
                "status": "error",
                "stats": stats,
                "message": f"Gagal membaca dialog: {str(e)}"
            }

    async def clean_dialogs_bulk(
        self,
        user_id: int,
        leave_groups: bool = True,
        leave_channels: bool = True,
        delete_bots: bool = True,
        delete_pms: bool = False,
        account_ids: Optional[list[int]] = None,
        max_dialogs: int = 100,
        delay_chat: float = 0.8,
        delay_account: int = 2
    ) -> list[dict]:
        """Cleans dialogs across specified or all user accounts."""
        op_id = f"clean_{uuid.uuid4().hex[:8]}"
        self._start_operation(op_id, "Bersihkan Chat Massal")
        results = []
        try:
            all_accounts = await TelegramAccountModel.list_by_user(user_id)
            if account_ids:
                accounts_to_process = [acc for acc in all_accounts if acc["id"] in account_ids]
            else:
                accounts_to_process = all_accounts

            if not accounts_to_process:
                return [{"status": "error", "message": "Tidak ada akun Telegram yang dipilih"}]

            for idx, acc in enumerate(accounts_to_process):
                if self._is_cancelled(op_id):
                    results.append({"account_id": 0, "name": "—", "status": "cancelled", "message": f"Proses dihentikan ({idx}/{len(accounts_to_process)} selesai)"})
                    break

                acc_id = acc["id"]
                acc_name = acc.get("display_name") or acc.get("phone_number") or f"Akun #{acc_id}"

                client = self._active_clients.get(acc_id)
                if not client or not client.is_connected():
                    connect_res = await self.connect_account(acc_id, user_id)
                    if connect_res.get("status") != "success":
                        results.append({
                            "account_id": acc_id,
                            "name": acc_name,
                            "status": "error",
                            "message": f"Gagal menghubungkan: {connect_res.get('message')}"
                        })
                        continue
                    client = self._active_clients.get(acc_id)

                res = await self.clean_account_dialogs(
                    client=client,
                    leave_groups=leave_groups,
                    leave_channels=leave_channels,
                    delete_bots=delete_bots,
                    delete_pms=delete_pms,
                    max_dialogs=max_dialogs,
                    delay_chat=delay_chat,
                    op_id=op_id
                )

                results.append({
                    "account_id": acc_id,
                    "name": acc_name,
                    "status": res["status"],
                    "stats": res.get("stats"),
                    "message": res["message"]
                })

                if idx < len(accounts_to_process) - 1 and delay_account > 0:
                    await self._interruptible_sleep(delay_account, op_id)
        finally:
            self._finish_operation(op_id)

        return results

    # ------------------ Contact Cleaner (Hapus Kontak Sinkron) ------------------

    async def delete_contacts_single(self, client: TelegramClient) -> dict:
        """Deletes all synchronized cloud contacts and all contact entities from Telegram account in milliseconds."""
        try:
            # 1. Reset saved contacts from Telegram cloud servers (instant)
            try:
                await client(ResetSavedRequest())
            except Exception:
                pass

            # 2. Fetch current contacts to delete mutual/explicit contact entries
            contacts_res = await client(GetContactsRequest(hash=0))
            deleted_count = 0

            if contacts_res and hasattr(contacts_res, 'users') and contacts_res.users:
                input_users = []
                for u in contacts_res.users:
                    if hasattr(u, 'id') and hasattr(u, 'access_hash'):
                        input_users.append(InputUser(u.id, u.access_hash))
                    else:
                        input_users.append(u)

                if input_users:
                    deleted_count = len(input_users)
                    # Delete all contacts simultaneously in 1 batch call (milidetik)
                    await client(DeleteContactsRequest(id=input_users))

            return {
                "status": "success",
                "deleted_count": deleted_count,
                "message": f"Berhasil menghapus kontak sinkron & {deleted_count} kontak akun"
            }
        except FloodWaitError as e:
            return {
                "status": "flood_wait",
                "deleted_count": 0,
                "message": f"FloodWait: Tunggu {e.seconds} detik"
            }
        except Exception as e:
            return {
                "status": "error",
                "deleted_count": 0,
                "message": f"Gagal menghapus kontak: {str(e)}"
            }

    async def delete_contacts_bulk(
        self,
        user_id: int,
        account_ids: Optional[list[int]] = None,
        delay_ms: int = 0
    ) -> list[dict]:
        """Deletes synchronized and saved contacts across user accounts with zero or custom millisecond delay."""
        op_id = f"contacts_{uuid.uuid4().hex[:8]}"
        self._start_operation(op_id, "Hapus Kontak Sinkron Massal")
        results = []

        try:
            all_accounts = await TelegramAccountModel.list_by_user(user_id)
            if account_ids:
                accounts_to_process = [acc for acc in all_accounts if acc["id"] in account_ids]
            else:
                accounts_to_process = all_accounts

            if not accounts_to_process:
                return [{"status": "error", "message": "Tidak ada akun Telegram yang dipilih"}]

            for idx, acc in enumerate(accounts_to_process):
                if self._is_cancelled(op_id):
                    results.append({"account_id": 0, "name": "—", "status": "cancelled", "deleted_count": 0, "message": f"Proses dihentikan ({idx}/{len(accounts_to_process)} selesai)"})
                    break

                acc_id = acc["id"]
                acc_name = acc.get("display_name") or acc.get("phone_number") or f"Akun #{acc_id}"

                client = self._active_clients.get(acc_id)
                if not client or not client.is_connected():
                    connect_res = await self.connect_account(acc_id, user_id)
                    if connect_res.get("status") != "success":
                        results.append({
                            "account_id": acc_id,
                            "name": acc_name,
                            "phone": acc.get("phone_number"),
                            "status": "error",
                            "deleted_count": 0,
                            "message": f"Gagal menghubungkan: {connect_res.get('message')}"
                        })
                        continue
                    client = self._active_clients.get(acc_id)

                res = await self.delete_contacts_single(client)
                results.append({
                    "account_id": acc_id,
                    "name": acc_name,
                    "phone": acc.get("phone_number"),
                    "status": res["status"],
                    "deleted_count": res.get("deleted_count", 0),
                    "message": res["message"]
                })

                # Safe or zero delay between accounts (in milliseconds)
                if idx < len(accounts_to_process) - 1 and delay_ms > 0:
                    await self._interruptible_sleep(delay_ms / 1000.0, op_id)
        finally:
            self._finish_operation(op_id)

        return results

    async def initialize(self):
        """Called on app startup."""
        pass

    async def disconnect_all(self):
        """Called on app shutdown: cleanly disconnects all running Telegram clients."""
        for client in list(self._active_clients.values()):
            try:
                await client.disconnect()
            except Exception:
                pass
        self._active_clients.clear()

client_manager = ClientManager()
