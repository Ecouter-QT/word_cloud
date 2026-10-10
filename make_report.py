# -*- coding: utf-8 -*-
"""
make_report.py —— 跑完整实验并汇总出报告所需的全部数据
======================================================
这是本项目的"一键复现"脚本，对应实验要求的端到端 Pipeline：

    语料预处理
      -> jieba 分词 / 调优（自定义词典、add_word、suggest_freq、HMM 开关、三种模式）
      -> 自建工具分词 / 调优（FMM / BMM / BIMM、max_len、词表扩充、HMM 回退）
      -> 对比评测（人工标注金标准 + 全语料银标准，P/R/F1 + 错误分类）
      -> 词云图生成（形状蒙版、配色、词频归一化、停用词过滤）

产出：
    report/summary.json     汇总数据（供生成 Word 报告与前端展示）
    report/metrics.json     详细指标（含错误明细与差异片段）
    wordcloud.png           主词云图
    report/wordcloud-*.png  多风格词云图
    web/data/gold.txt       前端"人工标注金标准"演示用副本

用法：
    python make_report.py
    python make_report.py --fast        # 跳过银标准全语料评测，只跑人工标注
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from jieba_bootstrap import BASE_DIR, load_stopwords, resource_path  # noqa: E402
from corpus_preprocess import load_corpus, split_sentences, stats  # noqa: E402
from compare import run_comparison  # noqa: E402
from wordcloud_gen import WordCloudGenerator  # noqa: E402

REPORT_DIR = os.path.join(BASE_DIR, "report")
METRIC_KEYS = ["jieba_default", "jieba_tuned", "self_default", "self_tuned"]


def title(msg):
    print()
    print("=" * 80)
    print(msg)
    print("=" * 80)


def fmt_metrics(res, indent="  "):
    print("%s%-18s %9s %9s %9s %8s %9s" %
          (indent, "分词工具", "准确率P", "召回率R", "F1值", "输出词数", "整句一致率"))
    print(indent + "-" * 72)
    for k in METRIC_KEYS:
        m = res["metrics"][k]
        print("%s%-18s %8.2f%% %8.2f%% %8.2f%% %8d %8.1f%%" % (
            indent, m["label"], m["precision"] * 100, m["recall"] * 100,
            m["f1"] * 100, m["word_count"], m["exact_match"] * 100))


def main():
    ap = argparse.ArgumentParser(description="跑完整实验并汇总报告数据")
    ap.add_argument("--corpus", default=resource_path("corpus.txt"))
    ap.add_argument("--gold", default=resource_path("gold.txt"))
    ap.add_argument("--fast", action="store_true", help="跳过全语料银标准评测")
    ap.add_argument("--max-words", type=int, default=200)
    ap.add_argument("--cloud-shape", default="ellipse")
    ap.add_argument("--cloud-palette", default="viridis")
    args = ap.parse_args()

    t0 = time.time()
    os.makedirs(REPORT_DIR, exist_ok=True)

    # ================================================== 1. 语料预处理
    title("步骤 1/5  语料读取与预处理")
    raw, corpus_text = load_corpus(args.corpus)
    st = stats(raw, corpus_text)
    print("语料文件：%s" % args.corpus)
    for k, v in st.items():
        print("  %-14s %d" % (k, v))
    titles = __import__("re").findall(r"【篇名】(.*)", raw)
    authors = __import__("re").findall(r"【作者】(.*)", raw)
    print("  篇目：%d 篇" % len(titles))
    for t, a in zip(titles, authors):
        print("    · 《%s》 %s" % (t, a))

    sample_dst = os.path.join(BASE_DIR, "web", "data", "sample.txt")
    shutil.copyfile(args.corpus, sample_dst)
    gold_dst = os.path.join(BASE_DIR, "web", "data", "gold.txt")
    if os.path.exists(args.gold):
        shutil.copyfile(args.gold, gold_dst)

    # ================================================== 2. 人工标注金标准评测
    title("步骤 2/5  基于人工标注金标准的定量评测")
    res_gold = run_comparison(args.corpus, args.gold)
    print("金标准：%s" % res_gold["gold_source"])
    print("评测文本：%d 字符 / %d 句" % (
        res_gold["stats"]["评测文本字符数"], res_gold["stats"]["评测句子数"]))
    print()
    fmt_metrics(res_gold)
    print()
    print("  错误类型分布")
    print("  %-10s%16s%16s%16s%16s" % ("类型", "jieba默认", "jieba调优", "自建默认", "自建调优"))
    for t, name in [("split", "切碎"), ("merge", "粘连"), ("oov", "未登录词")]:
        print("  %-10s" % name + "".join(
            "%16d" % res_gold["errors"][k]["by_type"].get(t, 0) for k in METRIC_KEYS))

    # ================================================== 3. 全语料银标准评测
    res_silver = None
    if not args.fast:
        title("步骤 3/5  基于全语料自动银标准的评测（覆盖面更广）")
        res_silver = run_comparison(args.corpus, None)
        print("金标准：%s（%d 词）" % (res_silver["gold_source"], len(res_silver["gold"])))
        print()
        fmt_metrics(res_silver)

    # ================================================== 4. 词云
    title("步骤 4/5  词云图生成")
    stopwords = load_stopwords()
    freq = res_silver["frequencies"] if res_silver else res_gold["frequencies"]
    print("停用词表 %d 词；过滤后保留 %d 个词条" % (len(stopwords), len(freq)))
    top = sorted(freq.items(), key=lambda kv: -kv[1])[:15]
    print("高频词：" + "、".join("%s(%d)" % (w, c) for w, c in top))

    gen = WordCloudGenerator(shape=args.cloud_shape, palette=args.cloud_palette,
                             max_words=args.max_words)
    out_main = gen.generate(freq, os.path.join(BASE_DIR, "wordcloud.png"))
    print("\n主词云图 -> %s" % out_main)
    for k, v in gen.stats.items():
        print("  %-10s %s" % (k, v))

    variants = [
        ("heart", "plasma", "心形 + plasma"),
        ("star", "turbo", "五角星 + turbo"),
        ("cloud", "ocean", "云朵 + ocean"),
        ("circle", "warm", "正圆 + 暖色"),
        ("text", "forest", "文字形状 + forest"),
        ("diamond", "sunset", "菱形 + sunset"),
    ]
    variant_paths = []
    for shape, palette, desc in variants:
        g = WordCloudGenerator(shape=shape, palette=palette, max_words=args.max_words)
        p = os.path.join(REPORT_DIR, "wordcloud-%s-%s.png" % (shape, palette))
        g.generate(freq, p)
        variant_paths.append((p, desc, g.stats["已放置"]))
        print("  %-24s -> %s（%s 词）" % (desc, os.path.basename(p), g.stats["已放置"]))

    # ================================================== 5. 汇总写出
    title("步骤 5/5  写出汇总结果")
    summary = {
        "生成时间": time.strftime("%Y-%m-%d %H:%M:%S"),
        "语料": {
            "文件": os.path.basename(args.corpus),
            "篇目": [{"篇名": t, "作者": a} for t, a in zip(titles, authors)],
            **st,
        },
        "人工标注评测": {
            "金标准": res_gold["gold_source"],
            "评测文本字符数": res_gold["stats"]["评测文本字符数"],
            "评测句子数": res_gold["stats"]["评测句子数"],
            "指标": {res_gold["metrics"][k]["label"]: {
                "准确率P": round(res_gold["metrics"][k]["precision"], 4),
                "召回率R": round(res_gold["metrics"][k]["recall"], 4),
                "F1": round(res_gold["metrics"][k]["f1"], 4),
                "输出词数": res_gold["metrics"][k]["word_count"],
                "整句完全一致率": round(res_gold["metrics"][k]["exact_match"], 4),
            } for k in METRIC_KEYS},
            "错误类型": {res_gold["metrics"][k]["label"]:
                     res_gold["errors"][k]["by_type"] for k in METRIC_KEYS},
            "错误明细": {res_gold["metrics"][k]["label"]:
                     res_gold["errors"][k]["issues"][:40] for k in METRIC_KEYS},
            "调优差异": {
                "jieba差异片段": res_gold["diffs_jieba"][:60],
                "自建工具差异片段": res_gold["diffs_self"][:60],
            },
        },
        "全语料评测": None if res_silver is None else {
            "金标准": res_silver["gold_source"],
            "标准词数": len(res_silver["gold"]),
            "指标": {res_silver["metrics"][k]["label"]: {
                "准确率P": round(res_silver["metrics"][k]["precision"], 4),
                "召回率R": round(res_silver["metrics"][k]["recall"], 4),
                "F1": round(res_silver["metrics"][k]["f1"], 4),
                "输出词数": res_silver["metrics"][k]["word_count"],
                "整句完全一致率": round(res_silver["metrics"][k]["exact_match"], 4),
            } for k in METRIC_KEYS},
            "错误类型": {res_silver["metrics"][k]["label"]:
                     res_silver["errors"][k]["by_type"] for k in METRIC_KEYS},
        },
        "调优手段": {
            "自定义词典": res_gold.get("user_dict_info"),
            "自建词典反向扩充词数": res_gold["extended_count"],
            "自建工具调优记录": res_gold["self_tuning_log"],
            "停用词表规模": res_gold["stopword_count"],
        },
        "词云": {
            "主图": os.path.relpath(out_main, BASE_DIR),
            **gen.stats,
            "风格变体": [{"文件": os.path.relpath(p, BASE_DIR), "说明": d, "词数": n}
                     for p, d, n in variant_paths],
        },
        "高频词前40": [{"词": w, "词频": c} for w, c in sorted(freq.items(), key=lambda kv: -kv[1])[:40]],
        "耗时秒": round(time.time() - t0, 2),
    }

    out_json = os.path.join(REPORT_DIR, "summary.json")
    with open(out_json, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, ensure_ascii=False, indent=1)
    print("汇总数据 -> %s" % out_json)

    detail = {
        "语料统计": st,
        "人工标注": {
            "来源": res_gold["gold_source"],
            "指标": res_gold["metrics"],
            "错误类型": {k: v["by_type"] for k, v in res_gold["errors"].items()},
            "错误明细": {k: v["issues"][:150] for k, v in res_gold["errors"].items()},
            "噪声": {k: v["noise"] for k, v in res_gold["errors"].items()},
            "jieba调优差异": res_gold["diffs_jieba"],
            "自建调优差异": res_gold["diffs_self"],
        },
        "全语料": None if res_silver is None else {
            "来源": res_silver["gold_source"],
            "指标": res_silver["metrics"],
            "错误类型": {k: v["by_type"] for k, v in res_silver["errors"].items()},
        },
        "词频": sorted(freq.items(), key=lambda kv: -kv[1])[:200],
    }
    out_detail = os.path.join(REPORT_DIR, "metrics.json")
    with open(out_detail, "w", encoding="utf-8") as fh:
        json.dump(detail, fh, ensure_ascii=False, indent=1)
    print("详细指标 -> %s" % out_detail)

    print("\n全部完成，总耗时 %.1f 秒。" % (time.time() - t0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
