# -*- coding: utf-8 -*-
"""
gen_verify_cases.py
===================
生成 JS/Python 分词对拍用例：从语料中抽样句子，分别记录 Python jieba 在
精确模式 / 全模式 / 搜索引擎模式 / 关闭 HMM 四种设置下的切分结果。

注意：必须强制 jieba 重新构建前缀词典（不使用本地缓存），否则可能读到
旧版本 dict.txt 生成的 jieba.cache，导致与 web/data/jieba_dict.js 不一致。
"""
import json
import os
import random
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "vendor"))

import jieba  # noqa: E402
from jieba import posseg  # noqa: E402  (确保相关子模块可用)

# 关闭缓存，强制从 vendor/jieba/dict.txt 重建前缀词典
jieba.dt.cache_file = ""
jieba.initialize()

DICT_PATH = os.path.join(ROOT, "vendor", "jieba", "dict.txt")


def sanity_check():
    """确认 Python 端读到的是与导出 JS 时同一份词典数据。

    注意：Python 的 FREQ 表里还包含大量"前缀占位"键（词频 0），
    它们只用于 DAG 前缀判断，因此这里只比较"非零词频"的词条。
    """
    total = 0
    n = 0
    real = {}
    with open(DICT_PATH, encoding="utf-8") as fh:
        for line in fh:
            parts = line.split(" ")
            w, f = parts[0], int(parts[1])
            real[w] = f
            total += f
            n += 1
    nonzero = sum(1 for v in jieba.dt.FREQ.values() if v)
    print("dict.txt 词条=%d  总词频=%d" % (n, total))
    print("jieba FREQ 键=%d（含前缀占位键），其中非零词频=%d，total=%d"
          % (len(jieba.dt.FREQ), nonzero, jieba.dt.total))
    assert nonzero == n, "非零词条数不一致：%d vs %d" % (nonzero, n)
    assert jieba.dt.total == total, "总词频不一致"
    for w in ("提着", "北去", "传过", "推门", "自然", "之于"):
        assert jieba.dt.FREQ.get(w), "缺少词条 " + w
    print("sanity check OK：Python 词典与导出的 JS 词典一致")


def main():
    sanity_check()
    random.seed(42)
    corpus_path = os.path.join(ROOT, "data", "corpus.txt")
    text = open(corpus_path, encoding="utf-8").read()

    # 按标点切句，过滤太短/太长的句子
    sents = [s.strip() for s in re.split(r"[。！？；\n]+", text)]
    sents = [s for s in sents if 12 <= len(s) <= 60]
    random.shuffle(sents)
    picked = sents[:140]

    # 额外加入典型歧义/未登录词/中英混合例句
    picked += [
        "自然语言处理课程与深度学习模型",
        "特朗普访华推动一带一路倡议",
        "发展中国家的人工智能产业",
        "他来到了北京清华大学计算机系",
        "南京市长江大桥",
        "研究生命的起源",
        "AI技术与大模型训练需要GPU算力",
        "这块水晶里包着红屋顶",
    ]

    cases = []
    for s in picked:
        cases.append({
            "sentence": s,
            "jieba_exact": jieba.lcut(s),
            "jieba_full": jieba.lcut(s, cut_all=True),
            "jieba_search": jieba.lcut_for_search(s),
            "jieba_nohmm": jieba.lcut(s, HMM=False),
        })

    out = os.path.join(ROOT, "tools", "verify_cases.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(cases, fh, ensure_ascii=False)
    print("wrote %d cases -> %s" % (len(cases), out))


if __name__ == "__main__":
    main()
