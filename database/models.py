import aiosqlite
from typing import Optional, List, Dict, Any
from datetime import datetime
from config import settings
from database.db import db_connect

class UserModel:
    _ALL_ACCESS_CACHE: Dict[tuple[str, int], bool] = {}
    @staticmethod
    async def create(username: str, password_hash: str) -> Optional[int]:
        async with db_connect(write=True) as db:
            cursor = await db.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (username, password_hash)
            )
            await db.commit()
            return cursor.lastrowid

    @staticmethod
    async def get_by_username(username: str) -> Optional[dict]:
        async with db_connect(write=False) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM users WHERE username = ?",
                (username,)
            )
            row = await cursor.fetchone()
            return dict(row) if row else None

    @staticmethod
    async def get_by_id(user_id: int) -> Optional[dict]:
        async with db_connect(write=False) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT id, username, created_at FROM users WHERE id = ?",
                (user_id,)
            )
            row = await cursor.fetchone()
            return dict(row) if row else None

    @staticmethod
    async def is_all_access_user(user_id: int) -> bool:
        """Returns True if the user is the special 'semua' supervisor user."""
        cache_key = (str(settings.DB_PATH), user_id)
        cached = UserModel._ALL_ACCESS_CACHE.get(cache_key)
        if cached is not None:
            return cached
        async with db_connect(write=False) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT username FROM users WHERE id = ?",
                (user_id,)
            )
            row = await cursor.fetchone()
            is_all = bool(row and (row["username"] or "").strip().lower() == "semua")
            UserModel._ALL_ACCESS_CACHE[cache_key] = is_all
            return is_all

    @staticmethod
    async def list_all_with_counts() -> List[dict]:
        """Lists all users with their Telegram account counts ('semua' first with total count)."""
        async with db_connect(write=False) as db:
            db.row_factory = aiosqlite.Row
            total_cur = await db.execute("SELECT COUNT(*) AS total_accounts FROM telegram_accounts")
            total_row = await total_cur.fetchone()
            total_accounts = total_row["total_accounts"] if total_row else 0

            cursor = await db.execute(
                """
                SELECT u.id, u.username, COUNT(ta.id) AS own_count
                FROM users u
                LEFT JOIN telegram_accounts ta ON ta.user_id = u.id
                GROUP BY u.id, u.username
                ORDER BY CASE WHEN LOWER(u.username) = 'semua' THEN 0 ELSE 1 END, u.id ASC
                """
            )
            rows = await cursor.fetchall()
            result = []
            for row in rows:
                uname = row["username"]
                is_all = (uname or "").strip().lower() == "semua"
                result.append({
                    "id": row["id"],
                    "username": uname,
                    "account_count": total_accounts if is_all else row["own_count"],
                })
            return result


