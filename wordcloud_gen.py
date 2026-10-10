# -*- coding: utf-8 -*-
"""
wordcloud_gen.py —— 词云图生成（纯 PIL + NumPy 实现）
=====================================================
对应实验报告 3.5 节。

说明：本机环境没有安装 wordcloud / matplotlib，因此这里用 Pillow + NumPy
自行实现词云布局，功能与实验要求一致（形状蒙版、配色方案、停用词过滤、
词频归一化、中文字体指定），并且与前端 web/js/wordcloud.js 使用同一套设计思路：

  1. 形状蒙版：椭圆 / 正圆 / 心形 / 五角星 / 云朵 / 菱形 / 矩形 / 文字轮廓
  2. 配色方案：viridis / plasma / inferno / magma / warm / cool / ocean /
               macaron / forest / sunset / ink / rainbow
  3. 词频归一化：linear / sqrt / log 三种映射，避免超高频词独占画面
  4. 布局算法：阿基米德螺旋线逐个摆放 + 占用位图做重叠检测

用法：
    python wordcloud_gen.py                        # 用默认参数生成 wordcloud.png
    python wordcloud_gen.py --shape heart --palette plasma --max-words 200
"""
from __future__ import annotations

import argparse
import math
import os
import random
import sys
from typing import Dict, List, Sequence, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from jieba_bootstrap import BASE_DIR, load_stopwords, resource_path
from corpus_preprocess import load_corpus

# ------------------------------------------------------------------ 配色方案
PALETTES: Dict[str, List[str]] = {
    "viridis": ["#440154", "#482878", "#3E4A89", "#31688E", "#26828E",
                "#1F9E89", "#35B779", "#6DCD59", "#B4DE2C", "#FDE725"],
    "plasma": ["#0D0887", "#46039F", "#7201A8", "#9C179E", "#BD3786",
               "#D8576B", "#ED7953", "#FB9F3A", "#FDCA26", "#F0F921"],
    "inferno": ["#000004", "#1B0C41", "#4A0C6B", "#781C6D", "#A52C60",
                "#CF4446", "#ED6925", "#FB9B06", "#F7D13D", "#FCFFA4"],
    "magma": ["#000004", "#180F3D", "#440F76", "#721F81", "#9E2F7F",
              "#CD4071", "#F1605D", "#FD9668", "#FEC98D", "#FCFDBF"],
    "warm": ["#7F1D1D", "#B91C1C", "#DC2626", "#EA580C", "#F59E0B",
             "#FBBF24", "#FCD34D", "#FDE68A"],
    "cool": ["#0C4A6E", "#075985", "#0369A1", "#0284C7", "#0EA5E9",
             "#38BDF8", "#7DD3FC", "#BAE6FD"],
    "ocean": ["#04293A", "#064663", "#0B6E4F", "#14868B", "#1FA5A0",
              "#4FC3A1", "#8ED9B0", "#CFF5C8"],
    "macaron": ["#F94144", "#F3722C", "#F8961E", "#F9C74F", "#90BE6D",
                "#43AA8B", "#4D908E", "#577590"],
    "forest": ["#1B4332", "#2D6A4F", "#40916C", "#52B788", "#74C69D",
               "#95D5B2", "#B7E4C7", "#D8F3DC"],
    "sunset": ["#6A0572", "#AB83A1", "#E36588", "#F58A63", "#FFC15E", "#FFE29A"],
    "ink": ["#111827", "#1F2937", "#374151", "#4B5563", "#6B7280", "#9CA3AF"],
    "rainbow": ["#E63946", "#F77F00", "#FCBF49", "#A8DADC", "#457B9D",
                "#1D3557", "#8338EC", "#3A86FF"],
}

# 常见中文字体路径（按优先级尝试）
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",       # 微软雅黑
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\simhei.ttf",     # 黑体
    r"C:\Windows\Fonts\simkai.ttf",     # 楷体
    r"C:\Windows\Fonts\simsun.ttc",     # 宋体
    r"C:\Windows\Fonts\Deng.ttf",       # 等线
]

