import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env file from project root
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

class Settings:
    BASE_DIR: Path = BASE_DIR
    DB_PATH: Path = BASE_DIR / "telegram_manager.db"
    
    API_ID: int = int(os.getenv("API_ID", "0") or "0")
    API_HASH: str = os.getenv("API_HASH", "").strip()
    
    SECRET_KEY: str = os.getenv("SECRET_KEY", "default-secret-key-please-change-12345678")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    
    ENCRYPTION_KEY: str = os.getenv("ENCRYPTION_KEY", "").strip()
    
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    DEBUG: bool = os.getenv("DEBUG", "false").lower() in ("true", "1", "yes")

settings = Settings()
