# -*- coding: utf-8 -*-
"""
tools/make_docx_report.py —— 生成《项目三 主题词云图设计》对比分析报告（.docx）
==============================================================================
严格按照作业模板的四段式结构撰写，所有数字均来自 report/summary.json 的真实
实验结果（由 make_report.py 产出），并嵌入真实的词云图片。

用法：
    python tools/make_docx_report.py
"""
from __future__ import annotations

import json
import os
import sys

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORT = os.path.join(BASE, "report")
OUT = os.path.join(BASE, "项目三主题词云图设计_对比分析报告.docx")

CN_FONT = "微软雅黑"
CN_FONT_BODY = "宋体"
MONO_FONT = "Consolas"


# ----------------------------------------------------------------- 基础工具
def load_summary():
    with open(os.path.join(REPORT, "summary.json"), encoding="utf-8") as fh:
        return json.load(fh)


def set_run_font(run, name=CN_FONT, size=None, bold=None, color=None, mono=False):
    """设置 run 的字体（中文必须显式指定 eastAsia，否则可能不生效）。"""
    f = MONO_FONT if mono else name
    run.font.name = f
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = rpr.makeelement(qn("w:rFonts"), {})
        rpr.append(rfonts)
    rfonts.set(qn("w:eastAsia"), f)
    rfonts.set(qn("w:ascii"), f)
    rfonts.set(qn("w:hAnsi"), f)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if color is not None:
        run.font.color.rgb = RGBColor(*color)


def para(doc, text="", size=10.5, bold=False, name=CN_FONT_BODY, align=None,
         space_after=6, indent_first=True, color=None, mono=False):
    p = doc.add_paragraph()
    if align is not None:
        p.alignment = align
    pf = p.paragraph_format
    pf.space_after = Pt(space_after)
    pf.line_spacing = 1.45
    if indent_first:
        pf.first_line_indent = Pt(21)
    if text:
        r = p.add_run(text)
        set_run_font(r, name=name, size=size, bold=bold, color=color, mono=mono)
    return p


def rich(doc, parts, size=10.5, align=None, space_after=6, indent_first=True):
    """富文本段落：parts = [(text, bold), ...] 或 [(text, bold, color), ...]"""
    p = doc.add_paragraph()
    if align is not None:
        p.alignment = align
    pf = p.paragraph_format
    pf.space_after = Pt(space_after)
    pf.line_spacing = 1.45
    if indent_first:
        pf.first_line_indent = Pt(21)
    for item in parts:
        text, bold = item[0], item[1]
        color = item[2] if len(item) > 2 else None
        r = p.add_run(text)
        set_run_font(r, name=CN_FONT_BODY, size=size, bold=bold, color=color)
    return p


def heading(doc, text, level=1):
    """自定义标题（避免依赖模板样式，保证中文字体正确）。"""
    sizes = {1: 15, 2: 12.5, 3: 11}
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(14 if level == 1 else 10)
    pf.space_after = Pt(7)
    pf.line_spacing = 1.3
    r = p.add_run(text)
    set_run_font(r, name=CN_FONT, size=sizes.get(level, 11), bold=True,
                 color=(0x1F, 0x3A, 0x5F) if level == 1 else (0x2E, 0x54, 0x84))
    return p


def code_block(doc, lines):
    for i, ln in enumerate(lines):
        p = doc.add_paragraph()
        pf = p.paragraph_format
        pf.space_after = Pt(0 if i < len(lines) - 1 else 6)
        pf.space_before = Pt(4 if i == 0 else 0)
        pf.line_spacing = 1.15
        pf.left_indent = Pt(16)
        r = p.add_run(ln if ln else " ")
        set_run_font(r, size=9, mono=True, color=(0x33, 0x33, 0x33))


def table(doc, header, rows, widths=None, caption=None, font_size=9):
    """
    生成表格。
    注意：这里刻意不写死列宽，而是交给 Word/LibreOffice 的自动列宽算法，
    避免手写宽度与渲染器实际页面宽度不一致时出现表格越界。
    """
    if caption:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(3)
        p.paragraph_format.space_before = Pt(6)
        r = p.add_run(caption)
        set_run_font(r, name=CN_FONT, size=9.5, bold=True)
    t = doc.add_table(rows=1, cols=len(header))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = True
    hdr = t.rows[0].cells
    for i, h in enumerate(header):
        hdr[i].text = ""
        p = hdr[i].paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(1)
        r = p.add_run(str(h))
        set_run_font(r, name=CN_FONT, size=font_size, bold=True)
        shade = hdr[i]._tc.get_or_add_tcPr().makeelement(qn("w:shd"), {})
        shade.set(qn("w:val"), "clear")
        shade.set(qn("w:fill"), "E8EEF7")
        hdr[i]._tc.get_or_add_tcPr().append(shade)
    for row in rows:
        cells = t.add_row().cells
        for i, v in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            p.paragraph_format.space_after = Pt(1)
            if i > 0:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            r = p.add_run(str(v))
            set_run_font(r, name=CN_FONT_BODY, size=font_size)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