SHAPES = ("rect", "ellipse", "circle", "heart", "star", "diamond", "cloud", "text")


# ------------------------------------------------------------------ 工具函数
def hex_to_rgb(h: str) -> Tuple[int, int, int]:
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def sample_palette(palette: Sequence[str], t: float) -> Tuple[int, int, int]:
    """在色带上按 t∈[0,1] 线性插值取色。"""
    t = min(max(t, 0.0), 1.0)
    n = len(palette)
    x = t * (n - 1)
    i = int(math.floor(x))
    f = x - i
    a, b = hex_to_rgb(palette[i]), hex_to_rgb(palette[min(i + 1, n - 1)])
    return tuple(int(round(a[k] + (b[k] - a[k]) * f)) for k in range(3))


def resolve_font(prefer: str | None = None) -> str:
    """找到可用的中文字体文件。"""
    if prefer and os.path.exists(prefer):
        return prefer
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return p
    raise FileNotFoundError("未找到可用的中文字体，请用 --font 指定 .ttf/.ttc 路径")


# ------------------------------------------------------------------ 形状蒙版
def make_mask(shape: str, w: int, h: int, text: str = "词", font_path: str | None = None) -> np.ndarray:
    """生成布尔蒙版：True 表示该像素属于词云可填充区域。"""
    if shape == "text":
        img = Image.new("L", (w, h), 0)
        draw = ImageDraw.Draw(img)
        size = int(min(w / max(len(text), 1), h) * 0.95)
        font = ImageFont.truetype(resolve_font(font_path), size)
        bbox = draw.textbbox((0, 0), text, font=font)
        draw.text(((w - (bbox[2] - bbox[0])) / 2 - bbox[0],
                   (h - (bbox[3] - bbox[1])) / 2 - bbox[1]), text, fill=255, font=font)
        return np.array(img) > 100

    yy, xx = np.mgrid[0:h, 0:w]
    u = xx / w
    v = yy / h
    if shape == "rect":
        return np.ones((h, w), dtype=bool)
    if shape == "ellipse":
        dx, dy = (u - 0.5) / 0.5, (v - 0.5) / 0.5
        return dx ** 2 + dy ** 2 <= 0.94
    if shape == "circle":
        r = min(w, h) / 2 * 0.96
        return (xx - w / 2) ** 2 + (yy - h / 2) ** 2 <= r ** 2
    if shape == "heart":
        # 心形隐函数 (x²+y²-1)³ - x²y³ <= 0
        nx = (u - 0.5) / 0.5 * 1.45
        ny = -(v - 0.5) / 0.5 * 1.45 + 0.35
        a = nx ** 2 + ny ** 2 - 1
        return a ** 3 - nx ** 2 * ny ** 3 <= 0
    if shape == "star":
        dx, dy = (xx - w / 2) / (w / 2), (yy - h / 2) / (h / 2)
        ang = np.arctan2(dy, dx)
        rad = np.sqrt(dx ** 2 + dy ** 2)
        spikes, outer, inner = 5, 0.98, 0.45
        seg = math.pi / spikes
        a2 = np.mod(ang, 2 * seg)
        f = np.abs(a2 - seg) / seg
        limit = inner + (outer - inner) * (1 - f)
        return rad <= limit
    if shape == "diamond":
        return np.abs(u - 0.5) / 0.48 + np.abs(v - 0.5) / 0.48 <= 1
    if shape == "cloud":
        mask = np.zeros((h, w), dtype=bool)
        blobs = [(0.30, 0.60, 0.22), (0.47, 0.44, 0.27), (0.66, 0.55, 0.22),
                 (0.55, 0.68, 0.22), (0.78, 0.67, 0.14)]
        for cx, cy, rr in blobs:
            dx = (u - cx) / rr
            dy = (v - cy) / (rr * (w / h))
            mask |= (dx ** 2 + dy ** 2 <= 1)
        return mask
    raise ValueError("未知形状: %s（可选：%s）" % (shape, "/".join(SHAPES)))


