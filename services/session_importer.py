import os
import io
import re
import base64
import struct
import sqlite3
import zipfile
import tempfile
import ipaddress
import logging
from typing import List, Optional, Tuple
from telethon.sessions import SQLiteSession, StringSession

try:
    import pyzipper
except ImportError:
    pyzipper = None

logger = logging.getLogger(__name__)

def sqlite_to_string_session(dc_id: int, server_address: str, port: int, auth_key_bytes: bytes) -> str:
    """Encodes DC, IP, Port, and 256-byte AuthKey into standard Telethon StringSession (version 1)."""
    ip = ipaddress.ip_address(server_address).packed
    data = struct.pack(f'>B{len(ip)}sH256s', dc_id, ip, port, auth_key_bytes)
    return '1' + base64.urlsafe_b64encode(data).decode('ascii')

def string_session_to_sqlite_bytes(session_str: str) -> bytes | None:
    """Converts a standard Telethon StringSession into raw bytes of an SQLite .session file."""
    if not session_str or not session_str.startswith('1'):
        return None
    try:
        s_loaded = StringSession(session_str)
        if not s_loaded.auth_key:
            return None

        with tempfile.NamedTemporaryFile(suffix='.session', delete=False) as f:
            tmp_path = f.name

        try:
            base_name = tmp_path[:-8] if tmp_path.endswith('.session') else tmp_path
            sq = SQLiteSession(base_name)
            sq._dc_id = s_loaded._dc_id
            sq._server_address = s_loaded._server_address
            sq._port = s_loaded._port
            sq._auth_key = s_loaded._auth_key
            sq._update_session_table()
            sq.save()
            sq.close()
            with open(tmp_path, 'rb') as f:
                return f.read()
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass
    except Exception as e:
        logger.warning(f"Error converting StringSession to SQLite: {e}")
        return None

def extract_string_from_session_bytes(session_bytes: bytes) -> str | None:
    """Extracts Telethon StringSession from raw .session SQLite file bytes."""
    with tempfile.NamedTemporaryFile(suffix='.session', delete=False) as tmp:
        tmp.write(session_bytes)
        tmp_path = tmp.name

    try:
        # Attempt 1: Direct SQLite reading
        try:
            conn = sqlite3.connect(tmp_path)
            cur = conn.cursor()
            cur.execute("SELECT dc_id, server_address, port, auth_key FROM sessions")
            row = cur.fetchone()
            conn.close()
            if row and row[3]:
                dc_id, server_address, port, auth_key = row
                if isinstance(auth_key, (bytes, bytearray)) and len(auth_key) == 256:
                    try:
                        return sqlite_to_string_session(int(dc_id), str(server_address), int(port), bytes(auth_key))
                    except Exception:
                        pass
        except Exception:
            pass

        # Attempt 2: Telethon SQLiteSession fallback
        try:
            base_path = tmp_path[:-8] if tmp_path.endswith('.session') else tmp_path
            sess = SQLiteSession(base_path)
            try:
                s = StringSession.save(sess)
                if s:
                    return s
            finally:
                sess.close()
        except Exception:
            pass
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass
    return None

DC_DEFAULT_IPS = {
    1: '149.154.175.53',
    2: '149.154.167.51',
    3: '149.154.175.100',
    4: '149.154.167.91',
    5: '91.108.56.130',
}

def hex_auth_key_to_string_session(hex_str: str, dc_id: int = 2) -> str | None:
    """Converts a 256-byte (512 hex chars) auth key and DC into standard Telethon StringSession."""
    try:
        clean_hex = hex_str.strip()
        if len(clean_hex) != 512:
            return None
        auth_key_bytes = bytes.fromhex(clean_hex)
        ip_str = DC_DEFAULT_IPS.get(int(dc_id), '91.108.56.130')
        return sqlite_to_string_session(int(dc_id), ip_str, 443, auth_key_bytes)
    except Exception:
        return None

def extract_strings_from_text(content_str: str) -> List[str]:
    """Finds all Telethon StringSessions inside text content, including hex_key:dc format."""
    results = []
    # 1. Line by line clean matching
    for line in content_str.splitlines():
        cleaned = line.strip().strip('"\' ,;{}[]')
        if not cleaned:
            continue
        # Standard Telethon StringSession
        if cleaned.startswith('1') and len(cleaned) >= 200 and ' ' not in cleaned:
            results.append(cleaned)
            continue
        # Raw AuthKey Hex format: <512_hex_chars>:<dc_id> or <dc_id>:<512_hex_chars>
        if ':' in cleaned:
            parts = cleaned.split(':')
            if len(parts) == 2:
                p1, p2 = parts[0].strip(), parts[1].strip()
                if len(p1) == 512 and p2.isdigit():
                    s = hex_auth_key_to_string_session(p1, int(p2))
                    if s:
                        results.append(s)
                        continue
                elif len(p2) == 512 and p1.isdigit():
                    s = hex_auth_key_to_string_session(p2, int(p1))
                    if s:
                        results.append(s)
                        continue
        # Bare 512 hex chars without DC (default to DC 5)
        if len(cleaned) == 512 and re.fullmatch(r'[0-9a-fA-F]{512}', cleaned):
            s = hex_auth_key_to_string_session(cleaned, 5)
            if s:
                results.append(s)
                continue

    # 2. Fallback regex search for embedded strings
    if not results:
        found = re.findall(r'\b(1[A-Za-z0-9_-]{200,})\b', content_str)
        results.extend(found)

    # Remove duplicates preserving order
    return list(dict.fromkeys(results))

