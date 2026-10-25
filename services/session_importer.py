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
from typing import List, Tuple
from telethon.sessions import SQLiteSession, StringSession

logger = logging.getLogger(__name__)

def sqlite_to_string_session(dc_id: int, server_address: str, port: int, auth_key_bytes: bytes) -> str:
    """Encodes DC, IP, Port, and 256-byte AuthKey into standard Telethon StringSession (version 1)."""
    ip = ipaddress.ip_address(server_address).packed
    data = struct.pack(f'>B{len(ip)}sH256s', dc_id, ip, port, auth_key_bytes)
    return '1' + base64.urlsafe_b64encode(data).decode('ascii')

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

def extract_strings_from_text(content_str: str) -> List[str]:
    """Finds all Telethon StringSessions inside text content."""
    results = []
    # 1. Line by line clean matching
    for line in content_str.splitlines():
        cleaned = line.strip().strip('"\' ,;{}[]')
        if cleaned.startswith('1') and len(cleaned) >= 200 and ' ' not in cleaned:
            results.append(cleaned)

    # 2. Fallback regex search for embedded strings
    if not results:
        found = re.findall(r'\b(1[A-Za-z0-9_-]{200,})\b', content_str)
        results.extend(found)

    # Remove duplicates preserving order
    return list(dict.fromkeys(results))

def extract_sessions_from_zip(zip_bytes: bytes) -> List[Tuple[str, str]]:
    """Extracts all .session, .txt, and .json files found inside a ZIP archive."""
    extracted = []
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            for name in zf.namelist():
                if name.endswith('/') or '__MACOSX' in name or name.startswith('.'):
                    continue
                file_bytes = zf.read(name)
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

def extract_sessions_from_file(filename: str, file_bytes: bytes) -> List[Tuple[str, str]]:
    """Universal parser that extracts list of (source_label, session_string) from any file type."""
    lower = filename.lower()
    clean_name = os.path.basename(filename) or filename

    # 1. ZIP Archive containing sessions
    if lower.endswith('.zip'):
        return extract_sessions_from_zip(file_bytes)

    # 2. Direct Telethon .session SQLite file
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
