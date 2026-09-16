import aiosqlite
from config import settings

async def get_db():
    """Async context manager / generator for database connection."""
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        yield db

async def init_db():
    """Initialize database tables."""
    async with aiosqlite.connect(settings.DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        
        await db.execute("""
            CREATE TABLE IF NOT EXISTS telegram_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                phone_number TEXT,
                display_name TEXT,
                username TEXT,
                telegram_id INTEGER,
                session_string TEXT NOT NULL,
                is_active BOOLEAN DEFAULT 0,
                last_connected TIMESTAMP,
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                has_2fa BOOLEAN DEFAULT NULL,
                twofa_hint TEXT DEFAULT NULL,
                twofa_password TEXT DEFAULT NULL,
                twofa_status TEXT DEFAULT NULL,
                twofa_reset_until TEXT DEFAULT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)
        # Safe migrations for existing databases
        for col_def in [
            "has_2fa BOOLEAN DEFAULT NULL",
            "twofa_hint TEXT DEFAULT NULL",
            "twofa_password TEXT DEFAULT NULL",
            "twofa_status TEXT DEFAULT NULL",
            "twofa_reset_until TEXT DEFAULT NULL"
        ]:
            try:
                await db.execute(f"ALTER TABLE telegram_accounts ADD COLUMN {col_def};")
            except Exception:
                pass

        await db.commit()
