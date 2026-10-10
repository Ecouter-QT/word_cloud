# -*- coding: utf-8 -*-
"""
my_seg.py —— 自建分词工具（与调优）
====================================
对应实验报告 3.3 节。

实现四种算法：
  · FMM      正向最大匹配（Forward Maximum Matching）
  · BMM      逆向最大匹配（Backward Maximum Matching）
  · BIMM     双向最大匹配（含歧义消解规则）
  · HMM      纯 HMM（BMES 四状态 + Viterbi），作为统计方法基线

调优手段：
  · 扩充词典      extend(freq_sorted_words)  —— 用 jieba 结果反向扩充
  · 调整 max_len  set_max_len(n)
  · 未登录词回退  use_hmm_fallback=True（把连续单字串交给 HMM 重新组合）

用法：
    python my_seg.py                 # 在语料上跑四种策略并打印对比
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from typing import Dict, Iterable, List, Sequence, Tuple

from jieba_bootstrap import BASE_DIR, jieba, resource_path
from corpus_preprocess import load_corpus, split_sentences

CJK = re.compile(r"[\u4E00-\u9FA5]")
RE_HAN = re.compile(r"([\u4E00-\u9FA5a-zA-Z0-9+#&._%\-]+)")
RE_ENG = re.compile(r"[a-zA-Z0-9]")


# ============================================================ 分词器基类
class MaxMatchSegmenter:
    """基于词表的最大匹配分词器。"""

    def __init__(self, word_freq: Dict[str, int], max_len: int = 6,
                 strategy: str = "fmm", hmm=None, use_hmm_fallback: bool = False):
        # 只保留长度 >= 1 的词；词表用 set 加速、用 dict 记录词频
        self.freq: Dict[str, int] = dict(word_freq)
        self.vocab: set = set(self.freq)
        self.max_len = max_len
        self.strategy = strategy          # fmm | bmm | bimm
        self.hmm = hmm
        self.use_hmm_fallback = use_hmm_fallback
        # 记录被调优改动的项，便于实验报告引用
        self.tuning_log: List[str] = []

    # ---------------------------------------------------------- 属性
    @property
    def vocab_size(self) -> int:
        return len(self.vocab)

    def set_max_len(self, n: int) -> None:
        """调整最大词长（调优手段之一）。"""
        self.tuning_log.append("max_len: %d -> %d" % (self.max_len, n))
        self.max_len = n

    def extend(self, words: Iterable[str], default_freq: int = 10) -> int:
        """扩充词表（调优手段之一）。返回新增词数。"""
        added = 0
        for w in words:
            if len(w) >= 2 and w not in self.vocab:
                self.vocab.add(w)
                self.freq[w] = self.freq.get(w, default_freq)
                added += 1
        self.tuning_log.append("扩充词表: +%d 词" % added)
        return added

    def enable_hmm_fallback(self, hmm, enable: bool = True) -> None:
        """开关未登录词 HMM 回退（调优手段之一）。"""
        self.hmm = hmm
        self.use_hmm_fallback = enable
        self.tuning_log.append("HMM 回退: %s" % ("开启" if enable else "关闭"))

    # ---------------------------------------------------------- 三种匹配
    def _fmm(self, s: str) -> List[str]:
        """正向最大匹配：从前往后，尽量取最长词。"""
        out, i, n = [], 0, len(s)
        while i < n:
            for length in range(min(self.max_len, n - i), 0, -1):
                cand = s[i:i + length]
                if length == 1 or cand in self.vocab:
                    out.append(cand)
                    i += length
                    break
            else:                                   # pragma: no cover
                out.append(s[i])
                i += 1
        return out

    def _bmm(self, s: str) -> List[str]:
        """逆向最大匹配：从后往前，尽量取最长词。"""
        out, i = [], len(s)
        while i > 0:
            for length in range(min(self.max_len, i), 0, -1):
                cand = s[i - length:i]
                if length == 1 or cand in self.vocab:
                    out.insert(0, cand)
                    i -= length
                    break
            else:                                   # pragma: no cover
                out.insert(0, s[i - 1])
                i -= 1
        return out

    def _bimm(self, s: str) -> Tuple[List[str], str]:
        """
        双向最大匹配 + 歧义消解规则（工程常用）：
          1) 词数不同 -> 取词数较少者（切分更粗、语义更完整）
          2) 词数相同 -> 取单个字词较少者
          3) 仍相同   -> 取逆向结果（中文中逆向通常更稳）
        """
        f, b = self._fmm(s), self._bmm(s)
        if f == b:
            return f, "一致"
        if len(f) != len(b):
            return (f, "FMM 词数更少") if len(f) < len(b) else (b, "BMM 词数更少")
        sf = sum(1 for w in f if len(w) == 1)
        sb = sum(1 for w in b if len(w) == 1)
        if sf != sb:
            return (f, "FMM 单字更少") if sf < sb else (b, "BMM 单字更少")
        return b, "规则3：取 BMM"

    # ---------------------------------------------------------- HMM 回退
    def _apply_hmm_fallback(self, words: Sequence[str]) -> List[str]:
        """
        把连续的单字串交给 HMM 重新组合，用于缓解未登录词被切碎的问题。
        HMM 的实现直接复用 jieba.finalseg（纯统计模型，与词典无关）。
        """
        if not (self.use_hmm_fallback and self.hmm):
            return list(words)
        from jieba import finalseg

        out: List[str] = []
        buf = ""
        for w in words:
            if len(w) == 1 and CJK.match(w):
                buf += w
            else:
                if buf:
                    out.extend(finalseg.cut(buf) if len(buf) > 1 else [buf])
                    buf = ""
                out.append(w)
        if buf:
            out.extend(finalseg.cut(buf) if len(buf) > 1 else [buf])
        return out

    # ---------------------------------------------------------- 对外接口
    def cut(self, s: str) -> List[str]:
        if self.strategy == "bmm":
            words = self._bmm(s)
        elif self.strategy == "bimm":
            words, _ = self._bimm(s)
        else:
            words = self._fmm(s)
        return self._apply_hmm_fallback(words)

    def cut_with_detail(self, s: str):
        """双向匹配时返回消歧依据，便于实验分析。"""
        if self.strategy == "bimm":
            words, reason = self._bimm(s)
            return self._apply_hmm_fallback(words), reason
        return self.cut(s), ""

    def lcut(self, text: str) -> List[str]:
        """对整个文本切分：非汉字块（标点/空白）按 jieba 的方式处理。"""
        out: List[str] = []
        for blk in RE_HAN.split(text):
            if not blk:
                continue
            if RE_HAN.match(blk):
                out.extend(self.cut(blk))
            else:
                for ch in blk:
                    if not ch.isspace():
                        out.append(ch)
        return out

    def segments(self, text: str) -> List[Tuple[str, int, int]]:
        """返回 (词, 起始位置, 结束位置)，用于 P/R/F1 与差异定位。"""
        result = []
        cursor = 0
        for w in self.lcut(text):
            idx = text.find(w, cursor)
            if idx < 0:
                idx = cursor
            result.append((w, idx, idx + len(w)))
            cursor = idx + len(w)
        return result


# ============================================================ 纯 HMM 分词器
class HmmSegmenter:
    """纯 HMM 分词：只用 BMES + Viterbi，不使用任何词典。"""

    def __init__(self):
        from jieba import finalseg
        self._cut = finalseg.cut
        self.tuning_log: List[str] = []

    def lcut(self, text: str) -> List[str]:
        out: List[str] = []
        for blk in RE_HAN.split(text):
            if not blk:
                continue
            if RE_HAN.match(blk):
                out.extend(self._cut(blk))
            else:
                for ch in blk:
                    if not ch.isspace():
                        out.append(ch)
        return out


# ============================================================ 构造与演示
def load_base_vocab() -> Dict[str, int]:
    """自建工具的初始词表 = jieba 主词典（保证对比起点一致）。"""
    freq: Dict[str, int] = {}
    with open(os.path.join(BASE_DIR, "vendor", "jieba", "dict.txt"), encoding="utf-8") as fh:
        for line in fh:
            parts = line.split(" ")
            if len(parts) >= 2:
                f = int(parts[1])
                if f > 0:
                    freq[parts[0]] = f
    return freq


def build_segmenters(max_len_default: int = 6, max_len_tuned: int = 9):
    """
    构造"调优前/调优后"两套自建分词器：
      · 调优前：初始词表 + FMM + max_len=6，无 HMM 回退
      · 调优后：词表扩充 + BIMM + max_len=9 + HMM 回退
    """
    base = load_base_vocab()
    before = MaxMatchSegmenter(base, max_len=max_len_default, strategy="fmm",
                               use_hmm_fallback=False)
    after = MaxMatchSegmenter(dict(base), max_len=max_len_tuned, strategy="bimm",
                              use_hmm_fallback=True)
    return before, after


def main():
    ap = argparse.ArgumentParser(description="自建分词工具与调优")
    ap.add_argument("--corpus", default=resource_path("corpus.txt"))
    args = ap.parse_args()

    _, text = load_corpus(args.corpus)
    print("=" * 74)
    print("自建分词工具演示")
    print("=" * 74)
    print("语料：%d 字符，%d 句" % (len(text), len(split_sentences(text))))

    before, after = build_segmenters()
    print("\n调优前词表规模：%d    调优后词表规模：%d" % (before.vocab_size, after.vocab_size))

    demo = [
        "自然语言处理课程与深度学习模型",
        "特朗普访华推动一带一路倡议",
        "发展中国家的人工智能产业",
        "他来到了北京清华大学计算机系",
        "南京市长江大桥",
        "研究生命的起源",
    ]

    print("\n【1】FMM / BMM / BIMM 三种策略对比")
    mm = MaxMatchSegmenter(load_base_vocab(), max_len=6, strategy="fmm")
    for s in demo:
        f = "/".join(mm._fmm(s))
        b = "/".join(mm._bmm(s))
        bi, reason = mm._bimm(s)
        print("  原句   :", s)
        print("    FMM  :", f)
        print("    BMM  :", b)
        print("    BIMM :", "/".join(bi), "  ← 消歧依据：", reason)

    print("\n【2】词表扩充 + max_len 调整 + HMM 回退（调优前 / 调优后）")
    # 用 jieba 的结果反向扩充调优后词表
    from jieba_seg import seg_exact
    new_words = []
    seen = set()
    for w in seg_exact(text, hmm=True):
        if len(w) >= 2 and w.isalpha() and w not in after.vocab and w not in seen:
            seen.add(w)
            new_words.append(w)
    added = after.extend(new_words)
    print("  从 jieba 结果反向扩充：+%d 词" % added)

    for s in demo:
        b = "/".join(before.cut(s))
        a = "/".join(after.cut(s))
        flag = "  ← 有变化" if b != a else ""
        print("  原句   :", s)
        print("    调优前:", b)
        print("    调优后:", a, flag)

    print("\n【3】调优记录")
    for line in after.tuning_log:
        print("  ·", line)

    print("\n完成。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
