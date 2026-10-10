/*!
 * pipeline.js —— 端到端流程封装
 * ---------------------------------------------------------------------------
 * 把「语料读取 → 清洗预处理 → 分词 → 停用词过滤 → 词频统计 → 词云 → 对比评测」
 * 串成一条 Pipeline（对应实验要求里的"端到端流程封装"改进方向）：
 *
 *   Pipeline.run({rawText, files, options}) -> result
 *
 * 其中 options 覆盖所有调优开关：
 *   jieba:  {mode, hmm, userDict, addWords, suggestFreq, tuneStopwords}
 *   self:   {strategy, maxLen, hmmFallback, extendFromJieba}
 *   pre:    {removeHtml, keepPunct, minLen, maxLen, stopwords, useTagFilter}
 *   cloud:  {shape, palette, maxWords, mapping, ...}
 */
(function (global) {
  'use strict';

  var RE_HTML = /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi;
  var RE_ENTITY = /&[a-zA-Z#0-9]{1,8};/g;
  var RE_URL = /https?:\/\/[^\s，。；）)】\]]+/gi;
  var RE_ZERO = /[\u200B-\u200F\u202A-\u202E\uFEFF]/g;
  // 允许保留的字符：汉字、字母数字、常用中文标点、基础西文标点
  var RE_KEEP = /[^\u4E00-\u9FD5a-zA-Z0-9\u3000-\u303F\uFF00-\uFFEF，。！？、；：""''（）《》〈〉【】「」『』—…·％＋－×÷＝,.\-!?;:()"'\[\]{}<>\/\\|~`@#$%^&*+=_\s]/g;

  // 词性黑名单：这些词性的词几乎不承载主题信息，词云里应剔除
  var STOP_TAGS = {
    'u': 1, 'p': 1, 'c': 1, 'd': 1, 'r': 1, 'm': 1, 'q': 1, 'f': 1, 't': 1,
    'y': 1, 'e': 1, 'o': 1, 'x': 1, 'w': 1, 'uj': 1, 'ul': 1, 'uv': 1, 'uz': 1,
    'ud': 1, 'ug': 1, 'ng': 1, 'zg': 1
  };

  var TAG_NAMES = {
    n: '名词', nr: '人名', ns: '地名', nt: '机构名', nz: '其他专名', nl: '名词性惯用语',
    ng: '名词性语素', v: '动词', vd: '副动词', vn: '名动词', vx: '动词性语素',
    a: '形容词', ad: '副形词', an: '名形词', ag: '形容词语素', b: '区别词',
    d: '副词', m: '数词', mq: '数量词', q: '量词', r: '代词', p: '介词',
    c: '连词', u: '助词', xc: '其他虚词', w: '标点', f: '方位词', s: '处所词',
    t: '时间词', tg: '时间语素', z: '状态词', eng: '英文', x: '非语素字',
    j: '简称略语', l: '习用语', i: '成语', g: '语素', h: '前缀', k: '后缀',
    o: '拟声词', e: '叹词', y: '语气词', uj: '结构助词', ul: '时态助词',
    uv: '动词助词', uz: '状态助词', ud: '助词', ug: '助词', zg: '状态语素',
    df: '连词', nrfg: '古人名', nrt: '音译人名', un: '未知词'
  };

  // ------------------------------------------------------------------ 预处理
  /**
   * 语料预处理：去 HTML/实体/URL/零宽字符，统一全角空格，可选保留标点。
   * 返回 {text, stats}
   */
  function preprocess(raw, opt) {
    opt = opt || {};
    var stats = { original: raw.length };
    var text = String(raw || '');
    if (opt.removeHtml !== false) {
      text = text.replace(RE_HTML, ' ').replace(RE_ENTITY, ' ').replace(RE_URL, ' ');
    }
    text = text.replace(RE_ZERO, '');
    // 统一换行与空白
    text = text.replace(/\r\n?/g, '\n').replace(/\u3000/g, ' ');
    text = text.replace(/[ \t\f\v]+/g, ' ');
    text = text.replace(/\n{2,}/g, '\n');
    if (opt.keepPunct === false) {
      text = text.replace(/[\u3000-\u303F\uFF00-\uFFEF，。！？、；：""''（）《》—…·]/g, ' ');
    }
    text = text.replace(RE_KEEP, ' ');
    text = text.replace(/[ ]{2,}/g, ' ');
    stats.cleaned = text.length;
    stats.cjk = (text.match(/[\u4E00-\u9FD5]/g) || []).length;
    stats.removed = stats.original - text.length;
    return { text: text, stats: stats };
  }

  /** 停用词集合 */
  function parseStopwords(text) {
    var set = Object.create(null);
    var lines = String(text || '').split(/\r?\n/);
    var n = 0;
    for (var i = 0; i < lines.length; i++) {
      var w = lines[i].replace(/^\uFEFF/, '').trim();
      if (!w || w.charAt(0) === '#') { continue; }
      // 一行可能有多个词（空格分隔）
      var parts = w.split(/[\s\t]+/);
      for (var j = 0; j < parts.length; j++) {
        if (parts[j] && set[parts[j]] === undefined) { set[parts[j]] = 1; n++; }
      }
    }
    set.__size = n;
    return set;
  }

  // -------------------------------------------------------- 分词结果 -> 词频
  /**
   * 过滤 + 计数。
   * @param {Array<{word,start,end}>} tokens
   * @param {object} opt {stopwords, minLen, maxLen, dict, useTagFilter, keepTags}
   */
  function toFrequencies(tokens, opt) {
    opt = opt || {};
    var stop = opt.stopwords || Object.create(null);
    var minLen = opt.minLen === undefined ? 2 : opt.minLen;
    var maxLen = opt.maxLen === undefined ? 12 : opt.maxLen;
    var dict = opt.dict;
    var freq = Object.create(null);
    var dropped = { stopword: 0, short: 0, long: 0, punct: 0, number: 0, tag: 0 };
    var kept = 0, total = 0;
    var tagOf = Object.create(null);

    for (var i = 0; i < tokens.length; i++) {
      var w = tokens[i].word;
      total++;
      if (!/[\u4E00-\u9FD5a-zA-Z]/.test(w)) { dropped.number++; continue; }
      if (Metrics.PUNCT_RE.test(w)) { dropped.punct++; continue; }
      if (stop[w]) { dropped.stopword++; continue; }
      if (w.length < minLen) { dropped.short++; continue; }
      if (maxLen && w.length > maxLen) { dropped.long++; continue; }
      if (opt.useTagFilter && dict) {
        var tag = dict.getTag(w);
        tagOf[w] = tag;
        if (tag && STOP_TAGS[tag]) { dropped.tag++; continue; }
      } else if (dict) {
        tagOf[w] = dict.getTag(w);
      }
      freq[w] = (freq[w] || 0) + 1;
      kept++;
    }

    var list = Object.keys(freq).map(function (k) {
      return { word: k, count: freq[k], tag: tagOf[k] || '', tagName: TAG_NAMES[tagOf[k]] || '' };
    });
    list.sort(function (a, b) { return b.count - a.count || (a.word < b.word ? -1 : 1); });
    return { list: list, dropped: dropped, kept: kept, total: total, tagOf: tagOf };
  }

  // ------------------------------------------------------------------ 主流程
  function Pipeline(deps) {
    // deps: {dict, hmm(实例), jieba}
    this.dict = deps.dict;
    this.hmm = deps.hmm;
    this.jieba = deps.jieba;
  }

  /**
   * 执行一次完整分析。
   * @param {object} input {rawText}
   * @param {object} options 见文件头注释
   */
  Pipeline.prototype.run = function (input, options, onStage) {
    var self = this;
    var opt = options || {};
    var stage = function (name, extra) { if (onStage) { onStage(name, extra); } };

    // ---- 1. 预处理 ----
    stage('预处理');
    var pre = preprocess(input.rawText, opt.pre || {});
    var text = pre.text;
    var sentences = Metrics.splitSentences(text);

    // ---- 2. 准备两个"调优后"的词典副本（不污染原始词典）----
    stage('加载词典与调优');
    var base = this.dict;

    // jieba：默认版（不加载用户词典、不开 HMM）
    var jiebaDefault = this.jieba;

    // jieba：调优版 —— 复制词典后加载用户词典 / 动态加词 / 调频
    var tunedDict = base.clone();
    var userLoadInfo = null;
    if (opt.jieba && opt.jieba.userDict) {
      userLoadInfo = tunedDict.loadUserDict(opt.jieba.userDict, 'user_dict.txt');
    }
    if (opt.jieba && opt.jieba.addWords) {
      var addLines = String(opt.jieba.addWords).split(/\r?\n/);
      for (var i = 0; i < addLines.length; i++) {
        var line = addLines[i].trim();
        if (!line || line.charAt(0) === '#') { continue; }
        var parts = line.split(/[\s,，]+/);
        var word = parts[0];
        var f = parts[1] && /^\d+$/.test(parts[1]) ? parseInt(parts[1], 10) : undefined;
        var tag = parts[2] || '';
        if (word) { tunedDict.addWord(word, f, tag); }
      }
    }
    var tuneInfo = [];
    if (opt.jieba && opt.jieba.suggestFreq) {
      var sLines = String(opt.jieba.suggestFreq).split(/\r?\n/);
      for (var k = 0; k < sLines.length; k++) {
        var s = sLines[k].trim();
        if (!s) { continue; }
        var neg = false;
        if (s.charAt(0) === '!') { neg = true; s = s.slice(1).trim(); }
        var sp = s.split(/[\s,，]+/);
        var fBefore = tunedDict.getFreq(sp[0]);
        var fAfter = tunedDict.suggestFreq(sp[0], !neg, sp[1] || '');
        tuneInfo.push({ word: sp[0], from: fBefore, to: fAfter, tune: !neg });
      }
    }
    // 调优版 jieba：复用同一个已加载的 HMM 实例（注意 Jieba 构造函数会 new HMM，
    // 因此传 null 后必须手动挂上实例，不能传原始数据对象）
    var tunedJieba = new global.Jieba(tunedDict, null);
    tunedJieba.hmm = this.hmm;
    tunedJieba.useHMM = true;

    // 自建工具：用「原始词典」→ 调优前；「扩充分词表」→ 调优后
    var selfDictDefault = base.clone();
    var selfDictTuned = base.clone();
    var extendInfo = { added: 0, words: [] };
    if (opt.self && opt.self.extendFromJieba) {
      // 用 jieba 调优后的结果反向扩充自建词典（实验要求中的做法）
      var probe = new global.JiebaSegmenter(tunedJieba).segment(text, {
        mode: opt.jieba.mode || 'exact', hmm: opt.jieba.hmm !== false
      });
      var seen = Object.create(null);
      for (var p = 0; p < probe.length; p++) {
        var pw = probe[p].word;
        if (pw.length >= 2 && /^[\u4E00-\u9FD5]+$/.test(pw) && !selfDictTuned.has(pw) && !seen[pw]) {
          seen[pw] = 1;
          selfDictTuned.addWord(pw, tunedDict.getFreq(pw) || 10, tunedDict.getTag(pw));
          extendInfo.added++;
          if (extendInfo.words.length < 60) { extendInfo.words.push(pw); }
        }
      }
    }

    // ---- 3. 四组分词（默认/调优 × jieba/自建）----
    stage('分词');
    var jiebaOpts = opt.jieba || {};
    var selfOpts = opt.self || {};
    var jMode = jiebaOpts.mode || 'exact';
    var jHmmTuned = jiebaOpts.hmm !== false;

    var segJiebaDefault = new global.JiebaSegmenter(jiebaDefault)
      .segment(text, { mode: jMode, hmm: false });
    var segJiebaTuned = new global.JiebaSegmenter(tunedJieba)
      .segment(text, { mode: jMode, hmm: jHmmTuned });

    var mm = new global.MaxMatchSegmenter(selfDictDefault, {
      strategy: selfOpts.strategy || 'fmm',
      maxLen: selfOpts.maxLen || 6,
      hmmFallback: false
    });
    var segSelfDefault = mm.segment(text, {});

    var mmTuned = new global.MaxMatchSegmenter(selfDictTuned, {
      strategy: selfOpts.strategy || 'fmm',
      maxLen: selfOpts.maxLenTuned || selfOpts.maxLen || 8,
      hmmFallback: !!selfOpts.hmmFallback,
      hmm: this.hmm
    });
    var segSelfTuned = mmTuned.segment(text, {});

    // ---- 4. 金标准：人工标注 或 自动银标准 ----
    stage('构建评测标准');
    var gold, goldSource;
    if (opt.goldText && opt.goldText.trim()) {
      gold = Metrics.parseGold(opt.goldText, text);
      goldSource = '人工标注';
    } else {
      // 银标准用全部 4 个系统投票（≥2/3 一致），这样每个系统都可能与标准不同，
      // 指标才有区分度；若只用 3 个系统投票，被排除的那个会天然拿满分。
      gold = Metrics.buildSilverStandard(
        [segJiebaDefault, segJiebaTuned, segSelfDefault, segSelfTuned], sentences);
      goldSource = '自动银标准（4 个分词器投票，超过半数一致）';
    }

    // ---- 5. 指标 ----
    stage('计算指标');
    var variants = [
      { key: 'jieba_default', label: 'jieba（默认）', tokens: segJiebaDefault },
      { key: 'jieba_tuned', label: 'jieba（调优后）', tokens: segJiebaTuned },
      { key: 'self_default', label: '自建工具（默认）', tokens: segSelfDefault },
      { key: 'self_tuned', label: '自建工具（调优后）', tokens: segSelfTuned }
    ];
    var metrics = {};
    for (var vi = 0; vi < variants.length; vi++) {
      var v = variants[vi];
      metrics[v.key] = Metrics.evaluate(v.tokens, gold, text, sentences);
      metrics[v.key].label = v.label;
    }

    // ---- 6. 词频与停用词 ----
    stage('词频统计');
    var stopwords = opt.pre && opt.pre.stopwords ? opt.pre.stopwords : Object.create(null);
    var freqInfo = toFrequencies(segJiebaTuned, {
      stopwords: stopwords,
      minLen: (opt.pre && opt.pre.minLen !== undefined) ? opt.pre.minLen : 2,
      maxLen: (opt.pre && opt.pre.maxLen !== undefined) ? opt.pre.maxLen : 12,
      dict: tunedDict,
      useTagFilter: !!(opt.pre && opt.pre.useTagFilter)
    });

    // ---- 7. 错误分析 ----
    stage('错误分析');
    var errors = {
      jieba_default: Metrics.analyzeErrors(segJiebaDefault, gold, text, base, stopwords),
      jieba_tuned: Metrics.analyzeErrors(segJiebaTuned, gold, text, tunedDict, stopwords),
      self_default: Metrics.analyzeErrors(segSelfDefault, gold, text, selfDictDefault, stopwords),
      self_tuned: Metrics.analyzeErrors(segSelfTuned, gold, text, selfDictTuned, stopwords)
    };

    // ---- 8. 调优前后差异定位 ----
    var diffs = diffTokens(segJiebaDefault, segJiebaTuned, text);
    var diffsSelf = diffTokens(segSelfDefault, segSelfTuned, text);

    return {
      text: text,
      rawStats: pre.stats,
      sentences: sentences.length,
      sentenceList: sentences,
      variants: variants,
      metrics: metrics,
      gold: gold,
      goldSource: goldSource,
      frequencies: freqInfo,
      errors: errors,
      diffs: diffs,
      diffsSelf: diffsSelf,
      userLoadInfo: userLoadInfo,
      tuneInfo: tuneInfo,
      extendInfo: extendInfo,
      dictStats: tunedDict.stats(),
      options: opt
    };
  };

  /** 找出两次切分结果不一致的片段（用于"调优前后对比"） */
  function diffTokens(a, b, text) {
    // 以字符位置为单位比较"词边界"集合
    var aMap = Object.create(null), bMap = Object.create(null);
    var i;
    for (i = 0; i < a.length; i++) { aMap[a[i].end] = a[i]; }
    for (i = 0; i < b.length; i++) { bMap[b[i].end] = b[i]; }

    // 收集所有边界，聚合成连续区间
    var points = Object.create(null);
    for (i = 0; i < a.length; i++) { points[a[i].start] = 1; points[a[i].end] = 1; }
    for (i = 0; i < b.length; i++) { points[b[i].start] = 1; points[b[i].end] = 1; }
    var keys = Object.keys(points).map(Number).sort(function (x, y) { return x - y; });

    var out = [];
    for (i = 0; i < keys.length - 1; i++) {
      var s = keys[i], e = keys[i + 1];
      if (e <= s) { continue; }
      // 判断该区间在两边是否都是"独立的词"
      var aTok = aMap[e] && aMap[e].start === s ? aMap[e] : null;
      var bTok = bMap[e] && bMap[e].start === s ? bMap[e] : null;
      var aIsWord = !!aTok, bIsWord = !!bTok;
      if (aIsWord === bIsWord) { continue; }
      out.push({
        start: s, end: e,
        text: text.slice(s, e),
        before: aIsWord ? aTok.word : null,
        after: bIsWord ? bTok.word : null
      });
    }
    // 合并相邻、仅在一侧成词的片段，形成可读的对比条目
    var merged = [];
    for (i = 0; i < out.length; i++) {
      var cur = out[i];
      if (merged.length) {
        var prev = merged[merged.length - 1];
        if (prev.end === cur.start && (prev.side === (cur.before ? 'before' : 'after'))) {
          prev.end = cur.end;
          prev.text += cur.text;
          if (prev.before) { prev.before += '/' + (cur.before || '·'); }
          if (prev.after) { prev.after += '/' + (cur.after || '·'); }
          continue;
        }
      }
      cur.side = cur.before ? 'before' : 'after';
      if (!cur.before) { cur.before = '（未成词）'; }
      if (!cur.after) { cur.after = '（未成词）'; }
      merged.push(cur);
    }
    return merged;
  }

  global.Pipeline = Pipeline;
  global.PipelineUtil = {
    preprocess: preprocess,
    parseStopwords: parseStopwords,
    toFrequencies: toFrequencies,
    TAG_NAMES: TAG_NAMES,
    STOP_TAGS: STOP_TAGS,
    diffTokens: diffTokens
  };
})(window);
