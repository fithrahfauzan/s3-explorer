import logging
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Cookie, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os
import boto3
from botocore.exceptions import ClientError
from pydantic import BaseModel

from src.config import settings, BucketConfig
from src.auth import (
    SESSION_COOKIE_NAME,
    SESSION_TTL_SECONDS,
    check_password,
    create_session_token,
    is_rate_limited,
    record_login_attempt,
    verify_session_token,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("s3_explorer")

# Cap how many keys a single listing request can return so one call
# against a huge prefix can't stall the request or blow up memory.
MAX_LIST_ITEMS = 1000

app = FastAPI(title="S3 Explorer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

def require_auth(session: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE_NAME)) -> None:
    # No AUTH_PASSWORD configured means auth is opt-in and currently off.
    if not settings.AUTH_PASSWORD:
        return
    if not verify_session_token(session):
        raise HTTPException(status_code=401, detail="Not authenticated")

# Every route below requires a valid session (unless AUTH_PASSWORD is unset).
# /api/health and /api/auth/* are registered directly on `app` and stay public.
protected = APIRouter(dependencies=[Depends(require_auth)])

def get_bucket_config(bucket_id: str) -> BucketConfig:
    buckets = settings.load_buckets()
    bucket = next((b for b in buckets if b.id == bucket_id), None)
    if not bucket:
        raise HTTPException(status_code=404, detail="Bucket configuration not found")
    return bucket

def get_s3_client(bucket_config: BucketConfig):
    # Force the region-specific endpoint. Without it, boto3 presigns against
    # the legacy global host (bucket.s3.amazonaws.com), which opt-in regions
    # (e.g. ap-southeast-3) reject with IllegalLocationConstraintException —
    # the S3 API calls made directly by this client still succeed (they use
    # region_name correctly), so only presigned URLs silently break.
    endpoint_url = f"https://s3.{bucket_config.region}.amazonaws.com"
    if bucket_config.auth_type == "manual":
        return boto3.client(
            "s3",
            region_name=bucket_config.region,
            endpoint_url=endpoint_url,
            aws_access_key_id=bucket_config.access_key,
            aws_secret_access_key=bucket_config.secret_key
        )
    else:
        return boto3.client("s3", region_name=bucket_config.region, endpoint_url=endpoint_url)

class UploadRequest(BaseModel):
    key: str

class DownloadRequest(BaseModel):
    key: str

@app.get("/api/health")
def health_check() -> Dict[str, Any]:
    """Basic liveness/readiness probe"""
    return {"status": "ok", "buckets_configured": len(settings.load_buckets())}

class LoginRequest(BaseModel):
    password: str

@app.get("/api/auth/status")
def auth_status(session: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE_NAME)) -> Dict[str, Any]:
    """Whether auth is enabled at all, and whether this client is currently authenticated"""
    if not settings.AUTH_PASSWORD:
        return {"auth_enabled": False, "authenticated": True}
    return {"auth_enabled": True, "authenticated": verify_session_token(session)}

@app.post("/api/auth/login")
def login(login_request: LoginRequest, http_request: Request, response: Response) -> Dict[str, Any]:
    if not settings.AUTH_PASSWORD:
        raise HTTPException(status_code=400, detail="Auth is not configured")

    # Keyed on the peer IP as FastAPI sees it (the proxy/ingress IP if
    # deployed behind one, effectively one shared bucket in that case) — a
    # coarse but simple bound on brute-forcing a single shared password.
    client_id = http_request.client.host if http_request.client else "unknown"
    if is_rate_limited(client_id):
        raise HTTPException(status_code=429, detail="Too many attempts. Try again in a minute.")

    if not check_password(login_request.password):
        record_login_attempt(client_id)
        logger.warning("Failed login attempt from %s", client_id)
        raise HTTPException(status_code=401, detail="Invalid password")

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=create_session_token(),
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        secure=settings.SESSION_SECURE_COOKIE,
        # CSRF protection here relies entirely on SameSite=lax (cross-site
        # POST/DELETE won't carry this cookie). If this ever needs to become
        # "none" to support a split-origin frontend, add explicit CSRF
        # tokens first — the wildcard-origin CORS config below has no CSRF
        # protection of its own without SameSite doing the work.
        samesite="lax",
        path="/",
    )
    return {"message": "ok"}

@app.post("/api/auth/logout")
def logout(response: Response) -> Dict[str, Any]:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return {"message": "ok"}

@protected.get("/api/config")
def get_config() -> Dict[str, Any]:
    """Global app-wide UI/behavior flags"""
    return {"restricted_mode": settings.RESTRICTED_MODE}

@protected.get("/api/buckets")
def list_buckets() -> List[Dict[str, Any]]:
    """Return the list of configured buckets"""
    buckets = settings.load_buckets()
    return [{"id": b.id, "bucket_name": b.bucket_name, "region": b.region} for b in buckets]

