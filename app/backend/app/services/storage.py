"""ハイブリッドストレージ (F-20)。

機密度に応じてクラウド(非機密)/オンプレ(機密)のバケットへ振り分ける。
雛形では S3互換(MinIO)を両系統に見立てている。
"""

import boto3

from app.core.config import settings
from app.models.document import Sensitivity, StorageLocation


def _client():
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
    )


def ensure_buckets() -> None:
    """保存先バケットが無ければ作成する（冪等）。

    マイグレーション基盤導入までの暫定措置。`docker compose down -v` 等で
    ストレージを初期化した直後でも初回アップロードが失敗しないようにする。
    """
    client = _client()
    existing = {b["Name"] for b in client.list_buckets().get("Buckets", [])}
    for bucket in (settings.s3_bucket_cloud, settings.s3_bucket_onprem):
        if bucket not in existing:
            client.create_bucket(Bucket=bucket)


def resolve_location(sensitivity: Sensitivity) -> StorageLocation:
    """機密度から保存先を決定する。"""
    if sensitivity == Sensitivity.confidential:
        return StorageLocation.onprem
    return StorageLocation.cloud


def _bucket_for(location: StorageLocation) -> str:
    return (
        settings.s3_bucket_onprem
        if location == StorageLocation.onprem
        else settings.s3_bucket_cloud
    )


def put_object(location: StorageLocation, key: str, data: bytes, content_type: str) -> str:
    client = _client()
    bucket = _bucket_for(location)
    client.put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)
    return f"{bucket}/{key}"


def get_object(location: StorageLocation, key: str) -> bytes:
    client = _client()
    bucket = _bucket_for(location)
    return client.get_object(Bucket=bucket, Key=key)["Body"].read()
