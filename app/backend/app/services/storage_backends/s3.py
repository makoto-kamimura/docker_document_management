"""S3 互換の保存先（MinIO / Cloudflare R2 / その他の S3 互換サービス）。

Cloudflare R2 は endpoint を `https://<アカウントID>.r2.cloudflarestorage.com`、region を
`auto` にする。boto3 を 1.36 以上へ上げる場合、R2 はチェックサムの新しい既定に対応しないため
Config に `request_checksum_calculation="when_required"` を足すこと。
"""

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.services.storage_backends.base import (
    ObjectStore, StorageAuthError, StorageError, StorageNotFound, join_prefix,
)

_AUTH_CODES = {"AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch", "Unauthorized"}


def r2_endpoint(account_id: str) -> str:
    return f"https://{account_id.strip()}.r2.cloudflarestorage.com"


class S3Store(ObjectStore):
    def __init__(
        self,
        endpoint: str | None,
        access_key: str,
        secret_key: str,
        bucket: str,
        region: str | None = None,
        prefix: str = "",
    ):
        self._bucket = bucket
        self._prefix = prefix
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint or None,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region or None,
            config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
        )

    def _key(self, key: str) -> str:
        return join_prefix(self._prefix, key)

    @staticmethod
    def _wrap(exc: ClientError) -> StorageError:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in ("NoSuchKey", "404", "NotFound"):
            return StorageNotFound(code)
        if code in _AUTH_CODES:
            return StorageAuthError(f"S3 の認証に失敗しました ({code})")
        return StorageError(f"S3 の操作に失敗しました ({code or exc})")

    def put(self, key: str, data: bytes, content_type: str) -> None:
        try:
            self._client.put_object(
                Bucket=self._bucket, Key=self._key(key), Body=data, ContentType=content_type
            )
        except ClientError as exc:
            raise self._wrap(exc) from exc

    def get(self, key: str) -> bytes:
        try:
            return self._client.get_object(Bucket=self._bucket, Key=self._key(key))["Body"].read()
        except ClientError as exc:
            raise self._wrap(exc) from exc

    def delete(self, key: str) -> None:
        try:
            self._client.delete_object(Bucket=self._bucket, Key=self._key(key))
        except ClientError as exc:
            err = self._wrap(exc)
            if not isinstance(err, StorageNotFound):
                raise err from exc

    def list(self, prefix: str) -> list[str]:
        full = self._key(prefix)
        strip = len(self._key(""))
        keys: list[str] = []
        try:
            pages = self._client.get_paginator("list_objects_v2").paginate(
                Bucket=self._bucket, Prefix=full
            )
            for page in pages:
                keys.extend(obj["Key"][strip:] for obj in page.get("Contents", []))
        except ClientError as exc:
            raise self._wrap(exc) from exc
        return keys

    def ensure_bucket(self) -> None:
        """バケットが無ければ作成する（既定の MinIO 用。外部サービスでは呼ばない）。"""
        existing = {b["Name"] for b in self._client.list_buckets().get("Buckets", [])}
        if self._bucket not in existing:
            self._client.create_bucket(Bucket=self._bucket)
