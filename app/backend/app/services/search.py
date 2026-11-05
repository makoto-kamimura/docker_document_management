"""全文検索 (F-23〜F-26)。OpenSearch に OCRテキスト/メタデータを索引する。

検索対象: タイトル・OCR全文・タグ。
カテゴリは索引に持たせない（公開範囲・名前が後から変わるため、閲覧範囲とカテゴリ名は DB で決める）。

タイトルと OCR全文は3通りに索引する。
- 本体: kuromoji の形態素解析。普通の検索はこれで当てる。
- `.ngram` サブフィールド: 2文字ずつの区切り。OCR が読み違えて単語が崩れても、残りの部分で当てる。
- `*_reading` フィールド: 読み（カタカナ）。索引時に kuromoji で読みに直して入れ、2文字ずつに
  区切って並びごと（フレーズで）照合する。「うんどうかい」で「運動会」を当てる。
"""

from opensearchpy import OpenSearch

from app.core.config import settings

_client: OpenSearch | None = None

# ひらがな → カタカナ。ICU プラグインなしで済むよう文字の対応表で行う。
_HIRA_TO_KATA = [f"{chr(c)}=>{chr(c + 0x60)}" for c in range(ord("ぁ"), ord("ゖ") + 1)]

# 読みを入れ直す目印。値を上げると、全文書の読みを入れ直す（backfill_reading）。
READING_VERSION = 1

_ANALYSIS = {
    "char_filter": {
        "hira_to_kata": {"type": "mapping", "mappings": _HIRA_TO_KATA},
    },
    "tokenizer": {
        # 2文字ずつ区切る。区切った1つ1つが別の位置になるのでフレーズ照合ができる
        "ja_bigram": {
            "type": "ngram", "min_gram": 2, "max_gram": 2, "token_chars": ["letter", "digit"],
        },
        # 読みを取り出す用。複合語を分解しない（分解すると同じ読みが重なって出る）
        "ja_kuromoji_normal": {"type": "kuromoji_tokenizer", "mode": "normal"},
    },
    "analyzer": {
        # 日本語形態素解析（kuromoji プラグイン前提）
        "ja_analyzer": {"type": "kuromoji"},
        # OCR の読み違いに強い部分一致用
        "ja_ngram": {
            "type": "custom", "tokenizer": "ja_bigram", "filter": ["cjk_width", "lowercase"],
        },
        # 読み（カタカナ）の照合用。索引側・検索側とも、ひらがなはカタカナにそろえる
        "ja_kana": {
            "type": "custom",
            "char_filter": ["hira_to_kata"],
            "tokenizer": "ja_bigram",
            "filter": ["cjk_width"],
        },
        # 文章を読みに直す（_analyze で使うだけ。索引には使わない）
        "ja_reading_tokens": {
            "type": "custom",
            "tokenizer": "ja_kuromoji_normal",
            "filter": ["cjk_width", "kuromoji_readingform"],
        },
    },
}

_NGRAM_SUBFIELD = {"ngram": {"type": "text", "analyzer": "ja_ngram"}}

