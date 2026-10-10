# -*- coding: utf-8 -*-
"""
jieba_seg.py —— jieba 分词与调优
=================================
对应实验报告 3.2 节。

覆盖内容：
  1. 三种切分模式：精确模式 lcut() / 全模式 cut_all=True / 搜索引擎模式 lcut_for_search()
  2. 四种调优手段：
     · 自定义词典      jieba.load_userdict('user_dict.txt')
     · 动态添加词      jieba.add_word(word, freq, tag)
     · 调整词频        jieba.suggest_freq(word, tune=True)
     · 关闭/开启 HMM   jieba.lcut(text, HMM=False)

用法：
    python jieba_seg.py                 # 演示各模式与调优前后的差异
    python jieba_seg.py --demo          # 只跑小样本演示
"""
from __future__ import annotations

import argparse
import os
import sys
from typing import Dict, List

from jieba_bootstrap import BASE_DIR, jieba, load_stopwords, load_user_dict, resource_path
from corpus_preprocess import load_corpus, split_sentences

# 关闭 HMM 时需要用到 jieba 内部的分词器实例
_DT = jieba.dt


# --------------------------------------------------------------------- 基础分词
def seg_exact(text: str, hmm: bool = True) -> List[str]:
    """精确模式：jieba.lcut(text, HMM=hmm)"""
    return jieba.lcut(text, HMM=hmm)


def seg_full(text: str) -> List[str]:
    """全模式：jieba.lcut(text, cut_all=True)"""
    return jieba.lcut(text, cut_all=True)


def seg_search(text: str, hmm: bool = True) -> List[str]:
    """搜索引擎模式：jieba.lcut_for_search(text, HMM=hmm)"""
    return jieba.lcut_for_search(text, HMM=hmm)


# --------------------------------------------------------------------- 调优
def apply_user_dict(entries) -> Dict[str, int]:
    """把自定义词典条目加入 jieba。返回 {词: 加入后的词频}。"""
    added: Dict[str, int] = {}
    for word, freq, tag in entries:
        if freq:
            jieba.add_word(word, freq=freq, tag=tag or None)
        else:
            jieba.add_word(word, tag=tag or None)
        added[word] = jieba.dt.FREQ.get(word, 0)
    return added


def load_user_dict_file(path: str) -> Dict[str, int]:
    """等价于 jieba.load_userdict(path)，但返回可展示的统计信息。"""
    before = {}
    entries = load_user_dict(path)
    for word, _, _ in entries:
        before[word] = jieba.dt.FREQ.get(word)
    jieba.load_userdict(path)
    now = {w: jieba.dt.FREQ.get(w, 0) for w, _, _ in entries}
    return {"path": path, "count": len(entries), "freq": now, "before": before}


def tune_freq(word: str, tune: bool = True) -> Dict[str, object]:
    """调整词频：suggest_freq(word, tune)。返回调整前后的词频。"""
    before = jieba.dt.FREQ.get(word)
    jieba.suggest_freq(word, tune)
    return {"word": word, "before": before, "after": jieba.dt.FREQ.get(word), "tune": tune}


def tune_freq_pairs(pairs) -> List[Dict[str, object]]:
    """suggest_freq 也支持元组形式：jieba.suggest_freq(('中', '将'), True)"""
    out = []
    for pair in pairs:
        before = jieba.dt.FREQ.get("".join(pair))
        jieba.suggest_freq(pair, True)
        out.append({"pair": pair, "before": before, "after": jieba.dt.FREQ.get("".join(pair))})
    return out


def tune_max_len(new_len: int) -> Dict[str, int]:
    """
    调整 jieba 允许的最大词长（对应自建工具的 max_len 调优思路）。
    jieba 内部用 re_han 的匹配长度决定词长上限，这里通过 monkey patch
    演示"限制最长词"的效果；返回修改前后的值。
    """
    old = getattr(jieba.dt, "_max_word_len", 0)
    jieba.dt._max_word_len = new_len
    return {"before": old, "after": new_len}