def _read_zip_entry(zf, name: str, pwd_bytes: Optional[bytes]) -> bytes:
    """Reads a ZIP entry, applying pwd_bytes if the entry is encrypted."""
    is_encrypted = bool(zf.getinfo(name).flag_bits & 0x1)
    if is_encrypted and pwd_bytes:
        return zf.read(name, pwd=pwd_bytes)
    if pwd_bytes:
        try:
            return zf.read(name)
        except RuntimeError:
            return zf.read(name, pwd=pwd_bytes)
    return zf.read(name)


def extract_sessions_from_zip(zip_bytes: bytes, zip_password: Optional[str] = None) -> List[Tuple[str, str]]:
    """Extracts all .session, .txt, .json, and Nicegram tgnet.dat files found inside a ZIP archive (supports AES/ZipCrypto)."""
    extracted = []
    pwd_bytes = zip_password.encode('utf-8') if zip_password else None
    zip_cls = pyzipper.AESZipFile if pyzipper is not None else zipfile.ZipFile
    try:
        with zip_cls(io.BytesIO(zip_bytes)) as zf:
            namelist = zf.namelist()
            # First, check for Nicegram tgnet.dat files
            nicegram_folders = set()
            for name in namelist:
                if name.endswith('/') or '__MACOSX' in name or name.startswith('.'):
                    continue
                lower_name = name.lower()
                if lower_name.endswith('tgnet.dat'):
                    try:
                        from services.nicegram_converter import extract_session_from_nicegram_tgnet
                        file_bytes = _read_zip_entry(zf, name, pwd_bytes)
                        s = extract_session_from_nicegram_tgnet(file_bytes)
                        if s:
                            # Try to find associated session.json in the same folder
                            parent_dir = os.path.dirname(name)
                            nicegram_folders.add(parent_dir)
                            label = os.path.basename(parent_dir) or "Nicegram Account"
                            json_path = os.path.join(parent_dir, "session.json").replace("\\", "/")
                            if json_path in namelist:
                                try:
                                    j_bytes = _read_zip_entry(zf, json_path, pwd_bytes)
                                    j_data = json.loads(j_bytes.decode('utf-8', errors='ignore'))
                                    acc_name = j_data.get("name") or ""
                                    acc_id = j_data.get("id") or ""
                                    if acc_name and acc_id:
                                        label = f"{label} ({acc_name} #{acc_id})"
                                    elif acc_name:
                                        label = f"{label} ({acc_name})"
                                    elif acc_id:
                                        label = f"{label} (#{acc_id})"
                                except Exception:
                                    pass
                            extracted.append((label, s))
                    except Exception as e:
                        logger.warning(f"Error reading Nicegram tgnet from zip ({name}): {e}")

            # Second, handle standard .session, .txt, and .json
            for name in namelist:
                if name.endswith('/') or '__MACOSX' in name or name.startswith('.'):
                    continue
                parent_dir = os.path.dirname(name)
                # If this file is part of an already processed Nicegram folder, skip it
                if parent_dir in nicegram_folders:
                    continue

                try:
                    file_bytes = _read_zip_entry(zf, name, pwd_bytes)
                except Exception as e:
                    logger.warning(f"Error reading ZIP entry ({name}): {e}")
                    continue
                lower_name = name.lower()
                clean_name = os.path.basename(name) or name
                if lower_name.endswith('.session'):
                    s = extract_string_from_session_bytes(file_bytes)
                    if s:
                        extracted.append((clean_name, s))
                elif lower_name.endswith(('.txt', '.json')):
                    try:
                        text = file_bytes.decode('utf-8', errors='ignore')
                        sessions = extract_strings_from_text(text)
                        for idx, s in enumerate(sessions):
                            label = f"{clean_name} #{idx+1}" if len(sessions) > 1 else clean_name
                            extracted.append((label, s))
                    except Exception:
                        pass
    except Exception as e:
        logger.warning(f"Error parsing ZIP session archive: {e}")
    return extracted

def extract_sessions_from_file(filename: str, file_bytes: bytes, zip_password: Optional[str] = None) -> List[Tuple[str, str]]:
    """Universal parser that extracts list of (source_label, session_string) from any file type."""
    lower = filename.lower()
    clean_name = os.path.basename(filename) or filename

    # 1. ZIP Archive containing sessions (Telethon or Nicegram)
    if lower.endswith('.zip'):
        return extract_sessions_from_zip(file_bytes, zip_password=zip_password)

    # 2. Nicegram binary session (tgnet.dat)
    if lower.endswith('tgnet.dat') or lower.endswith('.dat'):
        try:
            from services.nicegram_converter import extract_session_from_nicegram_tgnet
            s = extract_session_from_nicegram_tgnet(file_bytes)
            if s:
                return [(clean_name, s)]
        except Exception:
            pass

    # 3. Direct Telethon .session SQLite file
    if lower.endswith('.session'):
        s = extract_string_from_session_bytes(file_bytes)
        if s:
            return [(clean_name, s)]
        return []

    # 3. Text or JSON file with StringSessions
    if lower.endswith(('.txt', '.json', '.csv')):
        try:
            text = file_bytes.decode('utf-8', errors='ignore')
            sessions = extract_strings_from_text(text)
            return [(f"{clean_name} #{i+1}" if len(sessions) > 1 else clean_name, s) for i, s in enumerate(sessions)]
        except Exception:
            return []

    # 4. Unknown extension: attempt SQLite session first, then text
    s = extract_string_from_session_bytes(file_bytes)
    if s:
        return [(clean_name, s)]

    try:
        text = file_bytes.decode('utf-8', errors='ignore')
        sessions = extract_strings_from_text(text)
        if sessions:
            return [(f"{clean_name} #{i+1}" if len(sessions) > 1 else clean_name, s) for i, s in enumerate(sessions)]
    except Exception:
        pass

    return []
