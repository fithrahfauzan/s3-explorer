import os
import secrets
from typing import List, Optional
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

# Ensure .env variables are loaded into os.environ
load_dotenv()

class BucketConfig(BaseModel):
    id: str
    bucket_name: str
    region: str
    auth_type: str = Field(pattern="^(irsa|manual)$")
    access_key: Optional[str] = None
    secret_key: Optional[str] = None

class Settings(BaseSettings):
    CORS_ORIGINS: List[str] = ["*"]
    # Global app mode. When True: delete is disabled everywhere, and uploads
    # only ever hand back a presigned URL for the user to use manually
    # (e.g. via curl) instead of the backend/browser performing the upload.
    RESTRICTED_MODE: bool = False

    # When set, every /api route (except /api/health and /api/auth/*)
    # requires a valid session cookie obtained by posting this password to
    # /api/auth/login. Leave unset to disable auth entirely (open access) —
    # useful for local dev, but should always be set in any shared deployment.
    AUTH_PASSWORD: Optional[str] = None
    # Signs the session cookie. Auto-generated per process start if not
    # given, which means every restart invalidates existing sessions — set
    # this explicitly to keep sessions alive across restarts/replicas.
    SESSION_SECRET: str = Field(default_factory=lambda: secrets.token_hex(32))
    # Marks the session cookie Secure (HTTPS-only). Only turn this off for
    # local development over plain HTTP.
    SESSION_SECURE_COOKIE: bool = True

    def load_buckets(self) -> List[BucketConfig]:
        buckets = []
        # Find all bucket indices from env vars
        indices = set()
        for key in os.environ:
            if key.startswith("BUCKET_") and key.endswith("_ID"):
                parts = key.split("_")
                # Expected format: BUCKET_{INDEX}_ID
                if len(parts) >= 3:
                    indices.add(parts[1])
        
        for idx in sorted(indices):
            prefix = f"BUCKET_{idx}_"
            if f"{prefix}ID" in os.environ:
                bucket = BucketConfig(
                    id=os.environ.get(f"{prefix}ID", ""),
                    bucket_name=os.environ.get(f"{prefix}NAME", ""),
                    region=os.environ.get(f"{prefix}REGION", "us-east-1"),
                    auth_type=os.environ.get(f"{prefix}AUTH_TYPE", "irsa").lower(),
                    access_key=os.environ.get(f"{prefix}ACCESS_KEY"),
                    secret_key=os.environ.get(f"{prefix}SECRET_KEY"),
                )
                buckets.append(bucket)
        return buckets

    class Config:
        env_file = ".env"
        extra = "allow"

settings = Settings()
