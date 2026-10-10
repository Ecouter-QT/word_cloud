# -*- coding: utf-8 -*-
"""
run_all.py —— 一键跑完整个实验流程
===================================
把整条 Pipeline 串起来，对应实验报告"端到端流程封装"的改进方向：

    语料预处理 -> jieba 分词与调优 -> 自建工具分词与调优
      -> 对比评测(P/R/F1 + 错误分析) -> 词云图生成

用法：
    python run_all.py
    python run_all.py --gold data/gold.txt        # 用人工标注金标准
    python run_all.py --cloud-shape heart --cloud-palette plasma

产出：
    web/data/sample.txt             前端"载入示例语料"用的副本
    report/metrics.json             指标与错误分析结果
    wordcloud.png                   词云图
    report/wordcloud-*.png          多风格词云图
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from jieba_bootstrap import BASE_DIR, resource_path  # noqa: E402
from corpus_preprocess import load_corpus, split_sentences, stats  # noqa: E402
from compare import run_comparison  # noqa: E402
from wordcloud_gen import WordCloudGenerator, build_frequencies  # noqa: E402
from jieba_bootstrap import load_stopwords  # noqa: E402

REPORT_DIR = os.path.join(BASE_DIR, "report")


def title(msg):
    print()
    print("=" * 78)
    print(msg)
    print("=" * 78)


def main():
    ap = argparse.ArgumentParser(description="一键跑完分词对比 + 词云生成")
    ap.add_argument("--corpus", default=resource_path("corpus.txt"))
    ap.add_argument("--gold", default=None)
    ap.add_argument("--cloud-shape", default="ellipse")
    ap.add_argument("--cloud-palette", default="viridis")
    ap.add_argument("--cloud-mapping", default="sqrt")
    ap.add_argument("--cloud-text", default="词")
    ap.add_argument("--max-words", type=int, default=200)
    ap.add_argument("--skip-variants", action="store_true",
                    help="不生成多风格对比词云图")
    args = ap.parse_args()

    t_start = time.time()
    os.makedirs(REPORT_DIR, exist_ok=True)

    # ---------------- 1. 语料预处理 ----------------
    title("步骤 1/5  语料读取与预处理")
    raw, text = load_corpus(args.corpus)
    st = stats(raw, text)
    print("语料文件：%s" % args.corpus)
    for k, v in st.items():
        print("  %-12s %d" % (k, v))

    # 同步一份给前端"载入示例语料"使用
    sample_dst = os.path.join(BASE_DIR, "web", "data", "sample.txt")
    shutil.copyfile(args.corpus, sample_dst)
    print("示例语料已同步 -> %s" % sample_dst)

    # ---------------- 2~4. 分词 / 调优 / 对比 ----------------
    title("步骤 2/5  分词、调优与对比评测")
    res = run_comparison(args.corpus, args.gold)

    print("金标准：%s（%d 词）" % (res["gold_source"], len(res["gold"])))
    print()
    print("%-18s %10s %10s %10s %10s %10s" %
          ("分词工具", "准确率P", "召回率R", "F1值", "输出词数", "整句一致率"))
    print("-" * 78)
    for key in ["jieba_default", "jieba_tuned", "self_default", "self_tuned"]:
        m = res["metrics"][key]
        print("%-18s %9.2f%% %9.2f%% %9.2f%% %10d %9.1f%%" % (
            m["label"], m["precision"] * 100, m["recall"] * 100, m["f1"] * 100,
            m["word_count"], m["exact_match"] * 100))

    print()
    print("错误类型分布")
    print("-" * 78)
    print("  %-10s%16s%16s%16s%16s" %
          ("类型", "jieba默认", "jieba调优", "自建默认", "自建调优"))
    for t, name in [("split", "切碎"), ("merge", "粘连"), ("oov", "未登录词")]:
        print("  %-10s" % name + "".join(
            "%16d" % res["errors"][k]["by_type"].get(t, 0)
            for k in ["jieba_default", "jieba_tuned", "self_default", "self_tuned"]))

    print()
    print("调优前后差异：jieba %d 处，自建工具 %d 处；自建词典反向扩充 +%d 词"
          % (len(res["diffs_jieba"]), len(res["diffs_self"]), res["extended_count"]))

    # ---------------- 5. 词云 ----------------
    title("步骤 3/5  词云图生成")
    stopwords = load_stopwords()
    freq = res["frequencies"]
    print("停用词表 %d 词，过滤后保留 %d 个词条" % (len(stopwords), len(freq)))
    top = sorted(freq.items(), key=lambda kv: -kv[1])[:15]
    print("高频词：" + "、".join("%s(%d)" % (w, c) for w, c in top))

    gen = WordCloudGenerator(shape=args.cloud_shape, palette=args.cloud_palette,
                             mapping=args.cloud_mapping, max_words=args.max_words,
                             shape_text=args.cloud_text)
    out1 = gen.generate(freq, os.path.join(BASE_DIR, "wordcloud.png"))
    print("\n主词云图 -> %s" % out1)
    for k, v in gen.stats.items():
        print("  %-10s %s" % (k, v))

    if not args.skip_variants:
        title("步骤 4/5  多风格词云图（形状 × 配色）")
        variants = [
            ("heart", "plasma", "心形 + plasma"),
            ("star", "turbo", "五角星 + turbo"),
            ("cloud", "ocean", "云朵 + ocean"),
            ("circle", "warm", "正圆 + 暖色"),
            ("text", "forest", "文字形状 + forest"),
            ("diamond", "sunset", "菱形 + sunset"),
        ]
        for shape, palette, desc in variants:
            g = WordCloudGenerator(shape=shape, palette=palette, mapping=args.cloud_mapping,
                                   max_words=args.max_words, shape_text=args.cloud_text)
            path = os.path.join(REPORT_DIR, "wordcloud-%s-%s.png" % (shape, palette))
            g.generate(freq, path)
            print("  %-28s -> %s（已放置 %s 词）" % (desc, os.path.basename(path), g.stats["已放置"]))

    # ---------------- 汇总输出 ----------------
    title("步骤 5/5  写出结果")
    summary = {
        "语料": {
            "文件": os.path.basename(args.corpus),
            **res["stats"],
        },
        "金标准": {"来源": res["gold_source"], "词数": len(res["gold"])},
        "指标": {res["metrics"][k]["label"]: {
            "准确率P": round(res["metrics"][k]["precision"], 4),
            "召回率R": round(res["metrics"][k]["recall"], 4),
            "F1": round(res["metrics"][k]["f1"], 4),
            "输出词数": res["metrics"][k]["word_count"],
            "整句完全一致率": round(res["metrics"][k]["exact_match"], 4),
        } for k in ["jieba_default", "jieba_tuned", "self_default", "self_tuned"]},
        "错误类型": {k: res["errors"][k]["by_type"] for k in
                 ["jieba_default", "jieba_tuned", "self_default", "self_tuned"]},
        "调优": {
            "jieba调优前后差异片段数": len(res["diffs_jieba"]),
            "自建工具调优前后差异片段数": len(res["diffs_self"]),
            "自建词典反向扩充词数": res["extended_count"],
            "自建工具调优记录": res["self_tuning_log"],
        },
        "词云": gen.stats,
        "高频词前30": [{"词": w, "词频": c} for w, c in
                    sorted(freq.items(), key=lambda kv: -kv[1])[:30]],
        "耗时秒": round(time.time() - t_start, 2),
    }
    out_json = os.path.join(REPORT_DIR, "summary.json")
    with open(out_json, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, ensure_ascii=False, indent=1)
    print("汇总结果 -> %s" % out_json)

    # 详细指标（compare.py 的产物）
    detail = {
        "stats": res["stats"],
        "gold_source": res["gold_source"],
        "gold_count": len(res["gold"]),
        "metrics": res["metrics"],
        "errors_by_type": {k: v["by_type"] for k, v in res["errors"].items()},
        "errors_issues": {k: v["issues"][:120] for k, v in res["errors"].items()},
        "noise": {k: v["noise"] for k, v in res["errors"].items()},
        "diffs_jieba": res["diffs_jieba"][:200],
        "diffs_self": res["diffs_self"][:200],
        "freq_top": sorted(freq.items(), key=lambda kv: -kv[1])[:120],
        "extended_count": res["extended_count"],
        "stopword_count": res["stopword_count"],
        "self_tuning_log": res["self_tuning_log"],
    }
    out_detail = os.path.join(REPORT_DIR, "metrics.json")
    with open(out_detail, "w", encoding="utf-8") as fh:
        json.dump(detail, fh, ensure_ascii=False, indent=1)
    print("详细指标 -> %s" % out_detail)

    print("\n全部完成，总耗时 %.1f 秒。" % (time.time() - t_start))
    return 0


if __name__ == "__main__":
    sys.exit(main())
