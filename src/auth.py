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


def create_session_token(restricted_mode: bool) -> str:
    # restricted_mode is baked into the signed payload at login time, tied to
    # whichever profile's password was used — the session can't be replayed
    # to claim a different (e.g. less restricted) access level later.
    payload = {"exp": int(time.time()) + SESSION_TTL_SECONDS, "restricted_mode": restricted_mode}
    payload_b64 = _b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    return f"{payload_b64}.{_sign(payload_b64)}"


def decode_session_token(token: Optional[str]) -> Optional[dict]:
    """Returns the verified payload, or None if the token is missing,
    tampered with, or expired."""
    if not token or "." not in token:
        return None
    payload_b64, _, signature_b64 = token.partition(".")
    if not hmac.compare_digest(_sign(payload_b64), signature_b64):
        return None
    try:
        payload = json.loads(_b64decode(payload_b64))
    except (ValueError, json.JSONDecodeError):
        return None
    if int(payload.get("exp", 0)) <= int(time.time()):
        return None
    return payload


def verify_session_token(token: Optional[str]) -> bool:
    return decode_session_token(token) is not None


def check_password(candidate: str) -> Optional[bool]:
    """Checks candidate against every configured auth profile (no early
    exit, so response time doesn't hint at which profile it's checked
    against) and returns the matched profile's restricted_mode, or None if
    no profile matches."""
    matched_restricted_mode: Optional[bool] = None
    candidate_bytes = candidate.encode("utf-8")
    for profile in settings.load_auth_profiles():
        if hmac.compare_digest(candidate_bytes, profile.password.encode("utf-8")):
            matched_restricted_mode = profile.restricted_mode
    return matched_restricted_mode


def check_api_token(candidate: Optional[str]) -> Optional[bool]:
    """Checks candidate against every configured static API token (no early
    exit, constant-time compare — same treatment as check_password) and
    returns the matched token's restricted_mode, or None if no token
    matches. Callers must test `is None`, not truthiness: a valid
    unrestricted token returns False."""
    if not candidate:
        return None
    matched_restricted_mode: Optional[bool] = None
    candidate_bytes = candidate.encode("utf-8")
    for api_token in settings.load_api_tokens():
        if hmac.compare_digest(candidate_bytes, api_token.token.encode("utf-8")):
            matched_restricted_mode = api_token.restricted_mode
    return matched_restricted_mode


def parse_bearer_token(authorization: Optional[str]) -> Optional[str]:
    """Extracts the token from an `Authorization: Bearer <token>` header.
    Returns None for a missing or non-Bearer header. Uses partition so a
    malformed header can never raise."""
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def is_rate_limited(client_id: str) -> bool:
    now = time.time()
    attempts = [t for t in _LOGIN_ATTEMPTS.get(client_id, []) if now - t < LOGIN_WINDOW_SECONDS]
    _LOGIN_ATTEMPTS[client_id] = attempts
    return len(attempts) >= MAX_LOGIN_ATTEMPTS


def record_login_attempt(client_id: str) -> None:
    _LOGIN_ATTEMPTS.setdefault(client_id, []).append(time.time())