# ------------------------------------------------------------------ 主生成器
class WordCloudGenerator:
    """
    参数与前端 web/js/wordcloud.js 的 render(options) 保持一致，
    便于"网页生成"和"脚本生成"两种方式产出风格统一的词云图。
    """

    def __init__(self, width: int = 1400, height: int = 1000, shape: str = "ellipse",
                 palette: str = "viridis", mapping: str = "sqrt", max_words: int = 200,
                 min_size: int = 14, max_size: int = 170, font: str | None = None,
                 background: str = "#ffffff", rotate_ratio: float = 0.0,
                 shape_text: str = "词", seed: int = 42):
        self.width = width
        self.height = height
        self.shape = shape
        self.palette_name = palette
        self.palette = PALETTES.get(palette, PALETTES["viridis"])
        self.mapping = mapping
        self.max_words = max_words
        self.min_size = min_size
        self.max_size = max_size
        self.font_path = resolve_font(font)
        self.background = background
        self.rotate_ratio = rotate_ratio
        self.shape_text = shape_text
        self.random = random.Random(seed)
        # 统计信息，供报告引用
        self.stats: Dict[str, object] = {}

    # ------------------------------------------------------------ 字号映射
    def _norm(self, c: int, cmin: int, cmax: int) -> float:
        if cmax == cmin:
            return 1.0
        if self.mapping == "log":
            return (math.log(c + 1) - math.log(cmin + 1)) / (math.log(cmax + 1) - math.log(cmin + 1))
        if self.mapping == "linear":
            return (c - cmin) / (cmax - cmin)
        return (math.sqrt(c) - math.sqrt(cmin)) / (math.sqrt(cmax) - math.sqrt(cmin))

    # ------------------------------------------------------------ 精灵生成
    # 精灵（碰撞占位）与最终上色使用同一个 _render_glyph 渲染，
    # 因此"看起来的位置"和"占位的位置"严格一致，不会出现压字。
    PAD = 3          # 包围盒四周留白（像素）
    ALPHA_MIN = 8    # 抗锯齿边缘也算占位，避免相邻词互相啃到笔画

    def _render_glyph(self, word: str, size: int, rotate: bool):
        """渲染词 -> (灰度蒙版图, 包围盒)。sprite 与上色都基于它。"""
        font = ImageFont.truetype(self.font_path, size)
        probe = ImageDraw.Draw(Image.new("L", (8, 8), 0))
        bbox = probe.textbbox((0, 0), word, font=font)
        tw = bbox[2] - bbox[0] + self.PAD * 2
        th = bbox[3] - bbox[1] + self.PAD * 2
        if tw <= self.PAD * 2 or th <= self.PAD * 2:
            return None, None
        img = Image.new("L", (tw, th), 0)
        ImageDraw.Draw(img).text(
            (self.PAD - bbox[0], self.PAD - bbox[1]), word, fill=255, font=font)
        if rotate:
            img = img.rotate(90, expand=True)
        return img, bbox

    def _sprite(self, word: str, size: int, rotate: bool):
        """碰撞用的布尔蒙版 + 尺寸。"""
        img, _ = self._render_glyph(word, size, rotate)
        if img is None:
            return None
        arr = np.array(img) > self.ALPHA_MIN
        return arr, arr.shape[1], arr.shape[0]

    # ------------------------------------------------------------ 生成
    def generate(self, frequencies: Dict[str, int], out_path: str) -> str:
        words = [(w, c) for w, c in frequencies.items() if c > 0]
        words.sort(key=lambda kv: (-kv[1], kv[0]))
        words = words[: self.max_words]
        if not words:
            raise ValueError("词频为空，无法生成词云")

        W, H = self.width, self.height
        mask = make_mask(self.shape, W, H, self.shape_text, self.font_path)
        # 占用图：形状之外一律视为已占用
        occ = ~mask

        bg = hex_to_rgb(self.background)
        canvas = Image.new("RGB", (W, H), bg)

        counts = [c for _, c in words]
        cmin, cmax = min(counts), max(counts)
        cx, cy = W / 2, H / 2
        ratio = W / H
        max_r = math.hypot(W, H) / 2 + max(W, H) * 0.1
        step = max(1.5, min(W, H) / 260)

        placed = 0
        dropped: List[str] = []
        # 最大字号上限：不超过画布短边的 19%，否则头部词会撑满形状、
        # 后面大量小词找不到位置而被丢弃。
        eff_max_size = min(self.max_size, max(28, int(min(W, H) * 0.19)))
        if eff_max_size < self.min_size:
            eff_max_size = self.min_size
        for word, count in words:
            t = self._norm(count, cmin, cmax)
            size = int(self.min_size + (eff_max_size - self.min_size) * t)
            rotate = self.rotate_ratio > 0 and len(word) <= 6 and self.random.random() < self.rotate_ratio

            sprite = None
            pos = None
            try_size = size
            attempts = 0
            while try_size >= self.min_size and attempts < 7:
                attempts += 1
                sp = self._sprite(word, try_size, rotate)
                if sp is None:
                    if rotate:
                        rotate = False
                        continue
                    break
                arr, sw, sh = sp
                if sw > W * 0.98 or sh > H * 0.98:
                    if rotate:
                        rotate = False
                        continue
                    try_size = int(try_size * 0.83)
                    continue
                pos = self._search(occ, arr, sw, sh, cx, cy, ratio, max_r, step)
                if pos is not None:
                    sprite = sp
                    break
                if rotate:
                    rotate = False
                    continue
                try_size = int(try_size * 0.86)

            if sprite is None or pos is None:
                dropped.append(word)
                continue

            arr, sw, sh = sprite
            gx, gy = pos
            occ[gy:gy + sh, gx:gx + sw] |= arr

            # 上色绘制：复用同一份渲染结果，保证与占位完全一致
            patch, _ = self._render_glyph(word, try_size, rotate)
            color = sample_palette(self.palette, 1 - t)
            canvas.paste(Image.new("RGB", patch.size, color), (gx, gy), patch)
            placed += 1

        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        canvas.save(out_path, "PNG")

        self.stats = {
            "输出文件": out_path,
            "画布": "%dx%d" % (W, H),
            "形状": self.shape,
            "配色": self.palette_name,
            "词频映射": self.mapping,
            "最多词数": self.max_words,
            "字号范围": "%d-%d" % (self.min_size, self.max_size),
            "字体": os.path.basename(self.font_path),
            "已放置": placed,
            "未能放置": len(dropped),
            "覆盖率": "%.1f%%" % (mask.mean() * 100),
        }
        return out_path

    # ------------------------------------------------------------ 螺旋搜索
    @staticmethod
    def _search(occ, arr, sw, sh, cx, cy, ratio, max_r, step):
        """
        沿阿基米德螺旋线由内向外寻找第一个不重叠的位置。
        角度增量取 0.22 rad，保证细长词也能找到缝隙（增量太大容易漏掉空位）。
        """
        H, W = occ.shape
        ang = 0.0
        # 角度增量固定为 0.22 rad；半径按阿基米德螺线 r = b·ang 缓慢增长，
        # 每圈约前进 2π·b 像素。b 取 step，保证相邻圈之间不留空隙也不过于稀疏。
        b = max(0.8, step)
        while True:
            r = b * ang
            if r >= max_r:
                return None
            gx = int(round(cx + ratio * r * math.cos(ang) - sw / 2))
            gy = int(round(cy + r * math.sin(ang) - sh / 2))
            if 0 <= gx and 0 <= gy and gx + sw <= W and gy + sh <= H:
                if not np.any(occ[gy:gy + sh, gx:gx + sw] & arr):
                    return gx, gy
            ang += 0.22


