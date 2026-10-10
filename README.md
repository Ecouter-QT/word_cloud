# 项目三 · 主题词云图设计（中文分词对比分析）

把「语料预处理 → 中文分词 → 调优对比 → 词云可视化」整条流程做成了**两套实现**：

| 形式 | 位置 | 用途 |
| --- | --- | --- |
| **前端网页**（纯静态，无需后端/联网） | `web/index.html` | 上传文章即可自动生成词云，并给出分词对比与 P/R/F1 指标 |
| **Python 脚本**（可复现实验） | 根目录各 `*.py` | 跑出报告里的全部定量结果与词云图片 |

> 报告成品：[项目三主题词云图设计_对比分析报告.docx](<项目三主题词云图设计_对比分析报告.docx>)

---

## 一、快速开始

### 1. 前端页面（推荐先看这个）

**直接双击 `web/index.html`** 即可，无需安装任何东西、无需联网。
词典（349,045 词）、HMM 模型、停用词表（1,368 词）与示例语料都已内联为
`web/data/*.js`，因此 `file://` 协议下也能完整工作。

操作步骤：

1. 在「上传文章」区域点击选择或拖入 `.txt / .md / .html / .csv`（可多选合并），
   或直接粘贴正文，也可以点右上角「载入示例语料」；
2. 按需调整「语料预处理 / jieba 分词与调优 / 自建分词工具调优 / 词云设计」四组参数；
3. 点「开始分析并生成词云」；
4. 右侧六个标签页分别查看：词云图、词频统计、分词对比、指标与错误分析、调优记录、实验报告；
5. 「下载词云 PNG」保存图片，「导出实验报告」下载 Markdown 版报告。

> 页面会自动识别 UTF-8 与 GBK/GB18030 编码，Windows 记事本另存为 ANSI 的中文文件不会乱码。

如果想用 http 方式访问（例如放到别的机器上），在 `web/` 目录下起一个静态服务器即可：

```bash
cd web && python -m http.server 8000     # 然后浏览器打开 http://127.0.0.1:8000/
```

### 2. Python 脚本（复现报告里的数字）

```bash
# 一键跑完：预处理 → 分词 → 调优 → 对比 → 词云
python make_report.py

# 只跑某个环节
python corpus_preprocess.py      # 语料读取与预处理
python jieba_seg.py              # jieba 分词与调优
python my_seg.py                 # 自建分词工具
python compare.py --gold data/gold.txt   # 指标计算与错误分析
python wordcloud_gen.py --shape heart --palette plasma   # 生成词云

# 重新生成报告中的 Word 文档
python tools/make_docx_report.py
```

依赖：`python-docx`、`Pillow`、`NumPy`（词云为自研实现，不需要 `wordcloud`/`matplotlib`）；
jieba 0.42.1 已随源码放在 `vendor/jieba`，无需联网安装。

---

## 二、目录结构

```
word_cloud/
├─ web/                        前端页面（纯静态）
│  ├─ index.html               页面入口：上传文章 → 自动生成词云
│  ├─ css/app.css              界面样式
│  ├─ js/
│  │  ├─ dict.js               词典容器（词频/词性/用户词典/调频）
│  │  ├─ jieba.js              ★ jieba 分词算法在浏览器中的复现
│  │  ├─ segmenters.js         四种分词器（jieba / FMM / BMM / BIMM / HMM）
│  │  ├─ metrics.js            P/R/F1 计算、银标准投票、错误分类
│  │  ├─ wordcloud.js          词云布局与绘制（位压缩碰撞图 + 螺旋摆放）
│  │  ├─ pipeline.js           端到端流程封装
│  │  └─ app.js                界面控制器
│  └─ data/                    内联资源
│     ├─ jieba_dict.js         jieba 词典（349,045 词 / 总词频 60,101,967）
│     ├─ jieba_hmm.js          jieba 未登录词 HMM 模型
│     ├─ stopwords.js          停用词表（1,368 词）
│     ├─ sample.js / sample.txt 示例语料
│     └─ gold.txt              人工标注金标准（页面演示用）
│
├─ data/                       数据文件
│  ├─ corpus.txt               原始语料：4 篇现代文学作品，7,331 汉字
│  ├─ stopwords.txt            停用词表（1,368 词）
│  ├─ user_dict.txt            自定义词典
│  └─ gold.txt                 人工标注金标准（24 句 / 353 词）
│
├─ vendor/jieba/               jieba 0.42.1（MIT 许可，随源码分发以便离线运行）
│
├─ corpus_preprocess.py        语料读取与预处理
├─ jieba_seg.py                jieba 分词与调优
├─ my_seg.py                   自建分词工具与调优
├─ compare.py                  分词结果对比与指标计算
├─ wordcloud_gen.py            词云图生成（Pillow + NumPy 实现）
├─ run_all.py                  一键跑完整流程
├─ make_report.py              跑完整流程并汇总报告数据
├─ jieba_bootstrap.py          统一加载 vendor/jieba
│
├─ tools/                      构建与验证工具
│  ├─ build_jieba_assets.py    导出 jieba 词典/HMM 为浏览器可加载的 JS
│  ├─ build_web_data.py        生成前端内联数据资源
│  ├─ parity_check.py / .js    JS 与 Python 分词结果逐句对拍
│  ├─ gen_verify_cases.py      生成对拍用例
│  ├─ verify_js_jieba.js       早期抽样对拍脚本
│  ├─ make_gold.py             生成带原文的标注文件
│  ├─ verify_gold.py           校验标注与原文逐字符一致
│  ├─ make_docx_report.py      生成 Word 版对比分析报告
│  └─ browser_test.js          用无头 Chromium 自动验证前端全流程
│
├─ wordcloud.png               主词云图
└─ report/                     实验产物
   ├─ summary.json             汇总数据
   ├─ metrics.json             详细指标与错误明细
   └─ wordcloud-*.png          六种风格对比词云图
```

