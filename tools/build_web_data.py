# -*- coding: utf-8 -*-
"""
build_web_data.py —— 生成前端所需的全部数据资源
================================================
前端要能"双击 index.html 直接打开"（file:// 协议）也能正常工作，
因此不能依赖 fetch 读取本地文件，需要把关键数据内联成 JS：

    web/data/stopwords.js   内置停用词表（1368 词）
    web/data/sample.txt     示例语料（由 data/corpus.txt 复制）
    web/data/gold.txt       人工标注金标准（供"人工标注"输入框演示）
    web/data/jieba_dict.js  jieba 词典（由 tools/build_jieba_assets.py 生成）
    web/data/jieba_hmm.js   jieba HMM 模型（同上）

用法：
    python tools/build_web_data.py
"""
from __future__ import annotations

import json
import os
import shutil
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
WEB_DATA = os.path.join(BASE, "web", "data")


def build_stopwords():
    src = os.path.join(DATA, "stopwords.txt")
    words, seen, out = [], set(), []
    with open(src, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            for w in line.split():
                if w not in seen:
                    seen.add(w)
                    out.append(w)
    text = "\n".join(out)
    dst = os.path.join(WEB_DATA, "stopwords.js")
    with open(dst, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("/* 内置停用词表（共 %d 词），由 data/stopwords.txt 生成。\n" % len(out))
        fh.write("   用 JS 内联是为了让页面直接双击（file://）打开时也能正常过滤停用词，\n")
        fh.write("   不依赖任何网络请求。重新生成：python tools/build_web_data.py */\n")
        fh.write("window.__STOPWORDS__ = ")
        json.dump(text, fh, ensure_ascii=False)
        fh.write(";\n")
    print("stopwords.js  %d 词  %.1f KB" % (len(out), os.path.getsize(dst) / 1024))
    return len(out)


def copy_file(src_name, dst_name, label):
    src = os.path.join(DATA, src_name)
    if not os.path.exists(src):
        print("跳过 %s（%s 不存在）" % (dst_name, src))
        return False
    shutil.copyfile(src, os.path.join(WEB_DATA, dst_name))
    print("%-14s <- data/%s  %.1f KB" % (dst_name, src_name,
                                        os.path.getsize(src) / 1024))
    return True


def build_sample_js():
    """把示例语料也内联成 JS，保证 file:// 双击打开时"载入示例语料"可用。"""
    src = os.path.join(DATA, "corpus.txt")
    if not os.path.exists(src):
        print("跳过 sample.js（data/corpus.txt 不存在）")
        return False
    with open(src, encoding="utf-8") as fh:
        text = fh.read()
    dst = os.path.join(WEB_DATA, "sample.js")
    with open(dst, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("/* 示例语料（%d 字符），由 data/corpus.txt 生成。\n" % len(text))
        fh.write("   内联以便 file:// 直接打开时\"载入示例语料\"可用。\n")
        fh.write("   重新生成：python tools/build_web_data.py */\n")
        fh.write("window.__SAMPLE_CORPUS__ = ")
        json.dump(text, fh, ensure_ascii=False)
        fh.write(";\n")
    print("%-14s <- data/corpus.txt  %.1f KB" % ("sample.js", os.path.getsize(dst) / 1024))
    return True


def main():
    os.makedirs(WEB_DATA, exist_ok=True)
    print("生成前端数据资源 -> %s" % WEB_DATA)
    n = build_stopwords()
    copy_file("corpus.txt", "sample.txt", "示例语料")
    copy_file("gold.txt", "gold.txt", "人工标注")
    build_sample_js()
    for name in ("jieba_dict.js", "jieba_hmm.js"):
        p = os.path.join(WEB_DATA, name)
        if os.path.exists(p):
            print("%-14s 已存在  %.1f MB" % (name, os.path.getsize(p) / 1048576))
        else:
            print("%-14s 缺失！请先运行 python tools/build_jieba_assets.py" % name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
