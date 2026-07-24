import base64
import hashlib
import hmac
import json
import time
from typing import Dict, List, Optional

from src.config import settings

SESSION_COOKIE_NAME = "s3x_session"
SESSION_TTL_SECONDS = 12 * 60 * 60  # 12 hours

# Fixed-window rate limit for login attempts, keyed by client IP. In-memory
# and per-process — resets on restart and isn't shared across replicas, but
# still meaningfully slows down online guessing of a single shared password.
_LOGIN_ATTEMPTS: Dict[str, List[float]] = {}
MAX_LOGIN_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 60


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64decode(data: str) -> bytes:
    padded = data + "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(padded)


def _sign(payload_b64: str) -> str:
    signature = hmac.new(settings.SESSION_SECRET.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).digest()
    return _b64encode(signature)


def create_session_token() -> str:
    payload = {"exp": int(time.time()) + SESSION_TTL_SECONDS}
    payload_b64 = _b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    return f"{payload_b64}.{_sign(payload_b64)}"


def verify_session_token(token: Optional[str]) -> bool:
    if not token or "." not in token:
        return False
    payload_b64, _, signature_b64 = token.partition(".")
    if not hmac.compare_digest(_sign(payload_b64), signature_b64):
        return False
    try:
        payload = json.loads(_b64decode(payload_b64))
        return int(payload.get("exp", 0)) > int(time.time())
    except (ValueError, json.JSONDecodeError):
        return False


def check_password(candidate: str) -> bool:
    expected = settings.AUTH_PASSWORD
    if not expected:
        return False
    return hmac.compare_digest(candidate.encode("utf-8"), expected.encode("utf-8"))


def is_rate_limited(client_id: str) -> bool:
    now = time.time()
    attempts = [t for t in _LOGIN_ATTEMPTS.get(client_id, []) if now - t < LOGIN_WINDOW_SECONDS]
    _LOGIN_ATTEMPTS[client_id] = attempts
    return len(attempts) >= MAX_LOGIN_ATTEMPTS


def record_login_attempt(client_id: str) -> None:
    _LOGIN_ATTEMPTS.setdefault(client_id, []).append(time.time())
