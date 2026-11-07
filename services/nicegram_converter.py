import os
import io
import json
import base64
import struct
import zipfile
import logging
from typing import Optional, List, Dict, Tuple

from services.tgnet import NativeByteBuffer, TGAndroidSession
from services.session_importer import sqlite_to_string_session
from telethon.sessions import StringSession

logger = logging.getLogger(__name__)

RESOURCES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "resources")


def get_nicegram_template_tgnet() -> bytes:
    """Loads the base template tgnet.dat containing pre-configured Telegram DCs 1-5."""
    path = os.path.join(RESOURCES_DIR, "nicegram_tgnet.dat")
    if os.path.exists(path):
        with open(path, "rb") as f:
            return f.read()
    raise FileNotFoundError(f"Template tgnet.dat not found at {path}")


def get_nicegram_support_files() -> Dict[str, bytes]:
    """Returns static supporting files required by Nicegram for an account folder."""
    files = {}

    support_names = [
        ("stats2.dat", b"\x00" * 612),
        ("dc1conf.dat", b"\x24\x00\x00\x00\x01\x00\x00\x00" + b"\x00" * 32),
        ("dc2conf.dat", b"\x24\x00\x00\x00\x01\x00\x00\x00" + b"\x00" * 32),
        ("dc4conf.dat", b"\x24\x00\x00\x00\x01\x00\x00\x00" + b"\x00" * 32),
        ("profileinstaller_profileWrittenFor_lastUpdateTime.dat", struct.pack(">Q", 1793779494000)),
    ]

    for filename, default_bytes in support_names:
        res_path = os.path.join(RESOURCES_DIR, f"nicegram_{filename}")
        if os.path.exists(res_path):
            with open(res_path, "rb") as f:
                files[filename] = f.read()
        else:
            files[filename] = default_bytes

    return files


def serialize_tl_string(s: str) -> bytes:
    """Encodes a string in MTProto TL wire format with proper length prefix and 4-byte padding."""
    if not s:
        return b"\x00\x00\x00\x00"
    encoded = s.encode("utf-8")
    l = len(encoded)
    if l < 254:
        res = bytes([l]) + encoded
        padding = (4 - (len(res) % 4)) % 4
        return res + (b"\x00" * padding)
    else:
        res = b"\xfe" + struct.pack("<I", l)[:3] + encoded
        padding = (4 - (len(res) % 4)) % 4
        return res + (b"\x00" * padding)


def build_nicegram_user_base64(
    user_id: int,
    phone: str,
    first_name: str,
    last_name: str = "",
    access_hash: int = 0
) -> str:
    """Serializes a Telegram User object in binary TL format (constructor 0xb1b8cc83) and base64 encodes it."""
    # flags: self | contact | mutual_contact | access_hash | phone | first_name | last_name
    flags = 0x02000457
    flags2 = 0x00000010

    clean_phone = (phone or "").replace("+", "").strip()

    buf = bytearray()
    buf.extend(struct.pack("<I", 0xb1b8cc83))
    buf.extend(struct.pack("<I", flags))
    buf.extend(struct.pack("<I", flags2))
    buf.extend(struct.pack("<q", int(user_id or 0)))
    buf.extend(struct.pack("<q", int(access_hash or 0)))
    buf.extend(serialize_tl_string(first_name or "Telegram User"))
    buf.extend(serialize_tl_string(last_name or ""))
    buf.extend(serialize_tl_string(clean_phone))
    buf.extend(struct.pack("<q", 0))  # photo placeholder

    return base64.b64encode(bytes(buf)).decode("ascii")


