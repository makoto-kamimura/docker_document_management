# OpenSearch + 日本語形態素解析 (kuromoji)
# search.ensure_index() が ja_analyzer (type: kuromoji) を使うため、
# 素のイメージではなく analysis-kuromoji プラグインを組み込む。
FROM opensearchproject/opensearch:2.13.0

RUN /usr/share/opensearch/bin/opensearch-plugin install --batch analysis-kuromoji
