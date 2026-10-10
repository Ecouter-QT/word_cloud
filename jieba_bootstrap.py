# -*- coding: utf-8 -*-
"""
jieba_bootstrap.py —— 让仓库内的 vendor/jieba 优先于系统安装的 jieba
=====================================================================
本项目把 jieba 0.42.1（MIT 许可）随源码一起放在 vendor/jieba，
以便离线运行、并与 web/data/jieba_dict.js 导出时的词典保持严格一致。

在其他脚本里只需要：
    from jieba_bootstrap import jieba
"""
from __future__ import annotations

import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VENDOR_DIR = os.path.join(BASE_DIR, "vendor")

if os.path.isdir(os.path.join(VENDOR_DIR, "jieba")):
    if VENDOR_DIR not in sys.path:
        sys.path.insert(0, VENDOR_DIR)

import jieba  # noqa: E402

# 默认关闭缓存文件，保证每次都从 vendor/jieba/dict.txt 重新构建前缀词典，
# 避免读到用其他版本词典生成的 jieba.cache 而造成结果不一致。
jieba.dt.cache_file = ""

DICT_PATH = os.path.join(VENDOR_DIR, "jieba", "dict.txt")


def resource_path(name: str) -> str:
    """返回 data/ 目录下资源文件的绝对路径。"""
    return os.path.join(BASE_DIR, "data", name)


def load_stopwords(path: str | None = None) -> set:
    """读取停用词表（每行一个词，允许空格分隔多个）。"""
    path = path or resource_path("stopwords.txt")
    words = set()
    with open(path, "r", encoding="utf-8-sig") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            for w in line.split():
                words.add(w)
    return words


def load_user_dict(path: str | None = None):
    """读取自定义词典（词 [词频] [词性]），返回 [(词, 词频|None, 词性)]。"""
    path = path or resource_path("user_dict.txt")
    entries = []
    if not os.path.exists(path):
        return entries
    with open(path, "r", encoding="utf-8-sig") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            word = parts[0]
            freq = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
            tag = parts[2] if len(parts) > 2 else ""
            entries.append((word, freq, tag))
    return entries
