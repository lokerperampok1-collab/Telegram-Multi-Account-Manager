import aiosqlite
from typing import Optional, List, Dict, Any
from datetime import datetime
from config import settings

class UserModel:
    @staticmethod
    async def create(username: str, password_hash: str) -> Optional[int]:
        async with aiosqlite.connect(settings.DB_PATH) as db:
            cursor = await db.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (username, password_hash)
            )
            await db.commit()
            return cursor.lastrowid

    @staticmethod
    async def get_by_username(username: str) -> Optional[dict]:
        async with aiosqlite.connect(settings.DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM users WHERE username = ?",
                (username,)
            )
            row = await cursor.fetchone()
            return dict(row) if row else None

    @staticmethod
    async def get_by_id(user_id: int) -> Optional[dict]:
        async with aiosqlite.connect(settings.DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT id, username, created_at FROM users WHERE id = ?",
                (user_id,)
            )
            row = await cursor.fetchone()
            return dict(row) if row else None


class TelegramAccountModel:
    @staticmethod
    async def get_by_phone(user_id: int, phone_number: str) -> Optional[dict]:
        """Retrieves account by phone number for a user to detect duplicates."""
        async with aiosqlite.connect(settings.DB_PATH) as db:
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
        async with aiosqlite.connect(settings.DB_PATH) as db:
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
        async with aiosqlite.connect(settings.DB_PATH) as db:
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
        async with aiosqlite.connect(settings.DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                """
                SELECT id, user_id, phone_number, display_name, username, telegram_id, is_active, last_connected, added_at
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
        sort: Optional[str] = "id_desc"
    ) -> Dict[str, Any]:
        """Returns paginated and filtered accounts for high scalability (100-1000+ accounts)."""
        async with aiosqlite.connect(settings.DB_PATH) as db:
            db.row_factory = aiosqlite.Row

            where_clauses = ["user_id = ?"]
            params = [user_id]

            if search and search.strip():
                clean_s = search.strip()
                s = f"%{clean_s}%"
                s_prefix = f"{clean_s}%"
                # Search matches Telegram ID prefix, phone, name, or username
                where_clauses.append("(CAST(telegram_id AS TEXT) LIKE ? OR phone_number LIKE ? OR display_name LIKE ? OR username LIKE ?)")
                params.extend([s_prefix, s, s, s])

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
                SELECT id, user_id, phone_number, display_name, username, telegram_id, is_active, last_connected, added_at
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
        async with aiosqlite.connect(settings.DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM telegram_accounts WHERE id = ? AND user_id = ?",
                (account_id, user_id)
            )
            row = await cursor.fetchone()
            return dict(row) if row else None

    @staticmethod
    async def update_status(account_id: int, is_active: bool):
        async with aiosqlite.connect(settings.DB_PATH) as db:
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
    async def list_by_user_with_sessions(user_id: int) -> List[dict]:
        """Returns accounts including encrypted session strings for export/backup."""
        async with aiosqlite.connect(settings.DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                """
                SELECT id, user_id, phone_number, display_name, username, telegram_id, session_string, is_active, last_connected, added_at
                FROM telegram_accounts
                WHERE user_id = ?
                ORDER BY id DESC
                """,
                (user_id,)
            )
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]

    @staticmethod
    async def update_display_name(account_id: int, display_name: str):
        async with aiosqlite.connect(settings.DB_PATH) as db:
            await db.execute(
                "UPDATE telegram_accounts SET display_name = ? WHERE id = ?",
                (display_name, account_id)
            )
            await db.commit()

    @staticmethod
    async def delete(account_id: int, user_id: int) -> bool:
        async with aiosqlite.connect(settings.DB_PATH) as db:
            cursor = await db.execute(
                "DELETE FROM telegram_accounts WHERE id = ? AND user_id = ?",
                (account_id, user_id)
            )
            await db.commit()
            return cursor.rowcount > 0