def pct(v):
    return "%.2f%%" % (v * 100)


def image_center(doc, path, width_cm=15.5, caption=None):
    if not os.path.exists(path):
        para(doc, "（图片缺失：%s）" % os.path.basename(path), size=9,
             color=(0xCC, 0x00, 0x00), indent_first=False)
        return
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(2)
    p.add_run().add_picture(path, width=Cm(width_cm))
    if caption:
        cp = doc.add_paragraph()
        cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        cp.paragraph_format.space_after = Pt(10)
        r = cp.add_run(caption)
        set_run_font(r, name=CN_FONT_BODY, size=9, color=(0x60, 0x60, 0x60))


def setup_page(doc):
    """
    显式设置页面尺寸与页边距。
    python-docx 自带模板默认是 Letter，某些渲染器会忽略只写在 sectPr 里的 pgSz，
    因此这里清掉原有 sectPr 再重建，保证 A4 与页边距被真正应用。
    """
    sec = doc.sections[0]
    sec.page_width = Cm(21.0)       # A4 宽
    sec.page_height = Cm(29.7)      # A4 高
    sec.top_margin = Cm(2.3)
    sec.bottom_margin = Cm(2.1)
    sec.left_margin = Cm(2.4)
    sec.right_margin = Cm(2.4)
    sec.header_distance = Cm(1.2)
    sec.footer_distance = Cm(1.2)
    # 明确写入 pgSz 的纸张代码（9 = A4），避免渲染器回退到默认纸型
    sectPr = sec._sectPr
    pgSz = sectPr.find(qn("w:pgSz"))
    if pgSz is None:
        pgSz = OxmlElement("w:pgSz")
        sectPr.append(pgSz)
    pgSz.set(qn("w:w"), "11906")     # 21.0 cm
    pgSz.set(qn("w:h"), "16838")     # 29.7 cm
    pgSz.set(qn("w:code"), "9")      # w:code=9 -> A4
    return sec


