# -*- coding: utf-8 -*-
"""
build_jieba_assets.py
=====================
把 jieba 0.42.1 的词典与 HMM 模型数据导出为浏览器可直接加载的 JS 资源，
使前端页面可以不依赖后端 / 不联网地复现 jieba 的分词行为。

导出产物（web/data/）：
  jieba_dict.js      前缀词典：词 / 词频 / 词性
  jieba_hmm.js       finalseg 的 HMM 模型：起始概率、转移概率、发射概率
  jieba_pos_hmm.js   posseg 的词性标注 HMM 模型

用法：
    python tools/build_jieba_assets.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "vendor"))

OUT_DIR = os.path.join(ROOT, "web", "data")

import jieba  # noqa: E402  (vendored)
from jieba import finalseg, posseg  # noqa: E402


def js_dump(name, variable, payload, comment=""):
    """写出 `window.<variable> = <json>;` 形式的资源文件。"""
    path = os.path.join(OUT_DIR, name)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        if comment:
            fh.write("/* %s */\n" % comment)
        fh.write("window.%s = " % variable)
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write(";\n")
    size = os.path.getsize(path)
    print("  %-22s %8.2f MB" % (name, size / 1048576.0))
    return path


def export_dict():
    """导出前缀词典。dict.txt 每行：词 词频 词性"""
    words = []
    freqs = []
    tags = []
    tag_ids = {"": 0}
    total = 0
    src = os.path.join(ROOT, "vendor", "jieba", "dict.txt")
    with open(src, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line:
                continue
            parts = line.split(" ")
            word = parts[0]
            freq = int(parts[1])
            tag = parts[2] if len(parts) > 2 else ""
            words.append(word)
            freqs.append(freq)
            if tag not in tag_ids:
                tag_ids[tag] = len(tag_ids)
            tags.append(tag_ids[tag])
            total += freq
    print("  dict entries: %d, total freq: %d" % (len(words), total))
    return {
        "words": words,
        "freqs": freqs,
        "tags": tags,
        "tagNames": [t for t, _ in sorted(tag_ids.items(), key=lambda kv: kv[1])],
        "total": total,
        "median": 1,
    }


def export_hmm():
    """finalseg（jieba 内置的 BMES 隐马尔可夫模型，用于识别未登录词）。"""
    start = {k: float(v) for k, v in finalseg.start_P.items()}
    trans = {k: {k2: float(v2) for k2, v2 in v.items()} for k, v in finalseg.trans_P.items()}
    emit = {}
    for state, table in finalseg.emit_P.items():
        emit[state] = {ch: float(p) for ch, p in table.items()}
    return {"start": start, "trans": trans, "emit": emit}


def export_pos_hmm():
    """posseg：词性标注 HMM。键是 (状态, 词性) 这类元组，序列化为 'B|n'。"""
    start = {}
    for k, v in posseg.start_P.items():
        start["%s|%s" % (k[0], k[1])] = float(v)
    trans = {}
    for k, v in posseg.trans_P.items():
        key = "%s|%s" % (k[0], k[1])
        trans[key] = {"%s|%s" % (k2[0], k2[1]): float(v2) for k2, v2 in v.items()}
    emit = {}
    for k, v in posseg.emit_P.items():
        key = "%s|%s" % (k[0], k[1])
        emit[key] = {ev: float(ev_p) for ev, ev_p in v.items()}
    tab = {}
    for ch, states in posseg.char_state_tab_P.items():
        tab[ch] = ["%s|%s" % (s[0], s[1]) for s in states]
    return {"start": start, "trans": trans, "emit": emit, "charStateTab": tab}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print("exporting jieba assets -> %s" % OUT_DIR)
    js_dump("jieba_dict.js", "__JIEBA_DICT__", export_dict(),
            "jieba 0.42.1 前缀词典（词/词频/词性），由 tools/build_jieba_assets.py 生成")
    js_dump("jieba_hmm.js", "__JIEBA_HMM__", export_hmm(),
            "jieba finalseg HMM（未登录词识别），由 tools/build_jieba_assets.py 生成")
    js_dump("jieba_pos_hmm.js", "__JIEBA_POS_HMM__", export_pos_hmm(),
            "jieba posseg 词性标注 HMM，由 tools/build_jieba_assets.py 生成")
    print("done.")


if __name__ == "__main__":
    main()
