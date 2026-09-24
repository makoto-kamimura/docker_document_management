# OpenSearch + 日本語形態素解析 (kuromoji)
# search.ensure_index() が ja_analyzer (type: kuromoji) を使うため、
# 素のイメージではなく analysis-kuromoji プラグインを組み込む。
FROM opensearchproject/opensearch:2.13.0

RUN /usr/share/opensearch/bin/opensearch-plugin install --batch analysis-kuromoji

# ---------------------------------------------------------------------------
# ヒープサイズ指定の一本化（report.md T-6）
#
# 素のイメージの config/jvm.options には -Xms1g / -Xmx1g がハードコードされて
# おり、compose の OPENSEARCH_JAVA_OPTS を併用すると JVM の起動引数に両方が
# 並ぶ（後勝ちで OPENSEARCH_JAVA_OPTS が有効）。ps の出力から実効値が読み取れず
# 「1g なのか 256m なのか」が判別できなくなるため、イメージ側の既定値を削除し、
# **OPENSEARCH_JAVA_OPTS を唯一の指定箇所**にする。
#
#   実効値の確認: docker inspect でも ps でも 1 つしか出てこないこと
# ---------------------------------------------------------------------------
RUN sed -i '/^-Xms/d; /^-Xmx/d' /usr/share/opensearch/config/jvm.options \
 && ! grep -qE '^-X(ms|mx)' /usr/share/opensearch/config/jvm.options
