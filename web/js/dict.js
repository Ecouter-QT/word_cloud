/*!
 * dict.js —— 词典容器
 * ---------------------------------------------------------------------------
 * 统一封装 jieba 前缀词典（349,046 词 / 总词频 60,101,967），并提供：
 *   - 词频查询 / 词性查询（jieba 语义：freq 缺失时返回 0）
 *   - 用户词典（load_userdict 语义）与动态加词（add_word 语义）
 *   - 调频（suggest_freq 语义）
 *   - 前缀集合（供 DAG / 最大匹配使用）
 * 数据来源：web/data/jieba_dict.js（由 tools/build_jieba_assets.py 从 jieba 0.42.1 导出）
 */
(function (global) {
  'use strict';

  var MIN_FREQ = 1;

  function Dict(raw) {
    raw = raw || { words: [], freqs: [], tags: [], tagNames: [''], total: 60101967 };
    this.freq = Object.create(null);   // 词 -> 词频
    this.tag = Object.create(null);    // 词 -> 词性
    this.prefix = Object.create(null); // 前缀 -> true（用于判断存在性）
    this.total = raw.total || 60101967;
    this.userWords = [];               // 记录用户词典加载的词，便于展示
    this.tunedWords = [];              // 记录 suggest_freq 调整过的词

    var words = raw.words, freqs = raw.freqs, tags = raw.tags, names = raw.tagNames;
    var prefix = this.prefix, freq = this.freq, tag = this.tag;
    for (var i = 0, n = words.length; i < n; i++) {
      var w = words[i];
      freq[w] = freqs[i];
      var t = names[tags[i]];
      if (t) { tag[w] = t; }
      // 建立前缀索引
      for (var k = 1, L = w.length; k <= L; k++) {
        var p = w.slice(0, k);
        if (prefix[p] === undefined) { prefix[p] = 1; }
      }
    }
    this.total += 0;
  }

  Dict.prototype.has = function (word) {
    return this.freq[word] !== undefined;
  };

  /** jieba 语义：未收录词返回 0 */
  Dict.prototype.getFreq = function (word) {
    var f = this.freq[word];
    return f === undefined ? 0 : f;
  };

  Dict.prototype.getTag = function (word) {
    return this.tag[word] || '';
  };

  /** 某个前缀是否存在于词典中（DAG 与最大匹配都要用） */
  Dict.prototype.isPrefix = function (str) {
    return this.prefix[str] !== undefined;
  };

  /** jieba.add_word(word, freq=None, tag=None) */
  Dict.prototype.addWord = function (word, freq, tag) {
    if (freq === undefined || freq === null || freq === 0) {
      // jieba 逻辑：freq 缺省时取"能保证该词被切出来"的最小可用词频
      freq = Math.max(this.getFreq(word), MIN_FREQ);
      // 使用词语中各个字/子词的最小值推导（简化但有效的实现）
      var self = this;
      var pieces = [];
      (function split(w) {
        if (w.length < 2) { return; }
        for (var i = 1; i < w.length; i++) {
          var left = w.slice(0, i), right = w.slice(i);
          if (self.has(left) && self.has(right)) {
            pieces.push(left); pieces.push(right);
            split(left); split(right);
            return;
          }
        }
      })(word);
      var minFreq = Infinity;
      for (var j = 0; j < pieces.length; j++) {
        var f = this.getFreq(pieces[j]);
        if (f > 0 && f < minFreq) { minFreq = f; }
      }
      if (!isFinite(minFreq)) { minFreq = MIN_FREQ; }
      freq = Math.max(Math.ceil(minFreq), MIN_FREQ);
    }
    this.freq[word] = freq;
    if (tag) { this.tag[word] = tag; }
    for (var k = 1, L = word.length; k <= L; k++) {
      var p = word.slice(0, k);
      if (this.prefix[p] === undefined) { this.prefix[p] = 1; }
    }
  };

  /**
   * jieba.suggest_freq 的简化实现：
   *   tune=true  -> 调高词频，使该词"能"被切出来
   *   tune=false -> 调低词频，使该词"不会"被切出来
   */
  Dict.prototype.suggestFreq = function (word, tune, tag) {
    var prev = this.freq[word];
    if (tune === false) {
      this.freq[word] = 0;
      this.tunedWords.push({ word: word, from: prev === undefined ? null : prev, to: 0, tune: false });
      return 0;
    }
    var f;
    if (word.length === 1) {
      f = Math.max(this.total / 1e5, this.getFreq(word));
    } else {
      var self = this;
      var pieces = [];
      (function split(w) {
        if (w.length < 2) { return; }
        for (var i = 1; i < w.length; i++) {
          var left = w.slice(0, i), right = w.slice(i);
          if (self.has(left) && self.has(right)) {
            pieces.push(left); pieces.push(right);
            split(left); split(right);
            return;
          }
        }
      })(word);
      var minFreq = Infinity;
      for (var j = 0; j < pieces.length; j++) {
        var pf = this.getFreq(pieces[j]);
        if (pf > 0 && pf < minFreq) { minFreq = pf; }
      }
      f = Math.max(Math.ceil(minFreq), MIN_FREQ);
      // 保证超过各切分方案的组合概率
      var base = 1;
      for (var k = 0; k < pieces.length; k++) { base *= Math.max(this.getFreq(pieces[k]), MIN_FREQ); }
      f = Math.max(f, Math.ceil(Math.pow(base, 1 / Math.max(pieces.length, 1)) * 2));
      if (!isFinite(f) || f <= 0) { f = MIN_FREQ; }
    }
    this.freq[word] = f;
    if (tag) { this.tag[word] = tag; }
    this.tunedWords.push({ word: word, from: prev === undefined ? null : prev, to: f, tune: true });
    return f;
  };

  /**
   * jieba.load_userdict 语义。每行：词 [词频] [词性]
   * 支持中文空格 / 制表符分隔。
   */
  Dict.prototype.loadUserDict = function (text, label) {
    var lines = String(text).split(/\r?\n/);
    var count = 0, skipped = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^\uFEFF/, '').trim();
      if (!line || line.charAt(0) === '#') { continue; }
      var parts = line.split(/[\s\t]+/);
      var word = parts[0];
      if (!word) { skipped++; continue; }
      var freq = null, tag = '';
      if (parts.length > 1 && /^\d+$/.test(parts[1])) {
        freq = parseInt(parts[1], 10);
        if (parts.length > 2) { tag = parts[2]; }
      } else if (parts.length > 1) {
        tag = parts[1];
      }
      var isNew = !this.has(word);
      this.addWord(word, freq, tag);
      count++;
      this.userWords.push({ word: word, freq: this.getFreq(word), tag: tag, isNew: isNew, source: label || 'user_dict' });
    }
    return { loaded: count, skipped: skipped, newWords: this.userWords.filter(function (w) { return w.isNew; }).length };
  };

  Dict.prototype.stats = function () {
    return {
      entries: Object.keys(this.freq).length,
      total: this.total,
      userWords: this.userWords.length,
      tunedWords: this.tunedWords.length
    };
  };

  /** 用当前词典快照新建一个副本（用于"调优后"对比，避免污染原始词典） */
  Dict.prototype.clone = function () {
    var d = Object.create(Dict.prototype);
    d.freq = Object.assign(Object.create(null), this.freq);
    d.tag = Object.assign(Object.create(null), this.tag);
    d.prefix = Object.assign(Object.create(null), this.prefix);
    d.total = this.total;
    d.userWords = this.userWords.slice();
    d.tunedWords = this.tunedWords.slice();
    return d;
  };

  global.Dict = Dict;
  global.MIN_FREQ = MIN_FREQ;
})(window);
