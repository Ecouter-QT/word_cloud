# -*- coding: utf-8 -*-
"""
compare.py —— 分词结果对比与指标计算
=====================================
对应实验报告 3.4 节。

指标定义（以"词边界位置"为准，这也是中文分词评测的通行做法）：
    P  = |系统切分点 ∩ 标准切分点| / |系统切分点|
    R  = |系统切分点 ∩ 标准切分点| / |标准切分点|
    F1 = 2PR / (P + R)
另附「整句完全一致率」作为辅助指标。

金标准来源：
    · 人工标注：--gold 传入标注文件（每行一句，用 / 或空格分隔词）
    · 自动银标准：多个分词器投票（某切分点被 ≥2/3 的系统选中即为标准）

用法：
    python compare.py                     # 用自动银标准对比四组结果
    python compare.py --gold data/gold.txt
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from typing import Dict, List, Sequence, Tuple

from jieba_bootstrap import BASE_DIR, load_stopwords, resource_path
from corpus_preprocess import load_corpus, split_sentences
from jieba_seg import seg_exact, seg_full, seg_search, extend_dict_from_jieba
from my_seg import HmmSegmenter, MaxMatchSegmenter, build_segmenters, load_base_vocab

CJK_RE = re.compile(r"[\u4e00-\u9fa5]")
PUNCT_RE = re.compile(r"^[\s，。！？、；：''（）《》【】—…·,.!?;:()\[\]{}<>/\\|~`@#$%^&*+=_-]+$")
NUM_RE = re.compile(r"^[0-9.]+$")


# ============================================================ 基础工具
def locate(words: Sequence[str], text: str) -> List[Tuple[str, int, int]]:
    """把词序列还原为 (词, 起始位置, 结束位置)，保证位置严格递增。"""
    out, cursor = [], 0
    for w in words:
        idx = text.find(w, cursor)
        if idx < 0:
            idx = cursor
        out.append((w, idx, idx + len(w)))
        cursor = idx + len(w)
    return out


def split_by_sentence(tokens, sentences):
    """按句子的字符区间把 token 分组。"""
    bounds = []
    pos = 0
    for s in sentences:
        bounds.append((pos, pos + len(s)))
        pos += len(s) + 1          # +1 对应被切掉的分隔符
    groups = [[] for _ in sentences]
    si = 0
    for tok in tokens:
        while si < len(bounds) - 1 and tok[1] >= bounds[si][1]:
            si += 1
        if si < len(groups):
            groups[si].append(tok)
    return groups


def score(sys_groups, gold_groups) -> Dict[str, float]:
    """按句计算切分点重合情况，汇总 P/R/F1。"""
    tp = sys_total = gold_total = 0
    exact = 0
    for gold, sys in zip(gold_groups, sys_groups):
        gb = {t[2] for t in gold}
        sb = {t[2] for t in sys}
        gold_total += len(gb)
        sys_total += len(sb)
        tp += len(gb & sb)
        if gb == sb:
            exact += 1
    p = tp / sys_total if sys_total else 0.0
    r = tp / gold_total if gold_total else 0.0
    f1 = 2 * p * r / (p + r) if (p + r) else 0.0
    n = max(len(gold_groups), 1)
    return {"precision": p, "recall": r, "f1": f1,
            "tp": tp, "sys_points": sys_total, "gold_points": gold_total,
            "exact_match": exact / n}


# ============================================================ 金标准
def parse_gold_file(path: str):
    """
    解析人工标注文件。返回 (句子列表, 每句的词列表)。

    支持两种格式：
      1) 带原文行（推荐，可自动对齐语料）：
            原文: 我与父亲不相见已二年余了
            标注: 我/与/父亲/不/相见/已/二年/余/了
      2) 纯标注行（每行一句，用 / 或空格分隔词）——此时标注本身即作为评测文本
    """
    sent_pairs: List[Tuple[str | None, List[str]]] = []
    pending_orig: str | None = None
    with open(path, "r", encoding="utf-8-sig") as fh:
        for line in fh:
            line = line.rstrip("\n").rstrip("\r")
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            m = re.match(r"^(?:原文|原句)\s*[:：]\s*(.*)$", s)
            if m:
                pending_orig = m.group(1)
                continue
            m = re.match(r"^(?:标注|分词|gold)\s*[:：]\s*(.*)$", s)
            if m:
                s = m.group(1).strip()
            parts = s.split("/") if "/" in s else s.split()
            words = [p for p in parts if p != ""]
            if not words:
                continue
            sent_pairs.append((pending_orig, words))
            pending_orig = None
    return sent_pairs


def gold_text_from_annotation(sent_pairs) -> str:
    """
    由标注还原评测文本：把每句的词直接拼接。
    用标注自身拼出的文本做评测，可以彻底避免"标注与语料切句方式不同"导致的错位。
    """
    return "\n".join("".join(words) for _, words in sent_pairs)


def parse_gold(path: str, text: str) -> List[Tuple[str, int, int]]:
    """旧接口：解析标注文件并在给定文本中定位（要求文本与之严格一致）。"""
    pairs = parse_gold_file(path)
    words: List[str] = []
    for _, wl in pairs:
        words.extend(wl)
    return locate(words, text)


def build_silver_standard(token_sets: Sequence[List[Tuple[str, int, int]]],
                          need_ratio: float = 2 / 3):
    """
    自动银标准：以 (start,end) 为键投票，被 >= ceil(n*need_ratio) 个系统选中即为标准词。
    最后按位置贪心消解重叠。
    """
    votes: Dict[Tuple[int, int], Dict] = {}
    for toks in token_sets:
        for w, s, e in toks:
            key = (s, e)
            if key not in votes:
                votes[key] = {"word": w, "start": s, "end": e, "n": 0}
            votes[key]["n"] += 1
    need = max(2, math.ceil(len(token_sets) * need_ratio))
    picked = sorted((v for v in votes.values() if v["n"] >= need),
                    key=lambda v: (v["start"], v["end"]))
    result, last_end = [], -1
    for v in picked:
        if v["start"] >= last_end:
            result.append((v["word"], v["start"], v["end"]))
            last_end = v["end"]
    return result


# ============================================================ 错误分析
def analyze_errors(sys_tokens, gold_tokens, text: str, vocab: set, stopwords: set):
    """定位系统切分与金标准不一致的位置并归类。"""
    sys_by_start = {t[1]: t for t in sys_tokens}
    gold_by_start = {t[1]: t for t in gold_tokens}
    issues: List[Dict] = []

    # a) 金标准中的词被切开或粘连
    for gw, gs, ge in gold_tokens:
        if (gs, ge) in {(t[1], t[2]) for t in sys_tokens}:
            continue
        covering, cur = [], gs
        while cur < ge:
            t = sys_by_start.get(cur)
            if t is None:
                break
            covering.append(t)
            cur = t[2]
        if len(covering) > 1:
            issues.append({
                "type": "split", "label": "切碎（过度切分）",
                "text": text[gs:ge], "gold": gw,
                "sys": "/".join(t[0] for t in covering),
                "reason": "词典策略/词频路径选择不当" if (gw in vocab) else "词典未收录该词（OOV）",
            })
        elif len(covering) == 1 and len(covering[0][0]) > len(gw):
            issues.append({
                "type": "merge", "label": "粘连（切分不足）",
                "text": text[gs:ge], "gold": gw, "sys": covering[0][0],
                "reason": "长词优先导致相邻词被合并",
            })

    # b) 系统产生而金标准没有的未登录词
    gold_pairs = {(t[1], t[2]) for t in gold_tokens}
    for sw, ss, se in sys_tokens:
        if (ss, se) in gold_pairs:
            continue
        cur = ss
        while cur < se:
            t = gold_by_start.get(cur)
            if t is None:
                break
            cur = t[2]
        if cur == se:
            continue
        if CJK_RE.match(sw) and len(sw) > 1 and sw not in vocab:
            issues.append({
                "type": "oov", "label": "未登录词（词典外）",
                "text": sw, "gold": "（金标准中不存在）", "sys": sw,
                "reason": "该词不在词典中，属工具自行识别的未登录词",
            })

    # c) 词云噪声检查
    noise: Dict[str, Dict] = {}
    for w, _, _ in sys_tokens:
        flag = None
        if PUNCT_RE.match(w):
            flag = "标点符号"
        elif NUM_RE.match(w):
            flag = "纯数字"
        elif len(w) == 1 and CJK_RE.match(w):
            flag = "单字词"
        elif w in stopwords:
            flag = "停用词"
        if flag:
            noise.setdefault(flag, {"label": flag, "count": 0, "samples": []})
            noise[flag]["count"] += 1
            if len(noise[flag]["samples"]) < 8:
                noise[flag]["samples"].append(w)

    by_type: Dict[str, int] = {}
    for it in issues:
        by_type[it["type"]] = by_type.get(it["type"], 0) + 1
    return {"issues": issues, "by_type": by_type, "noise": list(noise.values())}


# ============================================================ 主流程
def run_comparison(corpus_path: str, gold_path: str | None = None,
                   max_len_default: int = 6, max_len_tuned: int = 9):
    """
    执行完整对比，返回结果字典。

    评测文本的选择很关键：
      · 有 --gold 时，评测文本用"标注自身拼出的句子"（见 gold_text_from_annotation），
        四个系统都在这段文本上重新分词，再与该句的人工标注逐句比对。
        这样 P/R/F1 才是真正相对人工标准的指标；
        否则拿"24 句的标注"去和"整篇语料的分词"比，指标会完全失真。
      · 无 --gold 时，在整篇语料上用 4 个系统投票得到的自动银标准评测。
    """
    raw, corpus_text = load_corpus(corpus_path)
    stopwords = load_stopwords()

    # ---- 用户词典：供"调优后"的 jieba 与"调优后"的自建工具使用 ----
    from jieba_bootstrap import load_user_dict
    user_entries = load_user_dict()
    if not user_entries:
        user_entries = [
            ("自然语言处理", 5000, "nz"), ("深度学习", 4000, "n"), ("人工智能", 3000, "n"),
            ("机器学习", 3000, "n"), ("神经网络", 2500, "n"), ("大语言模型", 2500, "n"),
            ("一带一路", 3000, "nz"), ("清华大学", 3000, "nt"), ("中国科学院", 2500, "nt"),
        ]

    # ---- 1) jieba 默认：不加载用户词典、关闭 HMM（基线）----
    # 注意：jieba 是全局单例，为了让"默认"和"调优后"真正互不污染，
    # 这里分两趟独立初始化，中间用 jieba.dt.initialize() 重置词典。
    from jieba_bootstrap import jieba
    jieba.dt.user_word_tag_tab = {}
    jieba.dt.initialized = False
    jieba.dt.FREQ = {}
    jieba.initialize()
    base_freq_snapshot = dict(jieba.dt.FREQ)

    yz = None
    eval_sentences = None
    if gold_path:
        sent_pairs = parse_gold_file(gold_path)
        # 评测文本 = 标注的原始句子（保留内部空格），保证与语料切句一致
        eval_sentences = []
        for orig, words in sent_pairs:
            if orig is None:
                raise ValueError(
                    "人工标注文件必须包含『原文: ...』行，以便与语料对齐；"
                    "当前文件缺少原文行。")
            rebuilt = "".join(words)
            if rebuilt != orig:
                raise ValueError(
                    "标注与原文不一致（去掉 / 后应完全相同）：\n  原文: %r\n  标注: %r" % (orig, rebuilt))
            eval_sentences.append(orig)
        text = "\n".join(eval_sentences)
        gold_source = "人工标注（%s，%d 句 / %d 词）" % (
            os.path.basename(gold_path), len(sent_pairs), sum(len(w) for _, w in sent_pairs))
    else:
        text = corpus_text
        gold_source = "自动银标准（4 个分词器投票，超过半数一致）"

    sentences = split_sentences(text)

    # ---- 2) jieba 调优：自定义词典 + 动态加词 + 开启 HMM ----
    jieba_default_words = seg_exact(text, hmm=False)
    # 加载自定义词典（user_dict.txt）——等价于 jieba.load_userdict()
    from jieba_bootstrap import resource_path as _rp
    _ud_path = _rp("user_dict.txt")
    if os.path.exists(_ud_path):
        jieba.load_userdict(_ud_path)
    for w, f, tag in user_entries:
        jieba.add_word(w, freq=f, tag=tag)
    # suggest_freq：把"事已如此""本已"等被长词吞掉的边界调回来
    for w in ("事已如此", "本已", "便须", "第二日"):
        jieba.suggest_freq(w, False)
    jieba_tuned_words = seg_exact(text, hmm=True)
    user_dict_info = {
        "path": _ud_path if os.path.exists(_ud_path) else None,
        "count": len(user_entries),
        "new_words": sum(1 for w, _, _ in user_entries if w not in base_freq_snapshot),
        "words": [w for w, _, _ in user_entries][:40],
    }

    # ---- 3) 自建默认 / 4) 自建调优 ----
    mm_before, mm_after = build_segmenters(max_len_default, max_len_tuned)
    self_default_words = mm_before.lcut(text)
    extended = [w for w in jieba_tuned_words
                if len(w) >= 2 and w.isalpha() and w not in mm_after.vocab]
    added = mm_after.extend(extended)
    self_tuned_words = mm_after.lcut(text)

    variants = [
        ("jieba_default", "jieba（默认）", jieba_default_words, load_base_vocab()),
        ("jieba_tuned", "jieba（调优后）", jieba_tuned_words, load_base_vocab()),
        ("self_default", "自建工具（默认）", self_default_words, mm_before.vocab),
        ("self_tuned", "自建工具（调优后）", self_tuned_words, mm_after.vocab),
    ]

    # ---- 金标准 ----
    if gold_path:
        # 用标注直接构造标准 token（位置按"标注拼接文本"计算）
        gold = []
        pos = 0
        for i, (_, words) in enumerate(sent_pairs):
            for w in words:
                gold.append((w, pos, pos + len(w)))
                pos += len(w)
            pos += 1     # 句子之间用 \n 连接
        gold_sentences = eval_sentences
    else:
        token_sets = [locate(v[2], text) for v in variants]
        gold = build_silver_standard(token_sets)
        gold_sentences = sentences

    # 评测用的句子边界（与金标准严格对齐）
    if gold_path:
        bounds, p = [], 0
        for s in eval_sentences:
            bounds.append((p, p + len(s)))
            p += len(s) + 1
    else:
        bounds, p = [], 0
        for s in sentences:
            bounds.append((p, p + len(s)))
            p += len(s) + 1

    def group(tokens):
        groups = [[] for _ in bounds]
        gi = 0
        for tok in tokens:
            while gi < len(bounds) - 1 and tok[1] >= bounds[gi][1]:
                gi += 1
            groups[gi].append(tok)
        return groups

    gold_groups = group(gold)

    # ---- 指标 ----
    metrics: Dict[str, Dict] = {}
    errors: Dict[str, Dict] = {}
    results: Dict[str, List[Tuple[str, int, int]]] = {}
    for key, label, words, vocab in variants:
        toks = locate(words, text)
        results[key] = toks
        m = score(group(toks), gold_groups)
        m["label"] = label
        m["word_count"] = len(toks)
        m["boundaries"] = len(toks)
        metrics[key] = m
        errors[key] = analyze_errors(toks, gold, text, vocab, stopwords)

    # ---- 调优前后差异 ----
    def diff(before, after):
        b_map = {t[2]: t for t in before}
        a_map = {t[2]: t for t in after}
        points = sorted({t[1] for t in before} | {t[2] for t in before} |
                        {t[1] for t in after} | {t[2] for t in after})
        out = []
        for i in range(len(points) - 1):
            s, e = points[i], points[i + 1]
            bw = b_map.get(e) if (e in b_map and b_map[e][1] == s) else None
            aw = a_map.get(e) if (e in a_map and a_map[e][1] == s) else None
            if bool(bw) == bool(aw):
                continue
            out.append({
                "text": text[s:e],
                "before": bw[0] if bw else None,
                "after": aw[0] if aw else None,
                "side": "before" if bw else "after",
                "start": s, "end": e,
            })
        return out

    # ---- 词频（始终基于完整语料，词云需要覆盖全篇） ----
    from wordcloud_gen import build_frequencies
    freq = build_frequencies(corpus_text, stopwords, min_len=2, max_len=12)

    return {
        "corpus": corpus_path,
        "eval_text": text,
        "eval_is_annotation": bool(gold_path),
        "stats": {
            "原始字符数": len(raw),
            "清洗后字符数": len(corpus_text),
            "汉字数": len(re.findall(r"[\u4e00-\u9fa5]", corpus_text)),
            "句子数": len(split_sentences(corpus_text)),
            "评测文本字符数": len(text),
            "评测句子数": len(bounds),
        },
        "gold_source": gold_source,
        "gold": gold,
        "metrics": metrics,
        "errors": errors,
        "results": results,
        "diffs_jieba": diff(results["jieba_default"], results["jieba_tuned"]),
        "diffs_self": diff(results["self_default"], results["self_tuned"]),
        "frequencies": freq,
        "extended_count": added,
        "stopword_count": len(stopwords),
        "self_tuning_log": mm_after.tuning_log,
        "user_dict_info": user_dict_info,
    }


def main():
    ap = argparse.ArgumentParser(description="分词结果对比与指标计算")
    ap.add_argument("--corpus", default=resource_path("corpus.txt"))
    ap.add_argument("--gold", default=None, help="人工标注文件路径")
    ap.add_argument("--out", default=os.path.join(BASE_DIR, "report", "metrics.json"))
    args = ap.parse_args()

    res = run_comparison(args.corpus, args.gold)

    print("=" * 78)
    print("分词结果对比分析")
    print("=" * 78)
    print("语料：%s" % args.corpus)
    for k, v in res["stats"].items():
        print("  %-12s %d" % (k, v))
    print("金标准：%s（%d 词）" % (res["gold_source"], len(res["gold"])))
    print()
    print("%-18s %10s %10s %10s %10s %10s" %
          ("分词工具", "准确率P", "召回率R", "F1值", "输出词数", "整句一致率"))
    print("-" * 78)
    for key in ["jieba_default", "jieba_tuned", "self_default", "self_tuned"]:
        m = res["metrics"][key]
        print("%-18s %9.2f%% %9.2f%% %9.2f%% %10d %9.1f%%" % (
            m["label"], m["precision"] * 100, m["recall"] * 100, m["f1"] * 100,
            m["word_count"], m["exact_match"] * 100))

    print()
    print("错误类型分布")
    print("-" * 78)
    labels = {"split": "切碎", "merge": "粘连", "oov": "未登录词"}
    for t, name in labels.items():
        row = "  %-8s" % name
        for key in ["jieba_default", "jieba_tuned", "self_default", "self_tuned"]:
            row += "%18d" % res["errors"][key]["by_type"].get(t, 0)
        print(row)

    print()
    print("调优前后差异片段：jieba %d 处，自建工具 %d 处"
          % (len(res["diffs_jieba"]), len(res["diffs_self"])))
    print("自建词典反向扩充：+%d 词" % res["extended_count"])

    # 写出 JSON（去掉不可序列化的内容）
    out = {
        "stats": res["stats"],
        "gold_source": res["gold_source"],
        "gold_count": len(res["gold"]),
        "metrics": res["metrics"],
        "errors_by_type": {k: v["by_type"] for k, v in res["errors"].items()},
        "errors_issues": {k: v["issues"][:120] for k, v in res["errors"].items()},
        "noise": {k: v["noise"] for k, v in res["errors"].items()},
        "diffs_jieba": res["diffs_jieba"][:200],
        "diffs_self": res["diffs_self"][:200],
        "freq_top": sorted(res["frequencies"].items(), key=lambda kv: -kv[1])[:120],
        "extended_count": res["extended_count"],
        "stopword_count": res["stopword_count"],
        "self_tuning_log": res["self_tuning_log"],
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print("\n指标已写出 -> %s" % args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