class TelegramAccountModel:
    @staticmethod
    async def get_by_phone(user_id: int, phone_number: str) -> Optional[dict]:
        """Retrieves account by phone number for a user to detect duplicates."""
        async with db_connect(write=False) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM telegram_accounts WHERE user_id = ? AND phone_number = ?",
                (user_id, phone_number)
            )
            row = await cursor.fetchone()
            return dict(row) if row else None

    @staticmethod
    async def get_by_telegram_id(user_id: int, telegram_id: int) -> Optional[dict]:
        """Retrieves account by telegram user id to detect duplicates."""
        async with db_connect(write=False) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM telegram_accounts WHERE user_id = ? AND telegram_id = ?",
                (user_id, telegram_id)
            )
            row = await cursor.fetchone()
            return dict(row) if row else None

    @staticmethod
    async def upsert(
        user_id: int,
        session_string: str,
        phone_number: Optional[str] = None,
        display_name: Optional[str] = None,
        username: Optional[str] = None,
        telegram_id: Optional[int] = None,
        is_active: bool = True
    ) -> tuple[int, bool]:
        """
        Inserts new account or updates existing account if telegram_id or phone_number already exists.
        Guarantees 100% no duplicate account cards in dashboard.
        Returns: (account_id, is_updated: bool)
        """
        async with db_connect(write=True) as db:
            db.row_factory = aiosqlite.Row

            existing = None
            if telegram_id:
                cur = await db.execute(
                    "SELECT id FROM telegram_accounts WHERE user_id = ? AND telegram_id = ?",
                    (user_id, telegram_id)
                )
                existing = await cur.fetchone()

            if not existing and phone_number:
                cur = await db.execute(
                    "SELECT id FROM telegram_accounts WHERE user_id = ? AND phone_number = ?",
                    (user_id, phone_number)
                )
                existing = await cur.fetchone()

            if existing:
                account_id = existing["id"]
                await db.execute(
                    """
                    UPDATE telegram_accounts 
                    SET session_string = ?,
                        phone_number = COALESCE(?, phone_number),
                        display_name = COALESCE(?, display_name),
                        username = COALESCE(?, username),
                        telegram_id = COALESCE(?, telegram_id),
                        is_active = ?,
                        last_connected = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (session_string, phone_number, display_name, username, telegram_id, 1 if is_active else 0, account_id)
                )
                await db.commit()
                return account_id, True
            else:
                cursor = await db.execute(
                    """
                    INSERT INTO telegram_accounts 
                    (user_id, phone_number, display_name, username, telegram_id, session_string, is_active, last_connected)
                    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    """,
                    (user_id, phone_number, display_name, username, telegram_id, session_string, 1 if is_active else 0)
                )
                await db.commit()
                return cursor.lastrowid, False

    @staticmethod
    async def list_by_user(user_id: int) -> List[dict]:
        is_all = await UserModel.is_all_access_user(user_id)
        async with db_connect(write=False) as db:
            db.row_factory = aiosqlite.Row
            if is_all:
                cursor = await db.execute(
                    """
                    SELECT id, user_id, phone_number, display_name, username, telegram_id, is_active, last_connected, added_at,
                           has_2fa, twofa_hint, twofa_password, twofa_status, twofa_reset_until
                    FROM telegram_accounts
                    ORDER BY id DESC
                    """
                )
            else:
                cursor = await db.execute(
                    """
                    SELECT id, user_id, phone_number, display_name, username, telegram_id, is_active, last_connected, added_at,
                           has_2fa, twofa_hint, twofa_password, twofa_status, twofa_reset_until
                    FROM telegram_accounts
                    WHERE user_id = ?
                    ORDER BY id DESC
                    """,
                    (user_id,)
                )
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]

    @staticmethod
    async def list_paginated(
        user_id: int,
        page: int = 1,
        limit: int = 50,
        search: Optional[str] = None,
        status: Optional[str] = None,
        telegram_id_filter: Optional[str] = None,
        id_filter: Optional[str] = None,
        twofa_filter: Optional[str] = None,
        spambot_filter: Optional[str] = None,
        sort: Optional[str] = "id_desc"
    ) -> Dict[str, Any]:
        """Returns paginated and filtered accounts for high scalability (100-1000+ accounts)."""
        is_all = await UserModel.is_all_access_user(user_id)
        async with db_connect(write=False) as db:
            db.row_factory = aiosqlite.Row

            if is_all:
                where_clauses = ["1=1"]
                params = []
            else:
                where_clauses = ["user_id = ?"]
                params = [user_id]

            if search and search.strip():
                clean_s = search.strip()
                s = f"%{clean_s}%"
                s_prefix = f"{clean_s}%"
                # Search matches Telegram ID prefix, phone, name, username, or spambot info
                where_clauses.append("(CAST(telegram_id AS TEXT) LIKE ? OR phone_number LIKE ? OR display_name LIKE ? OR username LIKE ? OR spambot_status LIKE ? OR spambot_message LIKE ?)")
                params.extend([s_prefix, s, s, s, s, s])

            # Telegram ID prefix search: e.g. "62", "78", or comma-separated "62, 78"
            target_tg_filter = telegram_id_filter or id_filter
            if target_tg_filter and target_tg_filter.strip():
                clean_tg = target_tg_filter.strip().replace(" ", "").replace("#", "")
                if "," in clean_tg:
                    sub_clauses = []
                    for chunk in clean_tg.split(","):
                        c = chunk.strip()
                        if c:
                            sub_clauses.append("CAST(telegram_id AS TEXT) LIKE ?")
                            params.append(f"{c}%")
                    if sub_clauses:
                        where_clauses.append(f"({' OR '.join(sub_clauses)})")
                else:
                    where_clauses.append("CAST(telegram_id AS TEXT) LIKE ?")
                    params.append(f"{clean_tg}%")

            if status == "active":
                where_clauses.append("is_active = 1")
            elif status == "inactive":
                where_clauses.append("is_active = 0")

            # 2FA Filter
            if twofa_filter == "matched":
                where_clauses.append("twofa_password IS NOT NULL")
            elif twofa_filter == "mismatch":
                where_clauses.append("twofa_status = 'mismatch'")
            elif twofa_filter == "reset_pending":
                where_clauses.append("(twofa_status = 'reset_pending' OR twofa_reset_until IS NOT NULL)")
            elif twofa_filter == "enabled":
                where_clauses.append("has_2fa = 1")
            elif twofa_filter == "disabled":
                where_clauses.append("has_2fa = 0")
            elif twofa_filter == "unknown":
                where_clauses.append("has_2fa IS NULL")

            # SpamBot Health Filter
            if spambot_filter == "frozen":
                where_clauses.append("spambot_status = 'frozen'")
            elif spambot_filter == "perm_limited":
                where_clauses.append("spambot_status = 'perm_limited'")
            elif spambot_filter == "geo_limited":
                where_clauses.append("spambot_status = 'geo_limited'")
            elif spambot_filter == "temp_limited":
                where_clauses.append("spambot_status = 'temp_limited'")
            elif spambot_filter == "content_limited":
                where_clauses.append("spambot_status = 'content_limited'")
            elif spambot_filter == "other_limited":
                where_clauses.append("spambot_status = 'limited'")
            elif spambot_filter == "clean":
                where_clauses.append("spambot_status = 'clean'")
            elif spambot_filter == "banned":
                where_clauses.append("spambot_status = 'banned'")
            elif spambot_filter == "limited":
                where_clauses.append("spambot_status IN ('perm_limited', 'geo_limited', 'temp_limited', 'content_limited', 'limited')")
            elif spambot_filter == "problematic":
                where_clauses.append("spambot_status IN ('frozen', 'perm_limited', 'geo_limited', 'temp_limited', 'content_limited', 'limited', 'banned')")
            elif spambot_filter == "unverified":
                where_clauses.append("spambot_status IS NULL")

            where_sql = " AND ".join(where_clauses)

            count_cur = await db.execute(f"SELECT COUNT(*) as count FROM telegram_accounts WHERE {where_sql}", params)
            count_row = await count_cur.fetchone()
            total = count_row["count"] if count_row else 0

            p = max(1, page)
            l = limit if limit > 0 else (total or 50)

            # Sort order
            if sort == "tg_id_asc":
                order_by = "telegram_id ASC"
            elif sort == "tg_id_desc":
                order_by = "telegram_id DESC"
            elif sort == "id_asc":
                order_by = "id ASC"
            elif sort == "id_desc":
                order_by = "id DESC"
            else:
                order_by = "id DESC"

            query = f"""
                SELECT id, user_id, phone_number, display_name, username, telegram_id, is_active, last_connected, added_at,
                       has_2fa, twofa_hint, twofa_password, twofa_status, twofa_reset_until,
                       spambot_status, spambot_message
                FROM telegram_accounts
                WHERE {where_sql}
                ORDER BY {order_by}
            """
            if limit > 0:
                offset = (p - 1) * l
                query += " LIMIT ? OFFSET ?"
                query_params = params + [l, offset]
            else:
                query_params = params

            cursor = await db.execute(query, query_params)
            rows = await cursor.fetchall()
            items = [dict(r) for r in rows]

            total_pages = max(1, (total + l - 1) // l) if l > 0 else 1

            return {
                "items": items,
                "total": total,
                "page": p,
                "limit": l,
                "total_pages": total_pages
            }

    @staticmethod
    async def get_by_id(account_id: int, user_id: int) -> Optional[dict]:
        is_all = await UserModel.is_all_access_user(user_id)
        async with db_connect(write=False) as db:
            db.row_factory = aiosqlite.Row
            if is_all:
                cursor = await db.execute(
                    "SELECT * FROM telegram_accounts WHERE id = ?",
                    (account_id,)
                )
            else:
                cursor = await db.execute(
                    "SELECT * FROM telegram_accounts WHERE id = ? AND user_id = ?",
                    (account_id, user_id)
                )
            row = await cursor.fetchone()
            return dict(row) if row else None

    @staticmethod
    async def update_status(account_id: int, is_active: bool):
        async with db_connect(write=True) as db:
            await db.execute(
                """
                UPDATE telegram_accounts 
                SET is_active = ?, last_connected = CURRENT_TIMESTAMP 
                WHERE id = ?
                """,
                (1 if is_active else 0, account_id)
            )
            await db.commit()

    @staticmethod
    async def update_2fa_status(
        account_id: int,
        has_2fa: bool,
        hint: Optional[str] = None,
        twofa_password: Optional[str] = None,
        twofa_status: Optional[str] = None,
        twofa_reset_until: Optional[str] = None
    ):
        """Updates the 2FA status, password hint, confirmed password, and reset status for an account."""
        async with db_connect(write=True) as db:
            await db.execute(
                """
                UPDATE telegram_accounts 
                SET has_2fa = ?, twofa_hint = ?, twofa_password = ?, twofa_status = ?, twofa_reset_until = ?
                WHERE id = ?
                """,
                (1 if has_2fa else 0, hint, twofa_password, twofa_status, twofa_reset_until, account_id)
            )
            await db.commit()

    @staticmethod
    async def list_by_user_with_sessions(user_id: int) -> List[dict]:
        """Returns accounts including encrypted session strings for export/backup."""
        is_all = await UserModel.is_all_access_user(user_id)
        async with db_connect(write=False) as db:
            db.row_factory = aiosqlite.Row
            if is_all:
                cursor = await db.execute(
                    """
                    SELECT id, user_id, phone_number, display_name, username, telegram_id, session_string, is_active, last_connected, added_at,
                           has_2fa, twofa_hint, twofa_password, twofa_status, twofa_reset_until,
                           spambot_status, spambot_message
                    FROM telegram_accounts
                    ORDER BY id DESC
                    """
                )
            else:
                cursor = await db.execute(
                    """
                    SELECT id, user_id, phone_number, display_name, username, telegram_id, session_string, is_active, last_connected, added_at,
                           has_2fa, twofa_hint, twofa_password, twofa_status, twofa_reset_until,
                           spambot_status, spambot_message
                    FROM telegram_accounts
                    WHERE user_id = ?
                    ORDER BY id DESC
                    """,
                    (user_id,)
                )
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]

    @staticmethod
    async def update_spambot_status(account_id: int, spambot_status: Optional[str], spambot_message: Optional[str] = None):
        """Updates SpamBot check status and message for an account."""
        async with db_connect(write=True) as db:
            await db.execute(
                "UPDATE telegram_accounts SET spambot_status = ?, spambot_message = ? WHERE id = ?",
                (spambot_status, spambot_message, account_id)
            )
            await db.commit()

    @staticmethod
    async def get_distinct_2fa_passwords(user_id: int) -> List[str]:
        """Returns distinct non-empty 2FA passwords saved across this user's accounts."""
        is_all = await UserModel.is_all_access_user(user_id)
        async with db_connect(write=False) as db:
            if is_all:
                cursor = await db.execute(
                    """
                    SELECT DISTINCT twofa_password
                    FROM telegram_accounts
                    WHERE twofa_password IS NOT NULL AND twofa_password != ''
                    """
                )
            else:
                cursor = await db.execute(
                    """
                    SELECT DISTINCT twofa_password
                    FROM telegram_accounts
                    WHERE user_id = ? AND twofa_password IS NOT NULL AND twofa_password != ''
                    """,
                    (user_id,)
                )
            rows = await cursor.fetchall()
            return [str(r[0]) for r in rows if r and r[0]]

    @staticmethod
    async def update_display_name(account_id: int, display_name: str):
        async with db_connect(write=True) as db:
            await db.execute(
                "UPDATE telegram_accounts SET display_name = ? WHERE id = ?",
                (display_name, account_id)
            )
            await db.commit()

    @staticmethod
    async def delete(account_id: int, user_id: int) -> bool:
        is_all = await UserModel.is_all_access_user(user_id)
        async with db_connect(write=True) as db:
            if is_all:
                cursor = await db.execute(
                    "DELETE FROM telegram_accounts WHERE id = ?",
                    (account_id,)
                )
            else:
                cursor = await db.execute(
                    "DELETE FROM telegram_accounts WHERE id = ? AND user_id = ?",
                    (account_id, user_id)
                )
            await db.commit()
            return cursor.rowcount > 0

    @staticmethod
    async def delete_many(user_id: int, account_ids: Optional[List[int]] = None) -> int:
        """Deletes all or specified accounts belonging to user_id from DB. Returns deleted row count."""
        is_all = await UserModel.is_all_access_user(user_id)
        async with db_connect(write=True) as db:
            if account_ids is None:
                if is_all:
                    cursor = await db.execute("DELETE FROM telegram_accounts")
                else:
                    cursor = await db.execute(
                        "DELETE FROM telegram_accounts WHERE user_id = ?",
                        (user_id,)
                    )
                await db.commit()
                return cursor.rowcount

            unique_ids = list(dict.fromkeys(account_ids))
            if not unique_ids:
                return 0

            total_deleted = 0
            chunk_size = 500
            for i in range(0, len(unique_ids), chunk_size):
                chunk = unique_ids[i:i + chunk_size]
                placeholders = ",".join("?" for _ in chunk)
                if is_all:
                    cursor = await db.execute(
                        f"DELETE FROM telegram_accounts WHERE id IN ({placeholders})",
                        chunk
                    )
                else:
                    cursor = await db.execute(
                        f"DELETE FROM telegram_accounts WHERE user_id = ? AND id IN ({placeholders})",
                        [user_id, *chunk]
                    )
                total_deleted += cursor.rowcount
            await db.commit()
            return total_deleted
