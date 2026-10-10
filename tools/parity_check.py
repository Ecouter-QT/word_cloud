# -*- coding: utf-8 -*-
"""
parity_check.py —— 全语料级对拍
===============================
把整篇语料按句拆开，逐句用 Python jieba 切分，写成 JSON；
再由 tools/parity_check.js 用浏览器版 JS 实现切分并逐句比对。
这样能给出真正可信的一致率，而不是抽样目测。
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "vendor"))

import jieba  # noqa: E402

jieba.dt.cache_file = ""
jieba.initialize()

sys.stdout.reconfigure(encoding="utf-8")


def main():
    text = open(os.path.join(ROOT, "data", "corpus.txt"), encoding="utf-8").read()
    # 去掉篇名/作者元信息行
    text = re.sub(r"【[^】]*】[^\n]*\n", "\n", text)
    sents = [s for s in re.split(r"[\n]+", text) if s.strip()]

    cases = []
    for s in sents:
        cases.append({
            "sentence": s,
            "exact": jieba.lcut(s),
            "nohmm": jieba.lcut(s, HMM=False),
            "full": jieba.lcut(s, cut_all=True),
            "search": jieba.lcut_for_search(s),
        })

    out = os.path.join(ROOT, "tools", "parity_cases.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(cases, fh, ensure_ascii=False)
    total_chars = sum(len(c["sentence"]) for c in cases)
    total_tokens = sum(len(c["exact"]) for c in cases)
    print("句子数=%d  总字符=%d  精确模式总词数=%d" % (len(cases), total_chars, total_tokens))
    print("written ->", out)


if __name__ == "__main__":
    main()
