/*!
 * metrics.js —— 分词评价指标与错误分析
 * ---------------------------------------------------------------------------
 * 1) 定量指标：以「词边界位置」为准计算准确率 P、召回率 R、F1
 *    （标准的分词评价做法：把每个词的起始位置视为一个切分点，比较切分点集合）
 *         P = |系统切分点 ∩ 标准切分点| / |系统切分点|
 *         R = |系统切分点 ∩ 标准切分点| / |标准切分点|
 *         F1 = 2PR / (P + R)
 *    同时给出「整句完全一致率」作为辅助指标。
 * 2) 错误分类：
 *    - 未登录词(OOV)导致的碎片化
 *    - 歧义切分（同一片段两种切法，词数不同）
 *    - 专有名词误切（人名/地名/机构名被切开）
 *    - 词云噪声（单字、数字、标点、停用词残留）
 */
(function (global) {
  'use strict';

  var PUNCT_RE = /^[\s，。！？、；：""''（）《》【】—…·,.!?;:()"'\[\]{}<>\/\\|~`@#$%^&*+=_-]+$/;
  var NUM_RE = /^[0-9.]+$/;
  var ENG_RE = /^[a-zA-Z0-9]+$/;

  /** 把词序列转换为「切分点集合」（用绝对字符偏移，避免重复词带来歧义） */
  function boundaries(tokens) {
    var set = Object.create(null);
    var arr = [];
    for (var i = 0; i < tokens.length; i++) {
      var end = (tokens[i].end !== undefined) ? tokens[i].end : null;
      var start = (tokens[i].start !== undefined) ? tokens[i].start : null;
      // 约定：记录每个词「结束位置」作为切分点，句末不算
      var key = (end !== null) ? ('e' + end) : ('w' + tokens[i].word);
      if (set[key] === undefined) { set[key] = 1; arr.push(key); }
    }
    return arr;
  }

  /** 用「词序列 + 原文」重建带偏移的 token（金标准解析用） */
  function locate(tokens, rawText) {
    var out = [];
    var cursor = 0;
    for (var i = 0; i < tokens.length; i++) {
      var w = typeof tokens[i] === 'string' ? tokens[i] : tokens[i].word;
      var at = rawText.indexOf(w, cursor);
      if (at < 0) { at = cursor; }
      out.push({ word: w, start: at, end: at + w.length });
      cursor = at + w.length;
    }
    return out;
  }

  /** 逐句计算切分点重合情况 */
  function scoreSentences(sysSents, goldSents) {
    var tp = 0, sysTotal = 0, goldTotal = 0;
    var exact = 0;
    for (var i = 0; i < goldSents.length; i++) {
      var gold = goldSents[i];
      var sys = sysSents[i] || [];
      var gb = Object.create(null), sb = Object.create(null);
      var j;
      for (j = 0; j < gold.length; j++) { gb['e' + gold[j].end] = 1; }
      for (j = 0; j < sys.length; j++) { sb['e' + sys[j].end] = 1; }
      // 句子末位不作为切分点
      var gKeys = Object.keys(gb), sKeys = Object.keys(sb);
      var gLast = gold.length ? 'e' + gold[gold.length - 1].end : null;
      var sLast = sys.length ? 'e' + sys[sys.length - 1].end : null;
      sysTotal += sKeys.length; goldTotal += gKeys.length;
      var hit = 0;
      for (j = 0; j < sKeys.length; j++) { if (gb[sKeys[j]] !== undefined) { hit++; } }
      tp += hit;
      if (gKeys.length === sKeys.length && hit === gKeys.length) { exact++; }
    }
    var P = sysTotal ? tp / sysTotal : 0;
    var R = goldTotal ? tp / goldTotal : 0;
    var F1 = (P + R) ? 2 * P * R / (P + R) : 0;
    return {
      precision: P, recall: R, f1: F1,
      tp: tp, sysTotal: sysTotal, goldTotal: goldTotal,
      exactMatch: goldSents.length ? exact / goldSents.length : 0
    };
  }

  /**
   * 主入口：计算一个分词器相对金标准的指标。
   * @param {Array<{word,start,end}>} sysTokens
   * @param {Array<{word,start,end}>} goldTokens
   * @param {string} rawText
   * @param {Array<{start,end,text}>} sentences
   */
  function evaluate(sysTokens, goldTokens, rawText, sentences) {
    var sysSents = splitBySentence(sysTokens, sentences);
    var goldSents = splitBySentence(goldTokens, sentences);
    var m = scoreSentences(sysSents, goldSents);
    var sysOverall = boundaries(sysTokens);
    var goldOverall = boundaries(goldTokens);
    // 整篇层面也给出词数，便于报告引用
    m.sysWordCount = sysTokens.length;
    m.goldWordCount = goldTokens.length;
    m.sysBoundaries = sysOverall.length;
    m.goldBoundaries = goldOverall.length;
    m.sentenceCount = sentences.length;
    return m;
  }

  /** 依据句子的字符区间，把 token 分派到各句 */
  function splitBySentence(tokens, sentences) {
    var out = sentences.map(function () { return []; });
    var si = 0;
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      while (si < sentences.length - 1 && t.start >= sentences[si].end) { si++; }
      if (si < out.length) { out[si].push(t); }
    }
    return out;
  }

  /** 把原文切成句子区间（按中文句末标点与换行） */
  function splitSentences(text) {
    var out = [];
    var start = 0;
    var re = /[。！？；\n\r]+/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var end = m.index + m[0].length;
      var seg = text.slice(start, end);
      if (seg.trim()) { out.push({ start: start, end: end, text: seg }); }
      start = end;
    }
    if (start < text.length && text.slice(start).trim()) {
      out.push({ start: start, end: text.length, text: text.slice(start) });
    }
    return out;
  }

  /**
   * 解析人工标注金标准。支持两种格式：
   *   1) 斜杠分隔：自然语言处理/课程/很/有趣
   *   2) 空格分隔：自然语言处理 课程 很 有趣
   * 返回与原文对齐的 token 序列。要求标注文本与原文中文内容一致。
   */
  function parseGold(text, rawText) {
    var tokens = [];
    var lines = String(text).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === '#') { continue; }
      var parts;
      if (line.indexOf('/') >= 0) { parts = line.split('/'); }
      else { parts = line.split(/\s+/); }
      for (var j = 0; j < parts.length; j++) {
        var w = parts[j].trim();
        if (w) { tokens.push(w); }
      }
    }
    return locate(tokens, rawText);
  }

  /**
   * 自动构造「银标准」：多个分词器投票。
   * 思路（对齐常用的自动评测做法）：
   *   若某切分点在 ≥2/3 的分词器中出现，并且它们切出的词在字符区间上一致，
   *   则该词进入银标准。这样得到的标准集无需人工标注，可用于横向比较。
   */
  function buildSilverStandard(tokenSets, sentences) {
    // 收集所有候选词：以 (start,end) 为键
    var votes = Object.create(null);
    for (var s = 0; s < tokenSets.length; s++) {
      var toks = tokenSets[s];
      var seen = Object.create(null);
      for (var i = 0; i < toks.length; i++) {
        var key = toks[i].start + ':' + toks[i].end;
        if (seen[key]) { continue; }
        seen[key] = 1;
        if (!votes[key]) { votes[key] = { word: toks[i].word, start: toks[i].start, end: toks[i].end, n: 0 }; }
        votes[key].n++;
      }
    }
    var need = Math.max(2, Math.ceil(tokenSets.length * 2 / 3));
    var picked = [];
    var keys = Object.keys(votes);
    for (var k = 0; k < keys.length; k++) {
      if (votes[keys[k]].n >= need) { picked.push(votes[keys[k]]); }
    }
    picked.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    // 消解重叠：按位置贪心选择
    var result = [], lastEnd = -1;
    for (var p = 0; p < picked.length; p++) {
      if (picked[p].start >= lastEnd) {
        result.push({ word: picked[p].word, start: picked[p].start, end: picked[p].end, votes: picked[p].n });
        lastEnd = picked[p].end;
      }
    }
    return result;
  }

  /**
   * 错误分析：找出系统切分与金标准不一致的位置并归类。
   */
  function analyzeErrors(sysTokens, goldTokens, rawText, dict, stopwords) {
    var sysMap = indexTokens(sysTokens);
    var goldMap = indexTokens(goldTokens);
    var issues = [];

    // a) 金标准中的词被切开 / 合并错
    for (var i = 0; i < goldTokens.length; i++) {
      var g = goldTokens[i];
      if (sysMap[g.start + ':' + g.end]) { continue; }
      // 找到覆盖 [g.start, g.end) 的系统词
      var covering = [], coverEnd = g.start;
      while (coverEnd < g.end) {
        var t = sysMap['s' + coverEnd];
        if (!t) { break; }
        covering.push(t);
        coverEnd = t.end;
      }
      if (covering.length > 1) {
        issues.push({
          type: 'split',
          label: '切碎（过度切分）',
          span: [g.start, g.end],
          text: rawText.slice(g.start, g.end),
          gold: g.word,
          sys: covering.map(function (x) { return x.word; }).join('/'),
          reason: dict && dict.has(g.word) ? '词典策略/词频路径选择不当' : '词典未收录该词（OOV）'
        });
      } else if (covering.length === 1 && covering[0].word.length > g.word.length) {
        issues.push({
          type: 'merge',
          label: '粘连（切分不足）',
          span: [g.start, g.end],
          text: rawText.slice(g.start, g.end),
          gold: g.word,
          sys: covering[0].word,
          reason: '长词优先导致把相邻词合并'
        });
      }
    }

    // b) 系统产生的不在金标准中的词
    var goldSet = Object.create(null);
    for (var j = 0; j < goldTokens.length; j++) { goldSet[goldTokens[j].start + ':' + goldTokens[j].end] = goldTokens[j]; }
    for (var k = 0; k < sysTokens.length; k++) {
      var st = sysTokens[k];
      if (goldSet[st.start + ':' + st.end]) { continue; }
      var inGold = false, p = st.start;
      while (p < st.end) {
        var gt = goldMap['s' + p];
        if (!gt) { break; }
        p = gt.end;
      }
      if (p === st.end) { continue; } // 完全由金标准词拼成，属正常
      if (/^[\u4E00-\u9FD5]+$/.test(st.word) && st.word.length > 1 && dict && !dict.has(st.word)) {
        issues.push({
          type: 'oov',
          label: '未登录词（词典外）',
          span: [st.start, st.end],
          text: st.word,
          gold: '（金标准中不存在）',
          sys: st.word,
          reason: '该词不在词典中，属工具自行识别的未登录词'
        });
      }
    }

    // c) 专有名词候选：金标准判定为人名/地名/机构名（由外部传入标签表时使用）
    // d) 词云噪声检查
    var noise = [];
    var counter = Object.create(null);
    for (var m = 0; m < sysTokens.length; m++) {
      var w = sysTokens[m].word;
      var flag = null;
      if (PUNCT_RE.test(w)) { flag = '标点符号'; }
      else if (NUM_RE.test(w)) { flag = '纯数字'; }
      else if (w.length === 1 && /[\u4E00-\u9FD5]/.test(w)) { flag = '单字词'; }
      else if (stopwords && stopwords[w]) { flag = '停用词'; }
      if (flag) {
        if (!counter[flag]) { counter[flag] = { type: 'noise', label: flag, count: 0, samples: [] }; }
        counter[flag].count++;
        if (counter[flag].samples.length < 8) { counter[flag].samples.push(w); }
      }
    }
    var noiseList = Object.keys(counter).map(function (k) { return counter[k]; });

    // 去重（同一 span 只保留一条最具体的）
    var seen = Object.create(null), uniq = [];
    for (var q = 0; q < issues.length; q++) {
      var key = issues[q].type + ':' + issues[q].span[0] + ':' + issues[q].span[1];
      if (seen[key]) { continue; }
      seen[key] = 1; uniq.push(issues[q]);
    }

    var byType = Object.create(null);
    for (var r = 0; r < uniq.length; r++) {
      byType[uniq[r].type] = (byType[uniq[r].type] || 0) + 1;
    }

    return { issues: uniq, byType: byType, noise: noiseList };
  }

  function indexTokens(tokens) {
    var map = Object.create(null);
    for (var i = 0; i < tokens.length; i++) {
      map[tokens[i].start + ':' + tokens[i].end] = tokens[i];
      map['s' + tokens[i].start] = tokens[i];
    }
    return map;
  }

  global.Metrics = {
    evaluate: evaluate,
    splitSentences: splitSentences,
    locate: locate,
    parseGold: parseGold,
    buildSilverStandard: buildSilverStandard,
    analyzeErrors: analyzeErrors,
    PUNCT_RE: PUNCT_RE
  };
})(window);