def telethon_to_nicegram_account(
    account_data: dict,
    account_index: int = 0
) -> Dict[str, bytes]:
    """
    Converts a single Telethon account (with decrypted session_string)
    into Nicegram's folder files:
    - account{N}/tgnet.dat
    - account{N}/session.json
    - account{N}/stats2.dat
    - account{N}/dc*conf.dat
    """
    session_str = account_data.get("session_string") or ""
    if not session_str or not session_str.startswith("1"):
        raise ValueError(f"Sesi akun #{account_data.get('id')} tidak valid atau kosong")

    s_telethon = StringSession(session_str)
    if not s_telethon.auth_key or not s_telethon.auth_key.key:
        raise ValueError(f"Auth key akun #{account_data.get('id')} tidak ditemukan dalam StringSession")

    dc_id = int(s_telethon.dc_id or 2)
    auth_key_bytes = bytes(s_telethon.auth_key.key)

    # 1. Generate tgnet.dat
    template_bytes = get_nicegram_template_tgnet()
    buf = NativeByteBuffer(template_bytes)
    tg_session = TGAndroidSession.deserialize(buf)

    tg_session.headers.currentDatacenterId = dc_id

    # Find target DC in template (1-indexed)
    target_dc = None
    for dc in tg_session.datacenters:
        if dc.datacenterId == dc_id:
            target_dc = dc
            break

    if target_dc is None:
        target_dc = tg_session.datacenters[0]
        tg_session.headers.currentDatacenterId = target_dc.datacenterId

    target_dc.auth.authKeyPerm = auth_key_bytes

    out_buf = NativeByteBuffer(bytearray())
    tg_session.serialize(out_buf)
    tgnet_bytes = bytes(out_buf.buffer.getvalue())

    # 2. Generate session.json
    tg_id = account_data.get("telegram_id") or 0
    display_name = account_data.get("display_name") or ""
    phone = account_data.get("phone_number") or ""

    name_parts = display_name.split(" ", 1)
    first_name = name_parts[0] if name_parts else (phone or f"Akun #{account_data.get('id')}")
    last_name = name_parts[1] if len(name_parts) > 1 else ""

    user_base64 = build_nicegram_user_base64(
        user_id=int(tg_id),
        phone=phone,
        first_name=first_name,
        last_name=last_name
    )

    session_json_data = {
        "user": user_base64,
        "id": str(tg_id) if tg_id else str(account_data.get("id")),
        "name": display_name or phone or f"Akun #{account_data.get('id')}",
        "extra": "Nicegram Pro, Android",
        "appVersion": "1.64.0",
        "format": 1,
    }
    session_json_bytes = json.dumps(session_json_data, ensure_ascii=False, indent=2).encode("utf-8")

    # 3. Assemble all files under account{N}/
    folder_prefix = f"account{account_index}/"
    result = {
        f"{folder_prefix}tgnet.dat": tgnet_bytes,
        f"{folder_prefix}session.json": session_json_bytes,
    }

    support_files = get_nicegram_support_files()
    for fname, fbytes in support_files.items():
        result[f"{folder_prefix}{fname}"] = fbytes

    return result


def export_nicegram_zip(accounts_data: List[dict]) -> bytes:
    """
    Takes a list of account dicts and packages them into a Nicegram-compatible ZIP archive:
    account0/session.json, account0/tgnet.dat, account1/..., etc.
    """
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        account_idx = 0
        for acc in accounts_data:
            session_str = acc.get("session_string")
            if not session_str or not session_str.strip():
                continue
            try:
                acc_files = telethon_to_nicegram_account(acc, account_index=account_idx)
                for path, data in acc_files.items():
                    zf.writestr(path, data)
                account_idx += 1
            except Exception as e:
                logger.warning(f"Gagal mengonversi akun #{acc.get('id')} ke Nicegram: {e}")

    zip_buf.seek(0)
    return zip_buf.getvalue()


def extract_session_from_nicegram_tgnet(tgnet_bytes: bytes) -> Optional[str]:
    """
    Extracts a standard Telethon StringSession from a raw Nicegram tgnet.dat file.
    """
    try:
        buf = NativeByteBuffer(tgnet_bytes)
        s = TGAndroidSession.deserialize(buf)

        current_dc_id = s.headers.currentDatacenterId
        current_dc = None
        for dc in s.datacenters:
            if dc.datacenterId == current_dc_id:
                current_dc = dc
                break

        if not current_dc or not current_dc.auth.authKeyPerm:
            return None

        auth_key = current_dc.auth.authKeyPerm
        if len(auth_key) != 256:
            return None

        # Find preferred IPv4 address
        ipv4_ip = None
        port = 443
        for ip_list in current_dc.ips:
            for ip_obj in ip_list:
                if ":" not in ip_obj.address:
                    ipv4_ip = ip_obj.address
                    port = ip_obj.port
                    break
            if ipv4_ip:
                break

        if not ipv4_ip:
            dc_defaults = {
                1: "149.154.175.50",
                2: "149.154.167.50",
                3: "149.154.175.100",
                4: "149.154.167.91",
                5: "149.154.171.5",
            }
            ipv4_ip = dc_defaults.get(current_dc_id, "149.154.167.50")

        return sqlite_to_string_session(current_dc_id, ipv4_ip, port, auth_key)
    except Exception as e:
        logger.warning(f"Gagal mengekstrak sesi dari tgnet.dat Nicegram: {e}")
        return None