# 索引フィールド定義。既存indexにも put_mapping で後付けする。
_FIELD_MAPPING = {
    "title": {"type": "text", "analyzer": "ja_analyzer", "fields": _NGRAM_SUBFIELD},
    "ocr_text": {"type": "text", "analyzer": "ja_analyzer", "fields": _NGRAM_SUBFIELD},
    "title_reading": {"type": "text", "analyzer": "ja_kana"},
    "ocr_text_reading": {"type": "text", "analyzer": "ja_kana"},
    "reading_v": {"type": "integer"},
    # タグは完全一致(keyword)と本文検索(text)の両方を持たせる
    "tags": {
        "type": "text",
        "analyzer": "ja_analyzer",
        "fields": {"raw": {"type": "keyword"}},
    },
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


def _has_analyzers(os_client: OpenSearch) -> bool:
    res = os_client.indices.get_settings(index=settings.search_index)
    analysis = (
        next(iter(res.values()), {}).get("settings", {}).get("index", {}).get("analysis", {})
    )
    names = set(analysis.get("analyzer", {}))
    return {"ja_ngram", "ja_kana", "ja_reading_tokens"} <= names


# 索引の形の版。上げると、次の OCR ワーカーの起動時に移行（解析器・マッピングの追加と索引し直し）をする。
# 移行が最後まで済んだら索引の _meta に書く（途中で落ちても、次の起動でやり直せる）。
SCHEMA_VERSION = 2


def _schema_version(os_client: OpenSearch) -> int:
    res = os_client.indices.get_mapping(index=settings.search_index)
    meta = next(iter(res.values()), {}).get("mappings", {}).get("_meta", {}) or {}
    return int(meta.get("dms_schema", 1))


def ensure_index() -> None:
    """索引を用意する。既存の索引には解析器とサブフィールドを足して、文書を索引し直す（冪等）。

    解析器の追加には索引を一度閉じる必要があり、その数秒は検索できない。backend は複数
    プロセスで動くため、単一プロセスの OCR ワーカーの起動時にだけ呼ぶ。
    """
    os_client = client()
    if not os_client.indices.exists(index=settings.search_index):
        os_client.indices.create(
            index=settings.search_index,
            body={
                "settings": {"analysis": _ANALYSIS},
                "mappings": {"_meta": {"dms_schema": SCHEMA_VERSION}, "properties": _FIELD_MAPPING},
            },
        )
        return
    if _schema_version(os_client) >= SCHEMA_VERSION:
        return

    if not _has_analyzers(os_client):
        print("[search] adding n-gram / reading analyzers (index is closed for a moment)")
        os_client.indices.close(index=settings.search_index)
        try:
            os_client.indices.put_settings(
                index=settings.search_index, body={"analysis": _ANALYSIS}
            )
        finally:
            os_client.indices.open(index=settings.search_index, wait_for_active_shards=1)
    os_client.indices.put_mapping(index=settings.search_index, body={"properties": _FIELD_MAPPING})
    # 既存の文書を _source から索引し直し、新しいサブフィールドを埋める（読みは backfill_reading）
    res = os_client.update_by_query(
        index=settings.search_index, conflicts="proceed", refresh=True, wait_for_completion=True,
    )
    print(f"[search] reindexed for new subfields: {res.get('updated', 0)}")
    os_client.indices.put_mapping(
        index=settings.search_index, body={"_meta": {"dms_schema": SCHEMA_VERSION}}
    )


_READING_CHUNK = 4000  # _analyze 1回に渡す文字数（既定のトークン数上限 10000 に収める）


def reading_of(text: str | None) -> str | None:
    """文章を読み（カタカナ）に直す。失敗したら None。

    句読点・空白・改行で途切れたところには空白を入れ、文をまたいだ2文字区切りができない
    ようにする。読みの無い語（英数字・辞書にない語）はそのままの表記で入る。
    """
    if not text:
        return ""
    out: list[str] = []
    rest = text
    while rest:
        chunk = rest[:_READING_CHUNK]
        if len(rest) > _READING_CHUNK:
            cut = chunk.rfind("\n")
            if cut > _READING_CHUNK // 2:
                chunk = chunk[: cut + 1]
        rest = rest[len(chunk):]
        try:
            res = client().indices.analyze(
                index=settings.search_index,
                body={"analyzer": "ja_reading_tokens", "text": chunk},
            )
        except Exception as exc:  # noqa: BLE001 - 読みが無くても普通の検索はできる
            print(f"[search] reading skipped: {type(exc).__name__}: {exc}")
            return None
        prev_end = None
        for t in res.get("tokens", []):
            if prev_end is not None and t["start_offset"] > prev_end:
                out.append(" ")
            out.append(t["token"])
            prev_end = t["end_offset"]
        out.append(" ")
    return "".join(out).strip()


def _with_readings(body: dict) -> dict:
    """索引する文書に読みを足す。どちらかでも失敗したら目印を付けず、あとで入れ直す。"""
    title = reading_of(body.get("title"))
    ocr = reading_of(body.get("ocr_text"))
    if title is None or ocr is None:
        return body
    return {**body, "title_reading": title, "ocr_text_reading": ocr, "reading_v": READING_VERSION}


def index_document(doc_id: str, body: dict) -> None:
    client().index(
        index=settings.search_index, id=doc_id, body=_with_readings(body), refresh=True
    )


def backfill_reading(limit: int = 200) -> int:
    """読みの入っていない（古い）索引ドキュメントに読みを入れる。入れた件数を返す。"""
    try:
        res = client().search(
            index=settings.search_index,
            body={
                "size": limit,
                "_source": ["title", "ocr_text"],
                "query": {
                    "bool": {"must_not": [{"range": {"reading_v": {"gte": READING_VERSION}}}]}
                },
            },
        )
    except Exception as exc:  # noqa: BLE001 - 索引未作成なら何もしない
        print(f"[search] backfill_reading skipped: {exc}")
        return 0
    done = 0
    for h in res["hits"]["hits"]:
        src = h.get("_source") or {}
        title, ocr = reading_of(src.get("title")), reading_of(src.get("ocr_text"))
        if title is None or ocr is None:
            break
        client().update(
            index=settings.search_index,
            id=h["_id"],
            body={"doc": {
                "title_reading": title, "ocr_text_reading": ocr, "reading_v": READING_VERSION,
            }},
        )
        done += 1
    if done:
        client().indices.refresh(index=settings.search_index)
    return done


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


def _query(query: str) -> dict:
    """検索語から問い合わせを組み立てる。

    完全に近い一致（形態素解析）が上位に来るよう、部分一致（.ngram）と読み（*_reading）は
    重みを下げて足す。
    - 部分一致: 検索語の2文字区切りのうち一部が欠けても当てる（OCR の読み違い）。
      区切りが2つ以下の短い語は全部の一致を求める。
    - 読み: 検索語をカタカナにそろえ、2文字区切りの並びごと一致したものだけ当てる。
    """
    return {
        "bool": {
            "should": [
                {
                    "multi_match": {
                        "query": query,
                        "fields": ["title^3", "tags^2", "ocr_text"],
                        "fuzziness": "AUTO",
                    }
                },
                {
                    "multi_match": {
                        "query": query,
                        "fields": ["title.ngram^0.9", "ocr_text.ngram^0.3"],
                        "minimum_should_match": "2<-34%",
                    }
                },
                {
                    "multi_match": {
                        "query": query,
                        "type": "phrase",
                        "fields": ["title_reading^1.5", "ocr_text_reading^0.5"],
                    }
                },
            ],
            "minimum_should_match": 1,
        }
    }


# ハイライトを見る順番と、利用者に見せるフィールド名。読みで当たった場合は抜き出しを出さない
# （カタカナの読みを見せても分かりにくいため）。
_HIGHLIGHT_FIELDS = [
    ("ocr_text", "ocr_text"),
    ("ocr_text.ngram", "ocr_text"),
    ("title", "title"),
    ("title.ngram", "title"),
]
_READING_FIELDS = [("ocr_text_reading", "ocr_text"), ("title_reading", "title")]


def search(
    query: str,
    filters: dict | None = None,
    size: int = 20,
    access: dict | None = None,
) -> list[dict]:
    """全文/キーワード検索 (F-23〜F-26)。

    タイトル・OCR本文・タグを横断する。表記ゆれはあいまい一致(fuzziness)、OCR の読み違いは
    2文字区切りの部分一致、ひらがな入力は読みの一致で拾う。

    `access` は閲覧できるドキュメントの条件。
    - `tenant_id`: 必ず一致させるテナント（テナント分離）
    - `doc_ids`: 閲覧できるドキュメントの ID (F-36/F-37)。DB で公開範囲・共有・グループから求める。
      キー自体が無ければテナント内は全件。空リストなら閲覧できるドキュメントが無いので検索しない。
    """
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
        if "doc_ids" in access:
            if not access["doc_ids"]:
                return []
            filter_clauses.append({"ids": {"values": [str(i) for i in access["doc_ids"]]}})

    res = client().search(
        index=settings.search_index,
        body={
            "size": size,
            "query": {"bool": {"must": [_query(query)], "filter": filter_clauses}},
            "highlight": {
                "fields": {f: {} for f, _ in _HIGHLIGHT_FIELDS + _READING_FIELDS}
            },
        },
    )
    hits = []
    for h in res["hits"]["hits"]:
        src = h["_source"]
        hl = h.get("highlight", {})
        # ヒット箇所を OCR本文 → タイトル の優先で採用（部分一致・読みで当たった場合も同じ扱い）
        snippet, matched = None, None
        for field, shown in _HIGHLIGHT_FIELDS:
            if hl.get(field):
                snippet, matched = hl[field][0], shown
                break
        else:
            matched = next((shown for f, shown in _READING_FIELDS if hl.get(f)), None)
        tags = src.get("tags") or []
        if isinstance(tags, str):
            tags = [tags]
        hits.append(
            {
                "id": h["_id"],
                "title": src.get("title"),
                "snippet": snippet,
                "score": h["_score"],
                "tags": tags,
                "matched_in": matched,
            }
        )
    return hits