# --------------------------------------------------------- 用分词结果反向扩词典
def extend_dict_from_jieba(text: str, min_len: int = 2, limit: int | None = None) -> List[str]:
    """
    把 jieba 识别出、但自建词典里没有的词收集起来，用于反向扩充自建工具词表
    （对应实验要求中的"用 jieba 结果反向扩充词典"）。
    """
    self_dict = load_self_dict()
    new_words: List[str] = []
    seen = set()
    for w in seg_exact(text, hmm=True):
        if len(w) < min_len or not w.isalpha():
            continue
        if w in self_dict or w in seen:
            continue
        seen.add(w)
        new_words.append(w)
        if limit and len(new_words) >= limit:
            break
    return new_words


def load_self_dict() -> set:
    """自建工具的初始词表 = jieba 主词典（保证两者起点一致，便于对比）。"""
    words = set()
    with open(os.path.join(BASE_DIR, "vendor", "jieba", "dict.txt"), encoding="utf-8") as fh:
        for line in fh:
            parts = line.split(" ")
            if len(parts) >= 2 and int(parts[1]) > 0:
                words.add(parts[0])
    return words


# --------------------------------------------------------------------- 演示
DEMO_SENTENCES = [
    "自然语言处理课程与深度学习模型",
    "特朗普访华推动一带一路倡议",
    "发展中国家的人工智能产业",
    "他来到了北京清华大学计算机系",
    "南京市长江大桥",
    "研究生命的起源",
    "AI技术与大模型训练需要GPU算力",
]


def main():
    ap = argparse.ArgumentParser(description="jieba 分词与调优")
    ap.add_argument("--demo", action="store_true", help="只跑小样本演示")
    args = ap.parse_args()

    print("=" * 74)
    print("jieba 版本：%s      词典：%s" % (jieba.__version__, resource_path("stopwords.txt")))
    print("=" * 74)

    if args.demo:
        text = "。".join(DEMO_SENTENCES)
    else:
        _, text = load_corpus(resource_path("corpus.txt"))
    print("语料规模：%d 字符，%d 句" % (len(text), len(split_sentences(text))))

    # ---------- 1. 三种模式 ----------
    print("\n【1】三种切分模式（前 60 个词）")
    print("  精确模式  :", "/".join(seg_exact(text)[:60]))
    print("  全模式    :", "/".join(seg_full(text)[:60]))
    print("  搜索模式  :", "/".join(seg_search(text)[:60]))

    # ---------- 2. HMM 开关 ----------
    print("\n【2】HMM 开关对未登录词的影响")
    sample = DEMO_SENTENCES[0]
    print("  例句      :", sample)
    print("  HMM=True  :", "/".join(seg_exact(sample, hmm=True)))
    print("  HMM=False :", "/".join(seg_exact(sample, hmm=False)))

    # ---------- 3. 自定义词典 + 动态加词 ----------
    print("\n【3】自定义词典 / 动态加词（调优前 -> 调优后）")
    for s in DEMO_SENTENCES[:4]:
        before = "/".join(seg_exact(s))
        jieba.add_word("自然语言处理", freq=5000, tag="nz")
        jieba.add_word("深度学习", freq=4000, tag="n")
        jieba.add_word("人工智能", freq=3000, tag="n")
        jieba.add_word("一带一路", freq=3000, tag="nz")
        jieba.add_word("清华大学", freq=3000, tag="nt")
        after = "/".join(seg_exact(s))
        print("  原句      :", s)
        print("    调优前  :", before)
        print("    调优后  :", after)

    # ---------- 4. suggest_freq ----------
    print("\n【4】suggest_freq 调整词频")
    for info in tune_freq_pairs([("中", "将"), ("国", "家")]):
        print("  %s -> 词频 %s => %s" % ("".join(info["pair"]), info["before"], info["after"]))

    # ---------- 5. 词频统计（供词云使用） ----------
    stopwords = load_stopwords()
    words = [w for w in seg_exact(text) if w not in stopwords and len(w) > 1]
    freq: Dict[str, int] = {}
    for w in words:
        freq[w] = freq.get(w, 0) + 1
    top = sorted(freq.items(), key=lambda kv: -kv[1])[:20]
    print("\n【5】过滤停用词后的高频词（前 20，停用词表 %d 词）" % len(stopwords))
    print("  " + "、".join("%s(%d)" % (w, c) for w, c in top))

    # ---------- 6. 反向扩充自建词典 ----------
    new_words = extend_dict_from_jieba(text, limit=30)
    print("\n【6】用 jieba 结果反向扩充自建词典（示例前 30 个）")
    print("  " + "、".join(new_words))

    print("\n完成。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
