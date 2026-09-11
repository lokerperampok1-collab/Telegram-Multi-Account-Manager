import base64
import os
from cryptography.fernet import Fernet
from config import settings

class EncryptionService:
    def __init__(self, key: str | None = None):
        raw_key = key or settings.ENCRYPTION_KEY
        if not raw_key:
            # Generate fallback key if empty
            raw_key = Fernet.generate_key().decode()
        
        # Ensure raw_key is a valid 32-byte urlsafe base64 string
        try:
            self.cipher = Fernet(raw_key.encode())
        except Exception:
            # If invalid format, pad or derive a valid key
            padded = base64.urlsafe_b64encode(raw_key.encode().ljust(32)[:32])
            self.cipher = Fernet(padded)

    def encrypt(self, plain_text: str) -> str:
        """Encrypts plaintext string into base64 ciphertext token."""
        if not plain_text:
            return ""
        return self.cipher.encrypt(plain_text.encode("utf-8")).decode("utf-8")

    def decrypt(self, cipher_text: str) -> str:
        """Decrypts base64 ciphertext token back into plaintext string."""
        if not cipher_text:
            return ""
        try:
            return self.cipher.decrypt(cipher_text.encode("utf-8")).decode("utf-8")
        except Exception as e:
            raise ValueError(f"Failed to decrypt session: {str(e)}")

encryption_service = EncryptionService()
