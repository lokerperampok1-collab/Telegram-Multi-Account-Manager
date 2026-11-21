import asyncio
import weakref
from contextlib import asynccontextmanager
import aiosqlite
from config import settings

DB_TIMEOUT_SECONDS = 30.0
_DB_WRITE_LOCKS: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Lock]" = weakref.WeakKeyDictionary()


def _get_write_lock() -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    lock = _DB_WRITE_LOCKS.get(loop)
    if lock is None:
        lock = asyncio.Lock()
        _DB_WRITE_LOCKS[loop] = lock
    return lock


@asynccontextmanager
async def db_connect(write: bool = False):
    """Async SQLite connection helper with WAL/busy_timeout and serialized writes per event loop."""
    if write:
        async with _get_write_lock():
            async with aiosqlite.connect(settings.DB_PATH, timeout=DB_TIMEOUT_SECONDS) as db:
                await db.execute("PRAGMA busy_timeout = 30000;")
                yield db
    else:
        async with aiosqlite.connect(settings.DB_PATH, timeout=DB_TIMEOUT_SECONDS) as db:
            await db.execute("PRAGMA busy_timeout = 30000;")
            yield db


async def get_db():
    """Async context manager / generator for database connection."""
    async with db_connect(write=False) as db:
        db.row_factory = aiosqlite.Row
        yield db

async def init_db():
    """Initialize database tables."""
    async with db_connect(write=True) as db:
        await db.execute("PRAGMA journal_mode = WAL;")
        await db.execute("PRAGMA synchronous = NORMAL;")
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
                spambot_status TEXT DEFAULT NULL,
                spambot_message TEXT DEFAULT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)
        # Safe migrations for existing databases
        for col_def in [
            "has_2fa BOOLEAN DEFAULT NULL",
            "twofa_hint TEXT DEFAULT NULL",
            "twofa_password TEXT DEFAULT NULL",
            "twofa_status TEXT DEFAULT NULL",
            "twofa_reset_until TEXT DEFAULT NULL",
            "spambot_status TEXT DEFAULT NULL",
            "spambot_message TEXT DEFAULT NULL"
        ]:
            try:
                await db.execute(f"ALTER TABLE telegram_accounts ADD COLUMN {col_def};")
            except Exception:
                pass

        await db.commit()
