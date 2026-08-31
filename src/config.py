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

class AuthProfile(BaseModel):
    password: str
    restricted_mode: bool

class ApiToken(BaseModel):
    """A static bearer token for non-browser API clients. Same access model
    as an AuthProfile (each token carries its own restricted_mode), but
    presented as an `Authorization: Bearer <token>` header instead of a
    login + session cookie."""
    token: str
    restricted_mode: bool

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
    # Superseded by AUTH_PROFILE_N_PASSWORD below when any are configured;
    # kept as a single-profile fallback using the global RESTRICTED_MODE.
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

    def load_auth_profiles(self) -> List[AuthProfile]:
        """Each profile is its own login password paired with its own
        restricted_mode, so different users can be granted different access
        levels (e.g. one full-access login, one restricted-only login)
        instead of sharing one global RESTRICTED_MODE for every session."""
        profiles = []
        indices = set()
        for key in os.environ:
            if key.startswith("AUTH_PROFILE_") and key.endswith("_PASSWORD"):
                parts = key.split("_")
                # Expected format: AUTH_PROFILE_{INDEX}_PASSWORD
                if len(parts) >= 4:
                    indices.add(parts[2])

        for idx in sorted(indices):
            prefix = f"AUTH_PROFILE_{idx}_"
            password = os.environ.get(f"{prefix}PASSWORD")
            if password:
                restricted_mode = os.environ.get(f"{prefix}RESTRICTED_MODE", "false").strip().lower() == "true"
                profiles.append(AuthProfile(password=password, restricted_mode=restricted_mode))

        if not profiles and self.AUTH_PASSWORD:
            # Legacy single-password setup: one profile using the global flag.
            profiles.append(AuthProfile(password=self.AUTH_PASSWORD, restricted_mode=self.RESTRICTED_MODE))

        return profiles

    def load_api_tokens(self) -> List[ApiToken]:
        """Static bearer tokens for external/programmatic API access, so a
        script can call the API with an `Authorization: Bearer` header
        instead of logging in for a session cookie. Each token has its own
        restricted_mode, mirroring load_auth_profiles().

        Env format: API_TOKEN_{INDEX}_VALUE plus optional
        API_TOKEN_{INDEX}_RESTRICTED_MODE (default false). API_TOKEN (no
        index) is accepted as a single-token fallback using the global
        RESTRICTED_MODE, mirroring the AUTH_PASSWORD fallback above."""
        tokens = []
        indices = set()
        for key in os.environ:
            if key.startswith("API_TOKEN_") and key.endswith("_VALUE"):
                parts = key.split("_")
                # Expected format exactly: API_TOKEN_{INDEX}_VALUE, INDEX numeric.
                # The strict check keeps a typo'd var name (API_TOKEN_1_FOO_VALUE)
                # from silently re-reading an existing token instead of erroring.
                if len(parts) == 4 and parts[2].isdigit():
                    indices.add(parts[2])

        for idx in sorted(indices):
            prefix = f"API_TOKEN_{idx}_"
            value = os.environ.get(f"{prefix}VALUE")
            if value:
                restricted_mode = os.environ.get(f"{prefix}RESTRICTED_MODE", "false").strip().lower() == "true"
                tokens.append(ApiToken(token=value, restricted_mode=restricted_mode))

        single = os.environ.get("API_TOKEN")
        if not tokens and single:
            tokens.append(ApiToken(token=single, restricted_mode=self.RESTRICTED_MODE))

        return tokens

    def auth_configured(self) -> bool:
        """True when any credential type is configured (login password or
        static API token). When True, every protected route requires a valid
        credential; when False, the API is fully open."""
        return bool(self.load_auth_profiles() or self.load_api_tokens())

    class Config:
        env_file = ".env"
        extra = "allow"

settings = Settings()
