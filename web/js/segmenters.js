/*!
 * segmenters.js —— 四种分词器
 * ---------------------------------------------------------------------------
 * A. JiebaSegmenter    ：词典 DAG + 动态规划最大概率路径（可开关 HMM），对齐 jieba
 * B. MaxMatchSegmenter ：自建工具，正向 / 逆向 / 双向最大匹配（可配置 maxLen）
 * C. HmmSegmenter      ：纯 HMM（BMES + Viterbi），用于展示统计方法的效果
 *
 * 所有分词器统一返回 {word, start, end} 序列，便于计算 P/R/F1 与定位切分歧义。
 * 统一约定：输入已清洗的纯中文文本；标点与空白不参与切分。
 */
(function (global) {
  'use strict';

  var RE_HAN = /([\u4E00-\u9FD5a-zA-Z0-9+#&._%\-]+)/;
  var RE_SKIP = /^(\r\n|\s)$/;
  var RE_CJK_ONLY = /^[\u4E00-\u9FD5]+$/;
  var RE_ENG = /^[a-zA-Z0-9]+$/;

  /** 把文本切成「待切分块 / 间隔块」 */
  function blocksOf(text) {
    var blocks = String(text).split(RE_HAN);
    var out = [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b === '') { continue; }
      out.push({ text: b, isHan: i % 2 === 1 });
    }
    return out;
  }

  /** 把非命中块按空白拆开，保留有意义的记号 */
  function splitNonHan(blk) {
    var parts = blk.split(/(\r\n|\s)/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var s = parts[i];
      if (s === '' || RE_SKIP.test(s)) { continue; }
      out.push(s);
    }
    return out;
  }

  // =========================================================================
  // A. jieba 分词器
  // =========================================================================
  function JiebaSegmenter(jieba) {
    this.jieba = jieba;
    this.name = 'jieba';
  }

  JiebaSegmenter.prototype.segment = function (text, opt) {
    opt = opt || {};
    var mode = opt.mode || 'exact';        // exact | full | search
    var hmm = opt.hmm !== false;           // 默认开启
    var jb = this.jieba;
    var res = [];

    var blocks = blocksOf(text);
    var pos = 0;
    for (var bi = 0; bi < blocks.length; bi++) {
      var b = blocks[bi];
      if (b.isHan) {
        var words;
        if (mode === 'full') {
          words = jb.lcut(b.text, true, hmm);
        } else if (mode === 'search') {
          words = jb.lcutForSearch(b.text, hmm);
        } else {
          words = jb.lcut(b.text, false, hmm);
        }
        emit(res, words, b.text, pos);
      } else {
        emit(res, splitNonHan(b.text), b.text, pos);
      }
      pos += b.text.length;
    }
    return res;
  };

  /**
   * 把词序列还原为相对原文的字符区间。
   * 因为切分结果一定按顺序拼接回原串（含纯空白块），所以用「顺序查找 + 严格递增」
   * 即可精确定位，避免 indexOf 命中前面的重复片段。
   */
  function emit(res, tokens, text, base) {
    var cursor = 0;
    for (var i = 0; i < tokens.length; i++) {
      var w = tokens[i];
      var at = text.indexOf(w, cursor);
      if (at < 0) { at = cursor; }
      res.push({ word: w, start: base + at, end: base + at + w.length });
      cursor = at + w.length;
    }
  }

  // =========================================================================
  // B. 自建最大匹配分词器
  // =========================================================================
  /**
   * @param {Dict} dict     词表
   * @param {object} opt    {strategy:'fmm'|'bmm'|'bidir', maxLen:number, hmmFallback:boolean}
   */
  function MaxMatchSegmenter(dict, opt) {
    opt = opt || {};
    this.dict = dict;
    this.strategy = opt.strategy || 'fmm';
    this.maxLen = opt.maxLen || 6;
    this.hmmFallback = !!opt.hmmFallback;
    this.hmm = opt.hmm || null;
    this.name = 'self';
  }

  /** 正向最大匹配（FMM） */
  MaxMatchSegmenter.prototype.fmm = function (s) {
    var out = [], i = 0, n = s.length;
    while (i < n) {
      var len = Math.min(this.maxLen, n - i);
      var matched = '';
      while (len > 0) {
        var cand = s.substr(i, len);
        if (len === 1 || this.dict.has(cand)) { matched = cand; break; }
        len--;
      }
      if (!matched) { matched = s.charAt(i); }
      out.push(matched);
      i += matched.length;
    }
    return out;
  };

  /** 逆向最大匹配（RMM） */
  MaxMatchSegmenter.prototype.bmm = function (s) {
    var out = [], i = s.length;
    while (i > 0) {
      var len = Math.min(this.maxLen, i);
      var matched = '';
      while (len > 0) {
        var cand = s.substr(i - len, len);
        if (len === 1 || this.dict.has(cand)) { matched = cand; break; }
        len--;
      }
      if (!matched) { matched = s.charAt(i - 1); }
      out.unshift(matched);
      i -= matched.length;
    }
    return out;
  };

  /**
   * 双向最大匹配的歧义消解规则（常用工程规则）：
   *   1) 词数不同 -> 取词数较少者（切分更粗、更符合语义）
   *   2) 词数相同 -> 取单字词较少者
   *   3) 仍相同   -> 取逆向结果（中文中逆向通常更稳）
   */
  MaxMatchSegmenter.prototype.bidir = function (s) {
    var f = this.fmm(s), b = this.bmm(s);
    if (f.length !== b.length) { return f.length < b.length ? f : b; }
    var sf = countSingle(f), sb = countSingle(b);
    if (sf !== sb) { return sf < sb ? f : b; }
    return b;
  };

  function countSingle(arr) {
    var c = 0;
    for (var i = 0; i < arr.length; i++) { if (arr[i].length === 1) { c++; } }
    return c;
  }

  MaxMatchSegmenter.prototype.cut = function (s) {
    var words;
    if (this.strategy === 'bmm') { words = this.bmm(s); }
    else if (this.strategy === 'bidir') { words = this.bidir(s); }
    else { words = this.fmm(s); }
    if (this.hmmFallback && this.hmm) { words = this.applyHmmFallback(words); }
    return words;
  };

  /** 未登录词回退：把连续的单字串交给 HMM 重新组合 */
  MaxMatchSegmenter.prototype.applyHmmFallback = function (words) {
    var out = [], buf = '';
    var hmm = this.hmm;
    var flush = function () {
      if (!buf) { return; }
      if (buf.length === 1) { out.push(buf); }
      else {
        var sub = hmm.cut(buf);
        for (var k = 0; k < sub.length; k++) { out.push(sub[k]); }
      }
      buf = '';
    };
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.length === 1 && RE_CJK_ONLY.test(w)) { buf += w; }
      else { flush(); out.push(w); }
    }
    flush();
    return out;
  };

  MaxMatchSegmenter.prototype.segment = function (text, opt) {
    opt = opt || {};
    var saved = { strategy: this.strategy, maxLen: this.maxLen, hmmFallback: this.hmmFallback };
    if (opt.strategy) { this.strategy = opt.strategy; }
    if (opt.maxLen) { this.maxLen = opt.maxLen; }
    if (opt.hmmFallback !== undefined) { this.hmmFallback = opt.hmmFallback; }

    var res = [], pos = 0;
    var blocks = blocksOf(text);
    for (var bi = 0; bi < blocks.length; bi++) {
      var b = blocks[bi];
      if (b.isHan) { emit(res, this.cut(b.text), b.text, pos); }
      else { emit(res, splitNonHan(b.text), b.text, pos); }
      pos += b.text.length;
    }
    this.strategy = saved.strategy; this.maxLen = saved.maxLen; this.hmmFallback = saved.hmmFallback;
    return res;
  };

  // =========================================================================
  // C. 纯 HMM 分词器（统计方法基线）
  // =========================================================================
  function HmmSegmenter(hmm) {
    this.hmm = hmm;
    this.name = 'hmm';
  }

  HmmSegmenter.prototype.segment = function (text) {
    var res = [], pos = 0;
    var blocks = blocksOf(text);
    for (var bi = 0; bi < blocks.length; bi++) {
      var b = blocks[bi];
      if (b.isHan) { emit(res, this.hmm.cut(b.text), b.text, pos); }
      else { emit(res, splitNonHan(b.text), b.text, pos); }
      pos += b.text.length;
    }
    return res;
  };

  global.JiebaSegmenter = JiebaSegmenter;
  global.MaxMatchSegmenter = MaxMatchSegmenter;
  global.HmmSegmenter = HmmSegmenter;
  global.blocksOf = blocksOf;
})(window);
