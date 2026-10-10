/*!
 * jieba.js —— jieba 分词算法在浏览器中的复现
 * ---------------------------------------------------------------------------
 * 本文件按 jieba 0.42.1 的处理流程重写，行为对齐 Python 版：
 *   1) 用正则把文本切成「汉字串 / 连续字母数字串 / 空白 / 其他」几类片段；
 *   2) 对汉字串建立 DAG（有向无环图，基于前缀词典）；
 *   3) 用动态规划求最大概率路径（词频取对数相加）；
 *   4) 未被词典覆盖的片段交给 HMM（BMES 四状态 Viterbi）做未登录词识别；
 *   5) 提供 精确模式 / 全模式 / 搜索引擎模式 三种切分，以及 HMM 开关。
 * 对应 Python API：lcut / lcut(cut_all=True) / lcut_for_search / load_userdict /
 *                 add_word / suggest_freq。
 */
(function (global) {
  'use strict';

  // ---- 与 jieba 一致的正则（见 jieba/__init__.py）-------------------------
  // re_han_default = "([\u4E00-\u9FD5a-zA-Z0-9+#&\._%\-]+)"
  var RE_HAN_SRC = '[\\u4E00-\\u9FD5a-zA-Z0-9+#&._%\\-]+';
  var RE_HAN_SPLIT = new RegExp('(' + RE_HAN_SRC + ')', 'g');  // 等价 re_han.split
  var RE_HAN_BLOCK = new RegExp('^' + RE_HAN_SRC);            // 等价 re_han.match
  // re_skip_default = "(\r\n|\s)"
  var RE_SKIP = /^(\r\n|\s)$/;
  // re_eng = "[a-zA-Z0-9]"（Python 的 re.match 等价于"首字符匹配"）
  var RE_ENG = /^[a-zA-Z0-9]/;
  // 是否含汉字
  var RE_CJK = /[\u4E00-\u9FD5]/;
  // 中文标点（用于停用词过滤与句子切分）
  var RE_PUNCT = /[\s，。！？、；：""''（）《》【】—…·,.!?;:()"'\[\]{}<>\/\\|~`@#$%^&*+=_-]+/;

  var MIN_FLOAT = -3.14e100;

  // ---- HMM（finalseg）----------------------------------------------------
  // jieba 的未登录词识别模块：用 BMES 四状态 HMM + Viterbi 解码。
  // 下面这张 "单字可出现的状态表" 与 jieba/finalseg 的行为一致（finalseg 不限制取字状态）。
  function HMM(raw) {
    this.start = raw.start;
    this.trans = raw.trans;
    this.emit = raw.emit;
    this.states = ['B', 'M', 'E', 'S'];
    // PrevStatus：B 之前只能是 E 或 S；M/E 之前只能是 M 或 B；S 之前只能是 E 或 S
    this.prev = { B: 'ES', M: 'MB', E: 'BM', S: 'ES' };
  }

  HMM.prototype.viterbi = function (obs) {
    var states = this.states, prev = this.prev;
    var start = this.start, trans = this.trans, emit = this.emit;
    var V = [], path = {}, y, y0, t, i;
    var firstChar = obs.charAt(0);
    V[0] = {};
    for (i = 0; i < states.length; i++) {
      y = states[i];
      V[0][y] = start[y] + (emit[y] && emit[y][firstChar] !== undefined ? emit[y][firstChar] : MIN_FLOAT);
      path[y] = [y];
    }
    for (t = 1; t < obs.length; t++) {
      var ch = obs.charAt(t);
      V[t] = {};
      var newPath = {};
      for (i = 0; i < states.length; i++) {
        y = states[i];
        var emP = (emit[y] && emit[y][ch] !== undefined) ? emit[y][ch] : MIN_FLOAT;
        var prevStates = prev[y];
        var best = MIN_FLOAT, bestState = prevStates.charAt(0);
        for (var k = 0; k < prevStates.length; k++) {
          y0 = prevStates.charAt(k);
          var tr = trans[y0] && trans[y0][y] !== undefined ? trans[y0][y] : MIN_FLOAT;
          var cand = V[t - 1][y0] + tr + emP;
          if (cand > best) { best = cand; bestState = y0; }
        }
        V[t][y] = best;
        newPath[y] = path[bestState].concat([y]);
      }
      path = newPath;
    }
    var last = V[obs.length - 1];
    var bestProb = MIN_FLOAT, bestFinal = 'S';
    var finals = ['E', 'S'];
    for (i = 0; i < finals.length; i++) {
      if (last[finals[i]] > bestProb) { bestProb = last[finals[i]]; bestFinal = finals[i]; }
    }
    return path[bestFinal];
  };

  /** finalseg.__cut：把一段无词典覆盖的汉字串按 BMES 序列切开 */
  HMM.prototype.cut = function (sentence) {
    var posList = this.viterbi(sentence);
    var out = [], begin = 0, i;
    for (i = 0; i < sentence.length; i++) {
      if (posList[i] === 'B') { begin = i; }
      else if (posList[i] === 'E') { out.push(sentence.slice(begin, i + 1)); begin = i + 1; }
      else if (posList[i] === 'S') { out.push(sentence.charAt(i)); begin = i + 1; }
    }
    if (begin < sentence.length) { out.push(sentence.slice(begin)); }
    return out;
  };

  // ---- jieba 主体 --------------------------------------------------------
  function Jieba(dict, hmmModel) {
    this.dict = dict;
    this.hmm = hmmModel ? new HMM(hmmModel) : null;
    this.useHMM = true;
    this.logTotal = Math.log(dict.total);
    this._cache = Object.create(null);
  }

  /** 频率 -> 对数概率（越低频代价越高），未收录词用极小概率 */
  Jieba.prototype._logFreq = function (word) {
    var f = this.dict.getFreq(word);
    if (f > 0) { return Math.log(f) - this.logTotal; }
    return Math.log(1) - this.logTotal;
  };

  /**
   * 构建 DAG：外层 k 为词的起始位置，内层 i 为词尾位置。
   * 注意 frag 必须是 sentence.slice(k, i+1)（从起点 k 开始），
   * 这里是 jieba 前缀词典 DAG 的关键——写成 slice(i, ...) 会让循环永不结束。
   */
  Jieba.prototype._getDAG = function (sentence) {
    var dag = {}, n = sentence.length, k, i, frag;
    for (k = 0; k < n; k++) {
      var ends = [];
      i = k;
      frag = sentence.charAt(k);
      while (i < n && this.dict.isPrefix(frag)) {
        if (this.dict.has(frag)) { ends.push(i); }
        i++;
        frag = sentence.slice(k, i + 1);
      }
      if (!ends.length) { ends.push(k); }
      dag[k] = ends;
    }
    return dag;
  };

  /** 动态规划求最大概率路径（jieba.calc） */
  Jieba.prototype._calc = function (sentence, dag) {
    var n = sentence.length;
    var route = {};
    route[n] = { log: 0, idx: 0 };
    for (var i = n - 1; i >= 0; i--) {
      var best = -Infinity, bestIdx = i;
      var ends = dag[i];
      for (var k = 0; k < ends.length; k++) {
        var j = ends[k];
        var word = sentence.slice(i, j + 1);
        var val = this._logFreq(word) + route[j + 1].log;
        if (val > best) { best = val; bestIdx = j; }
      }
      route[i] = { log: best, idx: bestIdx };
    }
    return route;
  };

  /**
   * 对应 jieba.__cut_DAG：词典最大概率路径 + HMM 识别未登录词。
   * 路径上的单字先缓冲；遇到多字词时把缓冲区交出去：
   *   · 长度 1        -> 直接输出
   *   · 词典中存在     -> 逐字拆开（说明它其实不是一个词）
   *   · 词典中不存在   -> 用 HMM 重切（识别未登录词）
   */
  Jieba.prototype._cutDAG = function (sentence) {
    var dag = this._getDAG(sentence);
    var route = this._calc(sentence, dag);
    var out = [];
    var x = 0, n = sentence.length, buf = '';
    var self0 = this;
    var flush = function () {
      if (!buf) { return; }
      if (buf.length === 1) {
        out.push(buf);
      } else if (self0.dict.getFreq(buf) > 0) {
        // 该串本身是词典词，但路径没选中它，按字拆开
        for (var c = 0; c < buf.length; c++) { out.push(buf.charAt(c)); }
      } else if (self0.hmm) {
        var sub = self0.hmm.cut(buf);
        for (var k = 0; k < sub.length; k++) { out.push(sub[k]); }
      } else {
        for (var c2 = 0; c2 < buf.length; c2++) { out.push(buf.charAt(c2)); }
      }
      buf = '';
    };
    while (x < n) {
      var y = route[x].idx + 1;
      var word = sentence.slice(x, y);
      if (y - x === 1) {
        buf += word;          // 单字：暂时缓冲，可能是未登录词的组成部分
      } else {
        flush();
        out.push(word);       // 多字词：直接在词典中命中
      }
      x = y;
    }
    flush();
    return out;
  };

  /**
   * 对应 jieba.__cut_DAG_NO_HMM：关闭 HMM 时只用词典 DAG。
   * 特殊之处是连续的字母/数字会被当作一个整体保留下来（re_eng 分支）。
   */
  Jieba.prototype._cutDAGNoHMM = function (sentence) {
    var dag = this._getDAG(sentence);
    var route = this._calc(sentence, dag);
    var out = [];
    var x = 0, n = sentence.length, buf = '';
    var flush = function () { if (buf) { out.push(buf); buf = ''; } };
    while (x < n) {
      var y = route[x].idx + 1;
      var word = sentence.slice(x, y);
      if (y - x === 1 && RE_ENG.test(word)) {
        buf += word;              // 单个字母/数字：与后续字母数字拼成一个整体
      } else {
        flush();
        if (word.length > 1) {
          out.push(word);         // 多字词（或整个字母数字串）：直接输出
        } else {
          for (var i = 0; i < word.length; i++) { out.push(word.charAt(i)); }
        }
      }
      x = y;
    }
    flush();
    return out;
  };

  /**
   * 全模式（对应 jieba.__cut_all，即 lcut(cut_all=True)）。
   * 逐位置扫描 DAG：
   *   · L 只有一个位置且该位置未被前面的词覆盖 -> 输出单字（字母数字会被合并成一整串）
   *   · L 有多个位置 -> 输出所有"多字词"（不输出单字），并把游标推进到最后一个词尾
   * old_j 用于跳过已被长词覆盖的位置，这是全模式输出顺序的关键。
   */
  Jieba.prototype._cutAll = function (sentence) {
    var dag = this._getDAG(sentence);
    var out = [], k, j;
    var oldJ = -1, engScan = 0, engBuf = '';
    for (k = 0; k < sentence.length; k++) {
      var L = dag[k];
      if (engScan === 1 && !RE_ENG.test(sentence.charAt(k))) {
        engScan = 0;
        out.push(engBuf);
        engBuf = '';
      }
      if (L.length === 1 && k > oldJ) {
        var word = sentence.slice(k, L[0] + 1);
        if (RE_ENG.test(word)) {
          if (engScan === 0) { engScan = 1; engBuf = word; }
          else { engBuf += word; }
        }
        if (engScan === 0) { out.push(word); }
        oldJ = L[0];
      } else {
        for (var t = 0; t < L.length; t++) {
          j = L[t];
          if (j > k) {
            out.push(sentence.slice(k, j + 1));
            oldJ = j;
          }
        }
      }
    }
    if (engScan === 1) { out.push(engBuf); }
    return out;
  };

  /** 内部：按正则把文本分块后逐块切分（对应 jieba.__cut_internal） */
  Jieba.prototype._tokenize = function (text, mode, withHMM) {
    var out = [];
    var blocks = String(text).split(RE_HAN_SPLIT);
    for (var bi = 0; bi < blocks.length; bi++) {
      var blk = blocks[bi];
      if (blk === '') { continue; }
      if (RE_HAN_BLOCK.test(blk)) {
        // 命中 re_han：包含汉字/字母数字，交给对应的切分函数
        var seg;
        if (mode === 'all') { seg = this._cutAll(blk); }
        else { seg = withHMM ? this._cutDAG(blk) : this._cutDAGNoHMM(blk); }
        for (var i = 0; i < seg.length; i++) { out.push(seg[i]); }
      } else {
        // 非命中块：按 re_skip 拆分；非全模式下把剩余字符逐字输出
        var sub = blk.split(/(\r\n|\s)/);
        for (var k = 0; k < sub.length; k++) {
          var s = sub[k];
          if (s === '') { continue; }
          if (RE_SKIP.test(s)) { out.push(s); }
          else if (mode !== 'all') {
            for (var c = 0; c < s.length; c++) { out.push(s.charAt(c)); }
          } else {
            out.push(s);
          }
        }
      }
    }
    return out;
  };

  /** jieba.lcut(text) / jieba.lcut(text, cut_all=True) / HMM 开关 */
  Jieba.prototype.lcut = function (text, cutAll, hmm) {
    var useHmm = (hmm === undefined) ? this.useHMM : !!hmm;
    return this._tokenize(text, cutAll ? 'all' : 'exact', useHmm);
  };

  /**
   * 搜索引擎模式（对应 jieba.lcut_for_search）：
   * 先精确切分，再对长度大于 2 的词额外输出其中的二字子词（若该子词在词典中）。
   */
  Jieba.prototype.lcutForSearch = function (text, hmm) {
    var seg = this.lcut(text, false, hmm);
    var out = [];
    for (var i = 0; i < seg.length; i++) {
      var w = seg[i];
      var j;
      if (w.length > 2) {
        for (j = 0; j < w.length - 1; j++) {
          var g2 = w.substr(j, 2);
          if (this.dict.getFreq(g2)) { out.push(g2); }
        }
      }
      if (w.length > 3) {
        for (j = 0; j < w.length - 2; j++) {
          var g3 = w.substr(j, 3);
          if (this.dict.getFreq(g3)) { out.push(g3); }
        }
      }
      out.push(w);
    }
    return out;
  };

  Jieba.prototype.loadUserDict = function (text, label) { return this.dict.loadUserDict(text, label); };
  Jieba.prototype.addWord = function (w, f, t) { return this.dict.addWord(w, f, t); };
  Jieba.prototype.suggestFreq = function (w, tune, t) { return this.dict.suggestFreq(w, tune, t); };

  global.HMM = HMM;
  global.Jieba = Jieba;
})(window);