---

## 三、核心实现说明

### 1. 浏览器里复现 jieba（`web/js/jieba.js`）

为了让网页**不需要后端**也能用真正的 jieba 算法，把 jieba 0.42.1 的处理流程
完整移植到了 JavaScript：

1. 用正则 `([\u4E00-\u9FD5a-zA-Z0-9+#&._%\-]+)` 切块；
2. 对汉字块建立 **DAG**（基于前缀词典）；
3. 用**动态规划**求最大概率路径（词频取对数相加）；
4. 词典未覆盖的片段交给 **HMM**（BMES 四状态 Viterbi）做未登录词识别；
5. 实现 `lcut` / `lcut(cut_all=True)` / `lcut_for_search` 三种模式，
   以及 `load_userdict` / `add_word` / `suggest_freq` 三个调优接口。

**正确性验证**：`tools/parity_check.py` + `tools/parity_check.js` 把整篇语料按句拆开，
分别用 Python jieba 与浏览器版 JS 切分后逐句比对：

```
模式        整句完全一致            词级位置一致率
exact     111/111     100.0%      5908/5908     100.00%
nohmm     111/111     100.0%      6215/6215     100.00%
full      111/111     100.0%      6311/6311     100.00%
search    111/111     100.0%      6146/6146     100.00%

全部一致 ✔
```

### 2. 自建分词工具（`my_seg.py` / `web/js/segmenters.js`）

实现四种算法：正向最大匹配 FMM、逆向最大匹配 BMM、双向最大匹配 BIMM
（词数少优先 → 单字少优先 → 取 BMM）以及纯 HMM 基线。
调优手段：词表扩充、`max_len` 调整、切分策略切换、未登录词 HMM 回退。

### 3. 词云生成（`wordcloud_gen.py` / `web/js/wordcloud.js`）

两套实现共用同一套设计思路：

- **形状蒙版**：椭圆 / 正圆 / 心形 / 五角星 / 云朵 / 菱形 / 矩形 / 文字轮廓；
- **配色方案**：12 种色带（viridis、plasma、inferno、magma、warm、cool、ocean、
  macaron、forest、sunset、ink、rainbow），按词频在色带上插值取色；
- **词频归一化**：linear / sqrt / log 三种映射，默认 sqrt；
- **布局算法**：阿基米德螺旋线逐个摆放 + 占用图做重叠检测
  （前端用 Uint32 位压缩，Python 用布尔矩阵）；
- **字体**：自动探测系统中文字体（微软雅黑 / 黑体 / 楷体 / 宋体 / 等线）。

---

## 四、实验结果摘要

语料：《背影》《故乡》《济南的冬天》《荷塘月色》，共 8,688 字符 / 7,331 汉字 / 386 句。

### 基于人工标注金标准（24 句 / 353 词）

| 分词工具 | 准确率 P | 召回率 R | F1 值 | 输出词数 | 整句完全一致率 |
| --- | --- | --- | --- | --- | --- |
| jieba（默认） | 91.27% | 97.73% | 94.39% | 378 | 4.17% |
| jieba（调优后） | 92.08% | 95.47% | 93.74% | 366 | 4.17% |
| 自建工具（默认） | 97.40% | 95.47% | **96.42%** | 346 | 45.83% |
| 自建工具（调优后） | 98.22% | 94.05% | 96.09% | 338 | 33.33% |

### 基于全语料自动银标准（386 句）

| 分词工具 | 准确率 P | 召回率 R | F1 值 |
| --- | --- | --- | --- |
| jieba（默认） | 85.96% | 99.98% | 92.44% |
| jieba（调优后） | 90.39% | 99.94% | 94.93% |
| 自建工具（默认） | 89.08% | 98.86% | 93.72% |
| 自建工具（调优后） | 93.62% | 98.99% | **96.23%** |

主要结论：

- **调优并非单调变好**：jieba 调优后“切碎”由 23 处降到 0 处，但“粘连”由 0 处升到 3 处
  ——分词调优本质上是在“切碎”与“粘连”之间找平衡；
- **自动银标准会掩盖真实错误**：只看银标准时各系统 F1 都在 92% 以上；
  换成人工金标准后，jieba 的整句完全一致率仅约 4%，而自建工具达 33%~46%，
  说明自动评测只适合快速迭代，最终结论仍需人工标准支撑；
- **词云质量的决定因素不是形状配色，而是停用词过滤**：未过滤时标点 1,045 处、
  单字词 2,345 处会挤占画面，过滤后主题立刻凸显。

---

## 五、验证脚本

```bash
python tools/verify_gold.py                 # 标注与原文逐字符一致（24/24 PASS）
python tools/parity_check.py && node tools/parity_check.js   # JS 与 Python 分词对拍
node tools/browser_test.js                  # 无头浏览器跑通前端全流程并截图
python <office-skill>/scripts/check_office.py 项目三主题词云图设计_对比分析报告.docx
```
