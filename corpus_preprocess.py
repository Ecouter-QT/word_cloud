# -*- coding: utf-8 -*-
"""
corpus_preprocess.py —— 语料读取与预处理
========================================
对应实验报告 3.1 节。所有其他脚本都复用这里的 clean_text()。

预处理步骤：
  1. 去除 HTML 标签、HTML 实体、URL；
  2. 去除零宽字符与 BOM；
  3. 统一换行符、全角空格与连续空白；
  4. 统一编码为 UTF-8（读取时显式指定 encoding，并对 BOM 做兼容）。

用法：
    python corpus_preprocess.py            # 处理 data/corpus.txt，打印统计
    python corpus_preprocess.py --out data/corpus_clean.txt
"""
from __future__ import annotations

import argparse
import os
import re
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")

# --- 清洗用正则 -------------------------------------------------------------
RE_HTML = re.compile(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>|<[^>]+>", re.I)
RE_ENTITY = re.compile(r"&[a-zA-Z#0-9]{1,8};")
RE_URL = re.compile(r"https?://[^\s，。；）)】\]]+")
RE_ZERO_WIDTH = re.compile(r"[\u200B-\u200F\u202A-\u202E\uFEFF]")
# 只保留：汉字、字母数字、常用中文标点、基础西文标点与空白
RE_KEEP = re.compile(
    r"[^\u4E00-\u9FA5a-zA-Z0-9"
    r"\u3000-\u303F\uFF00-\uFFEF"
    r"，。！？、；：''（）《》〈〉【】「」『』—…·％＋－×÷＝"
    r",.\-!?;:()\[\]{}<>/\\|~`@#$%^&*+=_\s]"
)

# 篇名 / 作者元信息行（语料文件格式约定）
RE_META_LINE = re.compile(r"^【(篇名|作者)】.*$", re.M)


def clean_text(raw: str, keep_punct: bool = True) -> str:
    """核心清洗函数：返回适合分词的纯文本。"""
    text = raw
    text = RE_HTML.sub(" ", text)
    text = RE_ENTITY.sub(" ", text)
    text = RE_URL.sub(" ", text)
    text = RE_ZERO_WIDTH.sub("", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u3000", " ")          # 全角空格
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r"\n{2,}", "\n", text)
    if not keep_punct:
        text = re.sub(r"[\u3000-\u303F\uFF00-\uFFEF，。！？、；：''（）《》—…·]", " ", text)
    text = RE_KEEP.sub(" ", text)
    text = re.sub(r" {2,}", " ", text)
    return text


def strip_meta(text: str) -> str:
    """去掉语料文件里的【篇名】/【作者】行，只留正文。"""
    return RE_META_LINE.sub("", text)


def stats(raw: str, cleaned: str) -> dict:
    """统计原始/清洗后的规模，用于报告引用。"""
    return {
        "原始字符数": len(raw),
        "清洗后字符数": len(cleaned),
        "去除字符数": len(raw) - len(cleaned),
        "汉字数": len(re.findall(r"[\u4E00-\u9FA5]", cleaned)),
        "句子数": len(split_sentences(cleaned)),
    }


def split_sentences(text: str):
    """按中文句末标点与换行切句，返回句子字符串列表。"""
    parts = re.split(r"[。！？；\n]+", text)
    return [s.strip() for s in parts if s.strip()]


def load_corpus(path: str, keep_punct: bool = True):
    """读取语料文件 -> (原文, 清洗后正文, 去掉元信息后的正文)。"""
    with open(path, "r", encoding="utf-8-sig") as fh:
        raw = fh.read()
    body = strip_meta(raw)
    cleaned = clean_text(body, keep_punct=keep_punct)
    return raw, cleaned


def main():
    ap = argparse.ArgumentParser(description="语料读取与预处理")
    ap.add_argument("--corpus", default=os.path.join(DATA_DIR, "corpus.txt"))
    ap.add_argument("--out", default="")
    ap.add_argument("--no-punct", action="store_true", help="同时剔除标点")
    args = ap.parse_args()

    raw, cleaned = load_corpus(args.corpus, keep_punct=not args.no_punct)
    st = stats(raw, cleaned)
    print("语料文件：%s" % args.corpus)
    for k, v in st.items():
        print("  %-12s %d" % (k, v))
    titles = re.findall(r"【篇名】(.*)", raw)
    authors = re.findall(r"【作者】(.*)", raw)
    print("  篇目：%d 篇" % len(titles))
    for t, a in zip(titles, authors):
        print("    · 《%s》 %s" % (t, a))

    if args.out:
        with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(cleaned)
        print("已写出清洗结果 ->", args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