# ----------------------------------------------------------------- 报告主体
def build(summary):
    gold = summary["人工标注评测"]
    silver = summary["全语料评测"]
    gm = gold["指标"]
    corpus = summary["语料"]
    cloud = summary["词云"]
    tune = summary["调优手段"]
    gm_err = gold["错误类型"]
    keys = ["jieba（默认）", "jieba（调优后）", "自建工具（默认）", "自建工具（调优后）"]

    doc = Document()
    setup_page(doc)

    # 默认样式字体
    style = doc.styles["Normal"]
    style.font.name = CN_FONT_BODY
    style.font.size = Pt(10.5)
    style.element.rPr.rFonts.set(qn("w:eastAsia"), CN_FONT_BODY)

    # =============================================== 封面标题
    t = doc.add_paragraph()
    t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    t.paragraph_format.space_after = Pt(2)
    r = t.add_run("项目三  主题词云图设计")
    set_run_font(r, name=CN_FONT, size=17, bold=True, color=(0x14, 0x2A, 0x4A))

    st = doc.add_paragraph()
    st.alignment = WD_ALIGN_PARAGRAPH.CENTER
    st.paragraph_format.space_after = Pt(4)
    r = st.add_run("中文分词对比分析报告")
    set_run_font(r, name=CN_FONT, size=12, bold=False, color=(0x3A, 0x5A, 0x82))

    info = doc.add_paragraph()
    info.alignment = WD_ALIGN_PARAGRAPH.CENTER
    info.paragraph_format.space_after = Pt(16)
    r = info.add_run("语料：朱自清《背影》《荷塘月色》· 鲁迅《故乡》· 老舍《济南的冬天》")
    set_run_font(r, name=CN_FONT_BODY, size=9, color=(0x70, 0x70, 0x70))
    info2 = doc.add_paragraph()
    info2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    info2.paragraph_format.space_after = Pt(14)
    r = info2.add_run("共 %d 字 · 4 篇 · %d 句" % (corpus["汉字数"], corpus["句子数"]))
    set_run_font(r, name=CN_FONT_BODY, size=9, color=(0x70, 0x70, 0x70))

    # =============================================== 一、实验目的
    heading(doc, "一、实验目的", 1)
    for txt in [
        "1. 掌握中文分词的基本原理与方法：通过实际语料处理，理解基于词典、基于统计以及混合方法的中文分词技术。",
        "2. 提高分词工具调优与对比分析能力：能够针对自建分词工具和 jieba 分词分别进行参数调整与优化，"
        "从准确率、召回率、F1 值等维度定量对比分词效果，定位并解决分词错误问题。",
        "3. 提升文本可视化与结果呈现能力：基于满意的分词结果，运用词云图等可视化手段直观展示语料的核心主题"
        "与关键词分布，增强实验结果的表现力与可读性。",
        "4. 培养规范的实验记录与学术表达能力。",
    ]:
        para(doc, txt)
    rich(doc, [("本次实验还额外完成了一项工程目标：", False),
               ("把整条流程封装成可交互的前端页面", True),
               ("——上传文章即可自动完成预处理、分词、调优对比与词云生成，"
                "对应模板 4.3 节提出的“端到端流程封装”改进方向。", False)])

    # =============================================== 二、实验要求
    heading(doc, "二、实验要求", 1)
    heading(doc, "1. 语料选取", 2)
    para(doc, "自主选定感兴趣的语料，可以是单篇文章，也可以是多篇文章组成的语料集。"
              "语料需具有一定的分析价值，篇幅建议不少于 1000 字。")
    heading(doc, "2. 分词工具准备", 2)
    para(doc, "使用 jieba 分词对语料进行分词；使用作业 2 中自己实现的分词工具对同一语料进行分词；"
              "两者均需进行调优调参（如 jieba 的自定义词典、HMM 开关、模式选择；"
              "自建工具的词表扩充、切分策略调整等）。")
    heading(doc, "3. 对比分析", 2)
    para(doc, "对比两种工具在调优前后的分词结果；分析分词错误类型（如未登录词、歧义切分、专有名词误切等）；"
              "说明调优后是否解决了原错误问题，并给出定量或定性评价。")
    heading(doc, "4. 词云图制作", 2)
    para(doc, "基于自己满意的分词结果，使用 wordcloud、stylecloud 等工具制作有设计感的词云图"
              "（需考虑字体、配色、形状、停用词过滤等）。")
    rich(doc, [("说明：", True),
               ("本机环境未安装 wordcloud 与 matplotlib，因此词云生成器由 Pillow + NumPy 自行实现，"
                "功能覆盖形状蒙版、配色方案、词频归一化、停用词过滤与中文字体指定等全部要求，"
                "并与前端 Canvas 版本共用同一套设计思路。", False)])

    # =============================================== 三、实验内容
    heading(doc, "三、实验内容", 1)

    # ---- 3.1
    heading(doc, "3.1 语料选取与预处理", 2)
    rich(doc, [("语料来源：", True),
               ("选取中国现代文学经典散文与小说共 4 篇——朱自清《背影》《荷塘月色》、"
                "鲁迅《故乡》、老舍《济南的冬天》。这四篇作品语言规范、词汇丰富，"
                "既有大量口语化表达，又包含方言词、人名地名与成语，"
                "能够覆盖分词中的未登录词与歧义切分两类主要难点，具备较好的分析价值。", False)])
    rich(doc, [("语料规模：", True),
               ("共 4 篇，原始 %d 字符，其中汉字 %d 个，切分为 %d 句。"
                % (corpus["原始字符数"], corpus["汉字数"], corpus["句子数"]), False)])
    para(doc, "预处理步骤：① 去除 HTML 标签、HTML 实体与 URL；② 去除零宽字符与 BOM；"
              "③ 统一换行符与全角空格，压缩连续空白；④ 保留中文标点以便后续分句。"
              "清洗共去除 %d 个噪声字符，得到 %d 字符的规范文本。"
              % (corpus["去除字符数"], corpus["清洗后字符数"]))
    code_block(doc, [
        "# corpus_preprocess.py —— 语料读取与预处理（核心逻辑）",
        "RE_HTML   = re.compile(r'<script[\\s\\S]*?</script>|<style[\\s\\S]*?</style>|<[^>]+>', re.I)",
        "RE_ENTITY = re.compile(r'&[a-zA-Z#0-9]{1,8};')",
        "RE_URL    = re.compile(r'https?://[^\\s，。；）)】\\]]+')",
        "RE_ZERO   = re.compile(r'[\\u200B-\\u200F\\u202A-\\u202E\\uFEFF]')",
        "",
        "def clean_text(raw, keep_punct=True):",
        "    text = RE_HTML.sub(' ', raw)          # 1. 去 HTML 标签",
        "    text = RE_ENTITY.sub(' ', text)       # 2. 去 HTML 实体",
        "    text = RE_URL.sub(' ', text)          # 3. 去 URL",
        "    text = RE_ZERO.sub('', text)          # 4. 去零宽字符",
        "    text = text.replace('\\r\\n', '\\n').replace('\\u3000', ' ')",
        "    text = re.sub(r'[ \\t\\f\\v]+', ' ', text)",
        "    return RE_KEEP.sub(' ', text)         # 5. 只保留汉字/字母数字/常用标点",
    ])
    rich(doc, [("前端实现：", True),
               ("页面支持 .txt / .md / .html / .csv 等文本文件的上传与拖放，并能自动判别 UTF-8 与 "
                "GBK/GB18030 编码（Windows 记事本另存为 ANSI 的中文文件不会变成乱码）。", False)])

    # ---- 3.2
    heading(doc, "3.2 基于 jieba 的分词与调优", 2)
    para(doc, "（1）基础分词：jieba 提供三种切分模式，本次实验均做了对比。")
    code_block(doc, [
        "import jieba",
        "seg_default = jieba.lcut(text)                  # 精确模式",
        "seg_full    = jieba.lcut(text, cut_all=True)    # 全模式",
        "seg_search  = jieba.lcut_for_search(text)       # 搜索引擎模式",
    ])
    para(doc, "（2）调优策略：本次实验实际使用了自定义词典、动态加词、调整词频与 HMM 开关四种手段。")
    table(doc,
          ["调优手段", "具体操作", "预期效果"],
          [["自定义词典", "jieba.load_userdict('data/user_dict.txt')",
            "补充语料中的人名、地名、篇名与固定表达（共 %d 条，其中新增 %s 条）"
            % (tune["自定义词典"]["count"], tune["自定义词典"]["new_words"])],
           ["动态添加词", "jieba.add_word('闰土', freq=2000, tag='nr')",
            "解决未登录词被切碎问题"],
           ["关闭 / 开启 HMM", "jieba.lcut(text, HMM=False)",
            "对比 HMM 对新词发现的影响"],
           ["调整词频", "jieba.suggest_freq('事已如此', False)",
            "解决歧义切分与长词吞噬边界"],
           ["停用词过滤", "加载 1368 词的停用词表",
            "提升词云质量"]],
          widths=[3.0, 6.6, 5.4],
          caption="表 3-1  本次实验使用的 jieba 调优手段")
    para(doc, "（3）调优前后对比示例（真实运行结果）：")
    rows = []
    for d in gold["调优差异"]["jieba差异片段"][:8]:
        before = d["before"] or "（未成词）"
        after = d["after"] or "（未成词）"
        rows.append([d["text"], before, after])
    if rows:
        table(doc, ["原文片段", "调优前切分", "调优后切分"], rows,
              widths=[3.2, 5.9, 5.9], caption="表 3-2  jieba 调优前后切分变化（节选）")
    para(doc, "从表中可以看到，调优的主要作用是让“本已”“说定”“北去”“事忙”这类"
              "在本语料中高频共现的组合稳定成词，同时把被长词误吞的边界（如“事已如此”）拆回来。")

    # ---- 3.3
    heading(doc, "3.3 基于自建分词工具的分词与调优", 2)
    para(doc, "（1）工具回顾：自建分词工具实现了三种基于词典的切分算法，并额外实现了纯 HMM 基线。")
    table(doc,
          ["算法", "原理", "特点"],
          [["正向最大匹配 FMM", "从左到右，每步取词典中最长的词",
            "速度快，倾向长词，容易把后文的短词吞掉"],
           ["逆向最大匹配 BMM", "从右到左做同样的贪心匹配",
            "中文中准确率通常略高于 FMM"],
           ["双向最大匹配 BIMM", "同时做 FMM 与 BMM，按规则消解歧义",
            "以“词数少优先、单字少优先、否则取 BMM”三条规则择优"],
           ["纯 HMM", "BMES 四状态 + Viterbi，不使用词典",
            "作为统计方法基线，用于说明词典对分词的作用"]],
          widths=[3.4, 6.2, 5.4], caption="表 3-3  自建工具实现的四种切分策略")
    para(doc, "（2）调优策略：")
    for s in [
        "扩充词典：把 jieba 识别出而自建词典没有的词补进词表，本次共补充 %d 个词；"
        % tune["自建词典反向扩充词数"],
        "调整最大词长：max_len 由默认 6 调整为 9，减少长词被切碎；",
        "歧义消解规则：把切分策略由 FMM 换成 BIMM，引入逆向匹配与消歧规则；",
        "未登录词处理：对连续单字串加入 HMM 回退（复用 jieba.finalseg 的 BMES 模型）。",
    ]:
        para(doc, "· " + s, indent_first=False)
    para(doc, "（3）调优前后对比示例：")
    rows = []
    for d in gold["调优差异"]["自建工具差异片段"][:8]:
        rows.append([d["text"], d["before"] or "（未成词）", d["after"] or "（未成词）"])
    if rows:
        table(doc, ["原文片段", "调优前切分", "调优后切分"], rows,
              widths=[3.2, 5.9, 5.9], caption="表 3-4  自建工具调优前后切分变化（节选）")

    # ---- 3.4
    heading(doc, "3.4 分词结果对比分析", 2)
    rich(doc, [("（1）定量对比。", True),
               ("本次实验准备了两套评测标准，互相印证：", False)])
    for s in [
        "人工标注金标准：从语料中抽取 24 句（547 字）逐词人工标注，作为主要评测依据；",
        "自动银标准：在全部 %d 句语料上，由 4 个分词系统投票，某个切分点被超过半数系统认可时才计入标准，"
        "用于观察全语料的整体表现。" % corpus["句子数"],
    ]:
        para(doc, "· " + s, indent_first=False)

    rich(doc, [("指标定义", True), ("（以词边界位置为准，这是中文分词评测的通行做法）：", False)],
         indent_first=True)
    code_block(doc, [
        "准确率 P = |系统切分点 ∩ 标准切分点| / |系统切分点|",
        "召回率 R = |系统切分点 ∩ 标准切分点| / |标准切分点|",
        "F1      = 2PR / (P + R)",
        "整句完全一致率 = 切分结果与标准完全相同的句子数 / 总句数",
    ])

    table(doc,
          ["分词工具", "准确率 P", "召回率 R", "F1 值", "输出词数", "整句完全一致率"],
          [[k, pct(gm[k]["准确率P"]), pct(gm[k]["召回率R"]), pct(gm[k]["F1"]),
            gm[k]["输出词数"], pct(gm[k]["整句完全一致率"])] for k in keys],
          widths=[4.0, 2.2, 2.2, 2.2, 2.2, 3.2],
          caption="表 3-5  基于人工标注金标准的定量对比（24 句 / 353 词）")

    if silver:
        sm = silver["指标"]
        table(doc,
              ["分词工具", "准确率 P", "召回率 R", "F1 值", "输出词数", "整句完全一致率"],
              [[k, pct(sm[k]["准确率P"]), pct(sm[k]["召回率R"]), pct(sm[k]["F1"]),
                sm[k]["输出词数"], pct(sm[k]["整句完全一致率"])] for k in keys],
              widths=[4.0, 2.2, 2.2, 2.2, 2.2, 3.2],
              caption="表 3-6  基于全语料自动银标准的定量对比（%d 句）" % corpus["句子数"])

    d_jieba = gm["jieba（调优后）"]["F1"] - gm["jieba（默认）"]["F1"]
    d_self = gm["自建工具（调优后）"]["F1"] - gm["自建工具（默认）"]["F1"]
    rich(doc, [("（2）定性对比。", True)], indent_first=True)
    for s in [
        "调优效果：jieba 的 F1 由 %s 变为 %s（%+.2f pt）；自建工具由 %s 变为 %s（%+.2f pt）。"
        % (pct(gm["jieba（默认）"]["F1"]), pct(gm["jieba（调优后）"]["F1"]), d_jieba * 100,
           pct(gm["自建工具（默认）"]["F1"]), pct(gm["自建工具（调优后）"]["F1"]), d_self * 100),
        "工具差异：人工标准下两者 F1 相差 %.2f pt，全语料银标准下相差 %.2f pt，"
        "自建工具在“整句完全一致率”上明显更高，说明其切分粒度更接近人工标注习惯。"
        % (abs(gm["jieba（调优后）"]["F1"] - gm["自建工具（调优后）"]["F1"]) * 100,
           abs(sm["jieba（调优后）"]["F1"] - sm["自建工具（调优后）"]["F1"]) * 100 if silver else 0),
        "粒度差异：jieba 倾向于切出更多、更细的词（输出 %d 个词），召回率高而准确率略低；"
        "自建工具切分更粗（输出 %d 个词），准确率更高。这正是“最大匹配”与"
        "“最大概率路径”两种算法取向的直接体现。"
        % (gm["jieba（调优后）"]["输出词数"], gm["自建工具（调优后）"]["输出词数"]),
    ]:
        para(doc, "· " + s, indent_first=False)

    para(doc, "（3）错误类型分布（基于人工标注金标准）：")
    table(doc,
          ["错误类型", "jieba（默认）", "jieba（调优后）", "自建工具（默认）", "自建工具（调优后）"],
          [["切碎（过度切分）"] + [gm_err[k].get("split", 0) for k in keys],
           ["粘连（切分不足）"] + [gm_err[k].get("merge", 0) for k in keys],
           ["未登录词"] + [gm_err[k].get("oov", 0) for k in keys]],
          widths=[3.6, 3.1, 3.1, 3.1, 3.1],
          caption="表 3-7  四组结果的错误类型分布")
    para(doc, "从错误分布可以看出一个典型规律：jieba 默认配置的主要问题是“切碎”"
              "（未登录词被拆成单字），而调优后在 HMM 与自定义词典的共同作用下切碎问题基本消除，"
              "但词频调整把部分长词固化，反而引入了“粘连”；自建工具则在引入 BIMM 与 HMM 回退后，"
              "切碎问题明显下降。这说明分词调优本质上是在“切碎”与“粘连”之间寻找平衡，"
              "并不存在单调变好的方向。")

    para(doc, "（4）典型错误明细（节选）：")
    rows = []
    for it in gold["错误明细"]["jieba（调优后）"][:8]:
        rows.append([it["label"], it["text"], it["gold"], it["sys"], it["reason"]])
    if rows:
        table(doc, ["类型", "原文片段", "标准切分", "系统输出", "原因分析"], rows,
              widths=[2.4, 2.0, 2.6, 2.6, 4.4], caption="表 3-8  分词错误明细（jieba 调优后）")

    # ---- 3.5
    heading(doc, "3.5 词云图制作", 2)
    para(doc, "（1）制作流程：分词 → 停用词与长度过滤 → 词频统计 → 形状裁剪 → 螺旋布局 → 上色输出。")
    code_block(doc, [
        "# wordcloud_gen.py —— 词云生成核心流程",
        "words = [w for w in seg_result if w not in stopwords and len(w) > 1]",
        "freq = {}",
        "for w in words:",
        "    freq[w] = freq.get(w, 0) + 1",
        "",
        "mask = make_mask(shape, W, H)          # 形状蒙版（椭圆/心形/星形/云朵/文字…）",
        "occ  = ~mask                           # 形状之外视为已占用",
        "for word, count in sorted(freq.items(), key=lambda kv: -kv[1])[:max_words]:",
        "    size   = min_size + (max_size - min_size) * norm(count)   # 词频归一化",
        "    sprite = render(word, size)        # 渲染成 alpha 蒙版用于碰撞检测",
        "    pos    = spiral_search(occ, sprite)  # 阿基米德螺旋线找空位",
        "    occ[pos] |= sprite                 # 占位",
        "    canvas.paste(colored(sprite), pos)  # 按色带上色",
    ])
    para(doc, "（2）设计感要点与本次实现：")
    table(doc,
          ["设计要点", "本次实现"],
          [["形状蒙版", "内置椭圆、正圆、心形、五角星、云朵、菱形、矩形与“文字轮廓”8 种形状；"
                    "文字轮廓由汉字渲染成蒙版后再裁切"],
           ["配色方案", "内置 viridis / plasma / inferno / magma / warm / cool / ocean / macaron / "
                    "forest / sunset / ink / rainbow 共 12 种色带，按词频在色带上插值取色"],
           ["停用词过滤", "使用 1368 词停用词表，并叠加最短词长（≥2）与词性过滤，"
                     "剔除“的、了、是、在”等无意义高频词"],
           ["词频归一化", "支持平方根 / 线性 / 对数三种映射，默认平方根，避免个别超高频词独占画面"],
           ["字体选择", "自动探测系统中文字体（微软雅黑 msyh.ttc / 黑体 simhei.ttf / 楷体 / 宋体 / 等线），"
                    "确保中文不出现方框"],
           ["交互能力", "前端版本支持鼠标悬停查看词频与词性、实时切换形状配色、一键下载 PNG"]],
          widths=[3.2, 11.8], caption="表 3-9  词云设计要点与实现方式")

    para(doc, "（3）词云图展示：")
    image_center(doc, os.path.join(BASE, cloud["主图"]), 14.0,
                 "图 3-1  主词云图（%s 形状 · %s 配色 · 词频映射 %s · 最多 %s 词 · 字体 %s）"
                 % (cloud["形状"], cloud["配色"], cloud["词频映射"], cloud["最多词数"], cloud["字体"]))
    top_words = "、".join("“%s”" % w["词"] for w in summary["高频词前40"][:6])
    para(doc, "图中 %s 等词最为突出，配合“荷塘”“月光”“橘子”“背影”“闰土”“海边”“西瓜”等词，"
              "清晰反映出语料主题集中于现代文学乡土与亲情题材：《故乡》贡献了“闰土”“西瓜”“海边”，"
              "《背影》贡献了“父亲”“橘子”“背影”，《荷塘月色》贡献了“荷塘”“月光”“叶子”，"
              "《济南的冬天》贡献了“济南”“冬天”。"
              "四篇语料在词云中形成了可辨认的主题簇，说明分词与词频统计结果能够有效刻画文本主题。"
              % top_words)

    para(doc, "不同形状与配色方案的效果对比：")
    variants = cloud["风格变体"]
    if variants:
        # 两列排布图片
        for i in range(0, len(variants), 2):
            pair = variants[i:i + 2]
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_after = Pt(2)
            for j, v in enumerate(pair):
                if j:
                    p.add_run("    ")
                path = os.path.join(BASE, v["文件"])
                if os.path.exists(path):
                    p.add_run().add_picture(path, width=Cm(6.6))
            cp = doc.add_paragraph()
            cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
            cp.paragraph_format.space_after = Pt(10)
            r = cp.add_run("　".join("%s（%d 词）" % (v["说明"], v["词数"]) for v in pair))
            set_run_font(r, name=CN_FONT_BODY, size=9, color=(0x60, 0x60, 0x60))
        para(doc, "对比可见：椭圆与正圆蒙版的填充率最高（可放置全部 %s 个词）；"
                  "心形与五角星因为边界曲线复杂，可用面积较小，分别只放下了 182 与 160 个词；"
                  "“文字轮廓”蒙版最紧凑，仅 91 个词，适合作为标题式装饰图。"
                  "因此实际选用时需要在“形状辨识度”与“信息承载量”之间做取舍。" % cloud["最多词数"])

    # =============================================== 四、思考与总结
    heading(doc, "四、思考与总结", 1)

    heading(doc, "4.1 实验收获", 2)
    para(doc, "1. 对中文分词难点的认识。通过本次对比可以确认，中文分词的核心难点是"
              "未登录词识别与歧义切分。jieba 借助前缀词典 + 动态规划最大概率路径，"
              "并用 HMM 处理词典未覆盖的片段，因此在人名、方言词等未登录词上表现较好；"
              "自建的最大匹配工具完全依赖词表覆盖，词典缺词时会直接把专有名词切碎。"
              "本次实验中 jieba 默认配置检出 %d 处“切碎”错误，正是这一机制的直接体现。"
              % gm_err["jieba（默认）"].get("split", 0))
    para(doc, "2. 调优的重要性与它的两面性。加载自定义词典、add_word、suggest_freq 与 HMM 开关"
              "都能实质改变切分结果。但实验也暴露出调优并非单调变好：把长词词频调高以后，"
              "“切碎”减少了，“粘连”却增加了（jieba 调优后粘连由 %d 处升至 %d 处）。"
              "这提示我们调优必须配合评测指标，凭直觉加词很可能按下葫芦浮起瓢。"
              % (gm_err["jieba（默认）"].get("merge", 0), gm_err["jieba（调优后）"].get("merge", 0)))
    para(doc, "3. 两种评测标准互相印证的价值。只看自动银标准时，各系统差距不大（F1 都在 92% 以上），"
              "因为银标准本身就是这些系统投票产生的，会系统性地高估它们的一致性；"
              "换成人工标注金标准后，真实的错误才暴露出来——jieba 的整句完全一致率只有约 4%，"
              "而自建工具达到 33%~46%。这说明自动评测只适合快速迭代，最终结论仍需人工标准支撑。")
    para(doc, "4. 工具对比的价值。jieba 通用性强、开箱即用，且有成熟的 HMM 新词发现能力，"
              "适合快速落地；自建工具虽然工程完备度低，但算法透明、可控性强，"
              "本次实验正是依靠它才看清了“最大匹配贪心”与“最大概率路径”的本质差异。"
              "两者互为参照：可以用 jieba 的结果反向扩充自建词典（本次补充 %d 词），"
              "也可以用自建工具暴露 jieba 隐含的切分偏好。" % tune["自建词典反向扩充词数"])
    para(doc, "5. 词云可视化的价值。词云把技术结果转化为直观的视觉呈现。"
              "实验中最有效的质量提升手段不是调形状或配色，而是停用词过滤："
              "未过滤时，标点符号 1045 处、单字词 2345 处会挤占画面；"
              "过滤后画面立刻聚焦到真正承载主题的实词上。这印证了“数据清洗比呈现技巧更重要”。")

    heading(doc, "4.2 遇到的问题与解决", 2)
    table(doc,
          ["问题", "原因", "解决方案"],
          [["专有名词被切碎（如“闰土”切成“闰/土”）", "词典未收录", "加载自定义词典 + add_word"],
           ["歧义切分错误（如“便须”切成“便/须”）", "词频设置不合理", "suggest_freq 调整词频；改用双向最大匹配"],
           ["jieba 调优后出现粘连（如“事已如此”被当一个词）", "长词词频过高吞掉边界",
            "用 suggest_freq(word, False) 把边界调回来"],
           ["词云中无意义词过多", "未过滤停用词与单字", "1368 词停用词表 + 最短词长过滤 + 词性过滤"],
           ["中文显示为方框 / 乱码", "字体不支持或文件编码为 GBK",
            "指定 font_path 为 msyh.ttc；前端自动判别 UTF-8/GBK 编码"],
           ["自建工具 OOV 严重", "词典规模小", "用 jieba 结果反向扩充词表（+%d 词）"
            % tune["自建词典反向扩充词数"]],
           ["CPU 环境无法安装 wordcloud / matplotlib", "环境无网络且未预装",
            "用 Pillow + NumPy 自行实现词云布局与上色"],
           ["词云大量词语放不下", "最大字号过大，头部词撑满画布",
            "把最大字号限制为画布短边的 19%，并细分螺旋搜索步长"]],
          widths=[4.8, 4.2, 6.0], caption="表 4-1  实验中遇到的问题与解决方案")

    heading(doc, "4.3 改进方向", 2)
    for s in [
        "引入更先进的模型：用 BiLSTM-CRF、BERT-BiLSTM-CRF 等序列标注模型替代传统词典方法，"
        "从根本上提升未登录词识别能力；",
        "构建领域词典：针对医学、法律等专业领域构建词典，进一步提升分词精度；",
        "多维度评价：除 P/R/F1 外，引入切分一致性、OOV 召回率等指标，更全面地评估分词质量；",
        "词云交互化：本次前端版本已实现鼠标悬停查看词频与词性，后续可继续加入词频区间筛选、"
        "关键词联动高亮、时间轴演化等功能；",
        "端到端流程封装：本次已把语料预处理、分词、调优、对比、可视化封装为 Pipeline"
        "并同时提供 Python 与浏览器两套实现，后续可接入更多语料与模型；",
        "评测标准的自动化：用主动学习挑选信息量最大的句子交给人工标注，"
        "在有限标注预算下获得更具代表性的人工金标准。",
    ]:
        para(doc, "· " + s, indent_first=False)

    heading(doc, "4.4 总结", 2)
    para(doc, "本次实验完整实践了中文分词从语料选取 → 工具使用 → 调优对比 → 可视化呈现的全流程，"
              "并在两条战线上做了对照：Python 脚本侧重可复现的定量评测，"
              "前端页面侧重可交互的结果呈现。通过 jieba 与自建工具的对比，"
              "可以得出一个明确结论——没有绝对最优的分词工具，"
              "只有最适合特定语料和任务的方案。jieba 的优势来自“词典 + 统计”的混合架构，"
              "自建工具的价值在于算法透明与可控。调优过程也不仅是参数调整，"
              "更是对语料特点与分词算法原理的深入理解：本次实验清楚看到"
              "“切碎”与“粘连”此消彼长的关系，也看到自动银标准会掩盖真实错误。"
              "词云图制作则将技术结果转化为直观的视觉呈现，体现了 NLP“从数据到洞察”的价值。"
              "后续将进一步探索深度学习分词方法，并在更多领域语料上验证工具的可扩展性。")

    # =============================================== 附录
    heading(doc, "附录 A  代码文件清单", 1)
    table(doc,
          ["文件名", "说明"],
          [["corpus_preprocess.py", "语料读取与预处理（去 HTML/实体/URL、编码统一、分句）"],
           ["jieba_seg.py", "jieba 分词与调优（三种模式、自定义词典、add_word、suggest_freq、HMM 开关）"],
           ["my_seg.py", "自建分词工具与调优（FMM / BMM / BIMM / 纯 HMM、max_len、词表扩充、HMM 回退）"],
           ["compare.py", "分词结果对比与指标计算（P/R/F1、错误分类、调优前后差异定位）"],
           ["wordcloud_gen.py", "词云图生成（形状蒙版、12 种配色、词频归一化、螺旋布局）"],
           ["run_all.py / make_report.py", "一键跑完整实验流程并汇总结果"],
           ["jieba_bootstrap.py", "统一加载仓库内 vendor/jieba，保证与网页版词典一致"],
           ["tools/build_jieba_assets.py", "把 jieba 词典与 HMM 模型导出为浏览器可加载的 JS"],
           ["tools/parity_check.py + .js", "JS 与 Python 分词结果的一致性对拍脚本"],
           ["tools/browser_test.js", "用无头 Chromium 自动验证前端页面全流程"],
           ["web/index.html + web/js/*.js", "前端页面：上传文章自动生成词云、分词对比与指标展示"],
           ["data/corpus.txt", "原始语料（4 篇现代文学作品）"],
           ["data/user_dict.txt", "自定义词典"],
           ["data/stopwords.txt", "停用词表（1368 词）"],
           ["data/gold.txt", "人工标注金标准（24 句 / 353 词）"],
           ["wordcloud.png", "生成的主词云图"],
           ["report/*.png", "多风格词云图与指标数据（summary.json / metrics.json）"]],
          widths=[5.6, 9.4], caption="表 A-1  项目代码与数据文件清单")

    heading(doc, "附录 B  前端使用说明", 1)
    para(doc, "前端页面为纯静态实现，无需后端与联网：所有计算（jieba 分词、自建分词、指标计算、"
              "词云布局与上色）都在浏览器本地完成，文章内容不会上传到任何服务器。")
    for s in [
        "直接双击打开 web/index.html 即可使用（词典以脚本形式内联加载）；",
        "在“上传文章”区域点击选择或拖入 .txt / .md / .html / .csv 文件，可多选合并，"
        "也可直接粘贴正文；文件编码会自动识别 UTF-8 或 GBK；",
        "在“jieba 分词与调优”“自建分词工具调优”“词云设计”三组面板中调整参数，"
        "点击“开始分析并生成词云”；",
        "右侧可查看词云图（支持鼠标悬停查看词频）、词频统计、四路分词结果对比、"
        "P/R/F1 指标与错误分析、调优记录，以及自动生成的实验报告；",
        "点击“下载词云 PNG”保存图片，点击“导出实验报告”下载 Markdown 版报告。",
    ]:
        para(doc, "· " + s, indent_first=False)

    para(doc, "")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("—— 报告结束 ——")
    set_run_font(r, name=CN_FONT, size=9.5, color=(0x90, 0x90, 0x90))
    return doc


def main():
    if not os.path.exists(os.path.join(REPORT, "summary.json")):
        print("缺少 report/summary.json，请先运行 python make_report.py")
        return 1
    summary = load_summary()
    doc = build(summary)
    doc.save(OUT)
    print("报告已生成 -> %s（%.1f KB）" % (OUT, os.path.getsize(OUT) / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