# ------------------------------------------------------------------ 词频统计
def build_frequencies(text: str, stopwords: set, min_len: int = 2, max_len: int = 12,
                      tag_filter: bool = False) -> Dict[str, int]:
    """分词 + 停用词过滤 + 长度过滤 + 词性过滤 -> 词频字典。"""
    from jieba_seg import seg_exact

    freq: Dict[str, int] = {}
    dropped = {"停用词": 0, "太短": 0, "太长": 0, "非中文": 0, "虚词": 0}
    for w in seg_exact(text, hmm=True):
        if not any("\u4e00" <= ch <= "\u9fa5" for ch in w) and not w.isalnum():
            dropped["非中文"] += 1
            continue
        if w in stopwords:
            dropped["停用词"] += 1
            continue
        if len(w) < min_len:
            dropped["太短"] += 1
            continue
        if max_len and len(w) > max_len:
            dropped["太长"] += 1
            continue
        if tag_filter:
            flag = __import__("jieba").posseg.lcut(w)[0].flag if w else ""
            if flag in {"u", "p", "c", "d", "r", "m", "q", "f", "t", "y", "e", "o", "w", "x"}:
                dropped["虚词"] += 1
                continue
        freq[w] = freq.get(w, 0) + 1
    return freq


def main():
    ap = argparse.ArgumentParser(description="生成词云图")
    ap.add_argument("--corpus", default=resource_path("corpus.txt"))
    ap.add_argument("--out", default=os.path.join(BASE_DIR, "wordcloud.png"))
    ap.add_argument("--shape", default="ellipse", choices=SHAPES)
    ap.add_argument("--shape-text", default="词", help="shape=text 时使用的文字")
    ap.add_argument("--palette", default="viridis", choices=list(PALETTES))
    ap.add_argument("--mapping", default="sqrt", choices=["sqrt", "linear", "log"])
    ap.add_argument("--max-words", type=int, default=200)
    ap.add_argument("--min-size", type=int, default=14)
    ap.add_argument("--max-size", type=int, default=170)
    ap.add_argument("--width", type=int, default=1400)
    ap.add_argument("--height", type=int, default=1000)
    ap.add_argument("--rotate", type=float, default=0.0, help="竖排词比例 0~1")
    ap.add_argument("--bg", default="#ffffff")
    ap.add_argument("--font", default=None)
    ap.add_argument("--tag-filter", action="store_true", help="按词性过滤虚词")
    ap.add_argument("--no-stopwords", action="store_true")
    args = ap.parse_args()

    _, text = load_corpus(args.corpus)
    stopwords = set() if args.no_stopwords else load_stopwords()

    print("=" * 74)
    print("词云图生成")
    print("=" * 74)
    print("语料：%d 字符" % len(text))
    print("停用词表：%d 词" % len(stopwords))

    freq = build_frequencies(text, stopwords, min_len=2, max_len=12,
                             tag_filter=args.tag_filter)
    print("保留词条：%d" % len(freq))
    top = sorted(freq.items(), key=lambda kv: -kv[1])[:20]
    print("高频词：", "、".join("%s(%d)" % (w, c) for w, c in top))

    gen = WordCloudGenerator(
        width=args.width, height=args.height, shape=args.shape, palette=args.palette,
        mapping=args.mapping, max_words=args.max_words, min_size=args.min_size,
        max_size=args.max_size, font=args.font, background=args.bg,
        rotate_ratio=args.rotate, shape_text=args.shape_text)
    out = gen.generate(freq, args.out)

    print("\n生成完毕：%s" % out)
    for k, v in gen.stats.items():
        print("  %-10s %s" % (k, v))
    return 0


if __name__ == "__main__":
    sys.exit(main())
