"""全文検索 (F-23〜F-26)。OpenSearch に OCRテキスト/要約/メタデータを索引する。

検索対象: タイトル・OCR全文・**要約テキスト**・タグ・カテゴリ。
要約はワーカーが `summarize` で生成したものを索引し、全文検索でヒットさせる。
"""

from opensearchpy import OpenSearch

from app.core.config import settings

_client: OpenSearch | None = None

# 索引フィールド定義。既存indexにも put_mapping で後付けする（再作成不要）。
_FIELD_MAPPING = {
    "title": {"type": "text", "analyzer": "ja_analyzer"},
    "ocr_text": {"type": "text", "analyzer": "ja_analyzer"},
    "summary": {"type": "text", "analyzer": "ja_analyzer"},
    # タグは完全一致(keyword)と本文検索(text)の両方を持たせる
    "tags": {
        "type": "text",
        "analyzer": "ja_analyzer",
        "fields": {"raw": {"type": "keyword"}},
    },
    "category": {"type": "keyword"},
    "document_type": {"type": "keyword"},
    "owner_id": {"type": "keyword"},
    "tenant_id": {"type": "keyword"},
    "created_at": {"type": "date"},
}


def client() -> OpenSearch:
    global _client
    if _client is None:
        _client = OpenSearch(hosts=[settings.opensearch_url])
    return _client


def ensure_index() -> None:
    os_client = client()
    if os_client.indices.exists(index=settings.search_index):
        # 既存indexに新フィールド(summary/tags 等)を後付けする（冪等）
        try:
            os_client.indices.put_mapping(
                index=settings.search_index, body={"properties": _FIELD_MAPPING}
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[search] put_mapping skipped: {exc}")
        return
    os_client.indices.create(
        index=settings.search_index,
        body={
            "settings": {
                "analysis": {
                    "analyzer": {
                        # 日本語形態素解析（kuromoji プラグイン前提）
                        "ja_analyzer": {"type": "kuromoji"}
                    }
                }
            },
            "mappings": {"properties": _FIELD_MAPPING},
        },
    )


def index_document(doc_id: str, body: dict) -> None:
    client().index(index=settings.search_index, id=doc_id, body=body, refresh=True)


def ids_missing_tenant(limit: int = 500) -> list[str]:
    """tenant_id を持たない索引ドキュメントのID。

    テナント導入前に索引したものが該当する。テナント条件でフィルタすると検索に出て
    こなくなるため、ワーカーが DB を見て埋め直す。
    """
    try:
        res = client().search(
            index=settings.search_index,
            body={
                "size": limit,
                "_source": False,
                "query": {"bool": {"must_not": [{"exists": {"field": "tenant_id"}}]}},
            },
        )
    except Exception as exc:  # noqa: BLE001 - 索引未作成なら何もしない
        print(f"[search] ids_missing_tenant skipped: {exc}")
        return []
    return [h["_id"] for h in res["hits"]["hits"]]


def set_tenant(doc_ids: list[str], tenant_id: str) -> None:
    """索引済みドキュメントのテナントを付け替える（ユーザーのテナント移動に追随）。"""
    for doc_id in doc_ids:
        try:
            client().update(
                index=settings.search_index,
                id=doc_id,
                body={"doc": {"tenant_id": tenant_id}},
                refresh=True,
            )
        except Exception as exc:  # noqa: BLE001 - 未索引なら次回の再索引で整合する
            print(f"[search] set_tenant skipped {doc_id}: {exc}")


def delete_document(doc_id: str) -> None:
    try:
        client().delete(index=settings.search_index, id=doc_id, refresh=True)
    except Exception:  # noqa: BLE001 - 索引未登録なら無視
        pass


def search(
    query: str,
    filters: dict | None = None,
    size: int = 20,
    access: dict | None = None,
) -> list[dict]:
    """全文/キーワード検索 (F-23〜F-26)。

    タイトル・OCR本文・要約・タグを横断し、表記ゆれにあいまい一致(fuzziness)で対応する。

    `access` は閲覧できるドキュメントの条件。
    - `tenant_id`: 必ず一致させるテナント（テナント分離。全体管理者のみ None で全テナント横断）
    - `owner_ids` / `doc_ids`: テナント内でさらに絞る閲覧範囲 (F-36/F-37)。
      キー自体が無ければテナント内は全件（テナント管理者）。どちらも空リストなら
      閲覧できるドキュメントが無いので検索しない。
    """
    must: list[dict] = [
        {
            "multi_match": {
                "query": query,
                "fields": ["title^3", "tags^2", "ocr_text", "summary"],
                "fuzziness": "AUTO",
            }
        }
    ]
    filter_clauses = []
    for k, v in (filters or {}).items():
        if v is None:
            continue
        # tags は keyword サブフィールドで完全一致
        field = "tags.raw" if k == "tags" else k
        filter_clauses.append({"term": {field: v}})

    if access is not None:
        if access.get("tenant_id"):
            filter_clauses.append({"term": {"tenant_id": str(access["tenant_id"])}})
        if "owner_ids" in access or "doc_ids" in access:
            should: list[dict] = []
            if access.get("owner_ids"):
                should.append({"terms": {"owner_id": [str(i) for i in access["owner_ids"]]}})
            if access.get("doc_ids"):
                should.append({"ids": {"values": [str(i) for i in access["doc_ids"]]}})
            if not should:
                return []
            filter_clauses.append({"bool": {"should": should, "minimum_should_match": 1}})

    res = client().search(
        index=settings.search_index,
        body={
            "size": size,
            "query": {"bool": {"must": must, "filter": filter_clauses}},
            "highlight": {"fields": {"ocr_text": {}, "summary": {}, "title": {}}},
        },
    )
    hits = []
    for h in res["hits"]["hits"]:
        src = h["_source"]
        hl = h.get("highlight", {})
        # ヒット箇所を OCR本文 → 要約 → タイトル の優先で採用
        snippet, matched = None, None
        for field in ("ocr_text", "summary", "title"):
            if hl.get(field):
                snippet, matched = hl[field][0], field
                break
        tags = src.get("tags") or []
        if isinstance(tags, str):
            tags = [tags]
        hits.append(
            {
                "id": h["_id"],
                "title": src.get("title"),
                "snippet": snippet,
                "score": h["_score"],
                "category": src.get("category"),
                "tags": tags,
                "matched_in": matched,
            }
        )
    return hits