@protected.get("/api/buckets/{bucket_id}/objects")
def list_objects(bucket_id: str, prefix: str = "", delimiter: str = "/"):
    """List objects and folders in a bucket"""
    bucket = get_bucket_config(bucket_id)
    s3 = get_s3_client(bucket)
    logger.info("Listing objects: bucket=%s prefix=%r", bucket_id, prefix)

    try:
        paginator = s3.get_paginator('list_objects_v2')
        pages = paginator.paginate(
            Bucket=bucket.bucket_name,
            Prefix=prefix,
            Delimiter=delimiter,
            PaginationConfig={'MaxItems': MAX_LIST_ITEMS},
        )

        objects = []
        folders = []
        is_truncated = False

        for page in pages:
            if 'CommonPrefixes' in page:
                for p in page['CommonPrefixes']:
                    folders.append({"prefix": p['Prefix']})

            if 'Contents' in page:
                for obj in page['Contents']:
                    if obj['Key'] != prefix:  # Skip the directory itself
                        objects.append({
                            "key": obj['Key'],
                            "size": obj['Size'],
                            "last_modified": obj['LastModified'].isoformat()
                        })
            is_truncated = page.get('IsTruncated', False)

        return {"folders": folders, "objects": objects, "prefix": prefix, "is_truncated": is_truncated}
    except ClientError as e:
        logger.error("Failed to list objects for bucket=%s prefix=%r: %s", bucket_id, prefix, e)
        raise HTTPException(status_code=400, detail=str(e))

class PresignedUrl(BaseModel):
    url: str
    fields: Optional[Dict[str, str]] = None

@protected.post("/api/buckets/{bucket_id}/upload-url", response_model=PresignedUrl)
def get_upload_url(bucket_id: str, request: UploadRequest):
    """Generate a presigned URL for uploading a file"""
    bucket = get_bucket_config(bucket_id)
    s3 = get_s3_client(bucket)
    try:
        if settings.RESTRICTED_MODE:
            # A single presigned PUT URL is what a plain `curl -X PUT` can hit
            # directly; a presigned POST would require the caller to also
            # replicate every form field, which doesn't fit a manual-upload
            # workflow. Leave Content-Type unsigned so any curl invocation
            # works regardless of what Content-Type it sends.
            url = s3.generate_presigned_url(
                'put_object',
                Params={'Bucket': bucket.bucket_name, 'Key': request.key},
                ExpiresIn=3600
            )
            return PresignedUrl(url=url)

        # Generate presigned POST URL
        response = s3.generate_presigned_post(
            Bucket=bucket.bucket_name,
            Key=request.key,
            ExpiresIn=3600
        )
        return PresignedUrl(url=response['url'], fields=response['fields'])
    except ClientError as e:
        logger.error("Failed to create upload URL for bucket=%s key=%r: %s", bucket_id, request.key, e)
        raise HTTPException(status_code=400, detail=str(e))

@protected.post("/api/buckets/{bucket_id}/download-url", response_model=PresignedUrl)
def get_download_url(bucket_id: str, request: DownloadRequest):
    """Generate a presigned URL for downloading a file"""
    bucket = get_bucket_config(bucket_id)
    s3 = get_s3_client(bucket)
    try:
        response = s3.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket.bucket_name, 'Key': request.key},
            ExpiresIn=3600
        )
        return PresignedUrl(url=response)
    except ClientError as e:
        logger.error("Failed to create download URL for bucket=%s key=%r: %s", bucket_id, request.key, e)
        raise HTTPException(status_code=400, detail=str(e))

@protected.delete("/api/buckets/{bucket_id}/objects")
def delete_object(bucket_id: str, key: str = Query(...)):
    """Delete an object from a bucket"""
    if settings.RESTRICTED_MODE:
        raise HTTPException(status_code=403, detail="Delete is disabled in restricted mode")
    bucket = get_bucket_config(bucket_id)
    s3 = get_s3_client(bucket)
    try:
        s3.delete_object(Bucket=bucket.bucket_name, Key=key)
        logger.info("Deleted object: bucket=%s key=%r", bucket_id, key)
        return {"message": "Success"}
    except ClientError as e:
        logger.error("Failed to delete object bucket=%s key=%r: %s", bucket_id, key, e)
        raise HTTPException(status_code=400, detail=str(e))

app.include_router(protected)

# Serve static frontend if it exists
if os.path.exists("frontend/dist"):
    app.mount("/assets", StaticFiles(directory="frontend/dist/assets"), name="assets")
    
    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        filepath = os.path.join("frontend/dist", full_path)
        if os.path.exists(filepath) and os.path.isfile(filepath):
            return FileResponse(filepath)
        return FileResponse("frontend/dist/index.html")
