import logging
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os
import boto3
from botocore.exceptions import ClientError
from pydantic import BaseModel

from src.config import settings, BucketConfig

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
)

def get_bucket_config(bucket_id: str) -> BucketConfig:
    buckets = settings.load_buckets()
    bucket = next((b for b in buckets if b.id == bucket_id), None)
    if not bucket:
        raise HTTPException(status_code=404, detail="Bucket configuration not found")
    return bucket

def get_s3_client(bucket_config: BucketConfig):
    if bucket_config.auth_type == "manual":
        return boto3.client(
            "s3",
            region_name=bucket_config.region,
            aws_access_key_id=bucket_config.access_key,
            aws_secret_access_key=bucket_config.secret_key
        )
    else:
        return boto3.client("s3", region_name=bucket_config.region)

class UploadRequest(BaseModel):
    key: str

class DownloadRequest(BaseModel):
    key: str

@app.get("/api/health")
def health_check() -> Dict[str, Any]:
    """Basic liveness/readiness probe"""
    return {"status": "ok", "buckets_configured": len(settings.load_buckets())}

@app.get("/api/buckets")
def list_buckets() -> List[Dict[str, Any]]:
    """Return the list of configured buckets"""
    buckets = settings.load_buckets()
    return [{"id": b.id, "bucket_name": b.bucket_name, "region": b.region} for b in buckets]

@app.get("/api/buckets/{bucket_id}/objects")
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

@app.post("/api/buckets/{bucket_id}/upload-url", response_model=PresignedUrl)
def get_upload_url(bucket_id: str, request: UploadRequest):
    """Generate a presigned URL for uploading a file"""
    bucket = get_bucket_config(bucket_id)
    s3 = get_s3_client(bucket)
    try:
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

@app.post("/api/buckets/{bucket_id}/download-url", response_model=PresignedUrl)
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

@app.delete("/api/buckets/{bucket_id}/objects")
def delete_object(bucket_id: str, key: str = Query(...)):
    """Delete an object from a bucket"""
    bucket = get_bucket_config(bucket_id)
    s3 = get_s3_client(bucket)
    try:
        s3.delete_object(Bucket=bucket.bucket_name, Key=key)
        logger.info("Deleted object: bucket=%s key=%r", bucket_id, key)
        return {"message": "Success"}
    except ClientError as e:
        logger.error("Failed to delete object bucket=%s key=%r: %s", bucket_id, key, e)
        raise HTTPException(status_code=400, detail=str(e))

# Serve static frontend if it exists
if os.path.exists("frontend/dist"):
    app.mount("/assets", StaticFiles(directory="frontend/dist/assets"), name="assets")
    
    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        filepath = os.path.join("frontend/dist", full_path)
        if os.path.exists(filepath) and os.path.isfile(filepath):
            return FileResponse(filepath)
        return FileResponse("frontend/dist/index.html")
