# -*- coding: utf-8 -*-
"""
make_gold.py —— 生成带原文的标注文件 data/gold.txt
==================================================
把 tools/gold_sentences.txt（编号+原文）与 tools/gold_plain.txt（纯标注行）
合并为 compare.py 需要的格式：

    # 01
    原文: 我与父亲不相见已二年余了，我最不能忘记的是他的背影
    标注: 我/与/父亲/不/相见/已/二年/余/了/，/我/最/不能/忘记/的/是/他/的/背影

并在写入前校验：标注去掉 / 之后必须与原文逐字符相同。
"""
from __future__ import annotations

import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    sent_file = os.path.join(BASE, "tools", "gold_sentences.txt")
    plain_file = os.path.join(BASE, "tools", "gold_plain.txt")
    out_file = os.path.join(BASE, "data", "gold.txt")

    sents = []
    for line in open(sent_file, encoding="utf-8"):
        line = line.rstrip("\n")
        if "\t" not in line:
            continue
        sents.append(line.split("\t", 1)[1])

    annos = []
    for line in open(plain_file, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        annos.append(line)

    assert len(sents) == len(annos), "句数不一致：%d vs %d" % (len(sents), len(annos))

    blocks = []
    for i, (s, a) in enumerate(zip(sents, annos), 1):
        rebuilt = "".join(a.split("/"))
        if rebuilt != s:
            raise SystemExit("第 %02d 句不一致：\n  原文: %r\n  标注: %r" % (i, s, rebuilt))
        blocks.append("# %02d\n原文: %s\n标注: %s" % (i, s, a))

    with open(out_file, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(blocks) + "\n")
    print("已写出 %d 句 -> %s" % (len(blocks), out_file))


if __name__ == "__main__":
    main()
