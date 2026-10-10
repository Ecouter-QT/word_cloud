/*!
 * app.js —— 界面控制器
 * ---------------------------------------------------------------------------
 * 负责：加载词典/停用词 → 绑定交互 → 调用 Pipeline → 渲染词云与各标签页。
 */
(function () {
  'use strict';

  var state = {
    dict: null, jieba: null, hmm: null, pipeline: null,
    stopwords: null, stopwordText: '',
    files: [], sampleText: '',
    result: null, cloud: null, lastCloudOpts: null
  };

  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // ==================================================================== 启动
  function boot() {
    var bar = $('bootBar'), status = $('bootStatus');
    step(bar, status, 8, '正在解析词典数据…');

    setTimeout(function () {
      try {
        var t0 = Date.now();
        state.dict = new Dict(window.__JIEBA_DICT__);
        step(bar, status, 55, '正在构建前缀词典（349,046 词）…');
        setTimeout(function () {
          try {
            state.hmm = new HMM(window.__JIEBA_HMM__);
            state.jieba = new Jieba(state.dict, window.__JIEBA_HMM__);
            step(bar, status, 82, '正在加载停用词表…');
            loadStopwords(function () {
              step(bar, status, 94, '正在绑定界面…');
              initPalettes();
              state.pipeline = new Pipeline({
                dict: state.dict, hmm: state.hmm, jieba: state.jieba
              });
              var stats = state.dict.stats();
              $('chipDict').textContent = '词典就绪 · ' + stats.entries.toLocaleString() + ' 词 · ' +
                (Date.now() - t0) + ' ms';
              bindEvents();
              step(bar, status, 100, '就绪');
              setTimeout(function () {
                $('boot').classList.add('done');
              }, 320);
            });
          } catch (e) { fail(status, e); }
        }, 40);
      } catch (e) { fail(status, e); }
    }, 30);
  }

  function step(bar, status, pct, text) {
    if (bar) { bar.style.width = pct + '%'; }
    if (status && text) { status.textContent = text; }
  }

  function fail(status, e) {
    status.innerHTML = '<span style="color:#f87171">初始化失败：' + (e && e.message ? e.message : e) + '</span>';
    console.error(e);
  }

  /**
   * 加载停用词表。
   * 优先顺序：
   *   1) data/stopwords.js 内联的完整停用词表（file:// 双击打开也能用，无需网络）
   *   2) fetch('data/stopwords.txt')（http 环境下便于替换）
   *   3) 极简内置表（兜底）
   */
  function loadStopwords(cb) {
    if (typeof window.__STOPWORDS__ === 'string' && window.__STOPWORDS__.length > 100) {
      state.stopwordText = window.__STOPWORDS__;
      state.stopwords = PipelineUtil.parseStopwords(state.stopwordText);
      updateStopStat();
      cb();
      return;
    }
    fetch('data/stopwords.txt').then(function (r) {
      if (!r.ok) { throw new Error('HTTP ' + r.status); }
      return r.text();
    }).then(function (txt) {
      state.stopwordText = txt;
      state.stopwords = PipelineUtil.parseStopwords(txt);
      updateStopStat();
      cb();
    }).catch(function () {
      state.stopwordText = BUILTIN_STOPWORDS;
      state.stopwords = PipelineUtil.parseStopwords(BUILTIN_STOPWORDS);
      updateStopStat();
      cb();
    });
  }

  var BUILTIN_STOPWORDS = ['的', '了', '是', '在', '和', '就', '都', '而', '及', '与', '着', '或',
    '一个', '没有', '我们', '你们', '他们', '这个', '那个', '这样', '那样', '因为', '所以',
    '但是', '如果', '虽然', '可以', '已经', '自己', '什么', '怎么', '时候', '现在', '知道',
    '出来', '起来', '一下', '一样', '一直', '一些', '这些', '那些', '只是', '还是', '或者',
    '然后', '于是', '由于', '对于', '关于', '通过', '根据', '按照', '随着', '以及', '并且',
    '而且', '然而', '不过', '就是', '不是', '不能', '不会', '可能', '应该', '需要', '进行',
    '成为', '作为', '认为', '表示', '指出', '显示', '发现', '提供', '包括', '具有', '存在',
    '出现', '开始', '结束', '这个', '这种', '这里', '那里', '这么', '那么', '为了', '只要',
    '只有', '无论', '不管', '虽然', '即使', '既然', '否则', '并且', '不但', '不仅', '而是',
    '也是', '还是', '一直', '一定', '一般', '一样', '一点', '一次', '非常', '十分', '特别',
    '比较', '更加', '最为', '十分', '相当', '稍微', '几乎', '大概', '也许', '或许', '应该',
    '必须', '能够', '愿意', '希望', '觉得', '感到', '看到', '听到', '想到', '说道', '问道'];

  function updateStopStat() {
    var n = state.stopwords ? state.stopwords.__size : 0;
    window.__stopwordCount = n;
    $('stopStat').textContent = '（' + n + ' 词）';
    if (!$('stopwords').value && state.stopwordText) {
      $('stopwords').value = state.stopwordText;
    }
  }

  function initPalettes() {
    var sel = $('optPalette');
    sel.innerHTML = '';
    Object.keys(WordCloud.PALETTES).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k;
      o.textContent = WordCloud.PALETTE_LABELS[k] || k;
      sel.appendChild(o);
    });
    sel.value = 'viridis';
  }

  // ================================================================ 事件绑定
  function bindEvents() {
    // ---- 文件上传 ----
    var drop = $('drop'), input = $('fileInput');
    drop.addEventListener('click', function () { input.click(); });
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      handleFiles(e.dataTransfer.files);
    });
    input.addEventListener('change', function () {
      handleFiles(input.files);
      input.value = '';
    });

    // ---- 停用词文件 ----
    $('stopFile').addEventListener('change', function () {
      var f = this.files[0];
      if (!f) { return; }
      readFile(f).then(function (txt) {
        state.stopwordText = txt;
        state.stopwords = PipelineUtil.parseStopwords(txt);
        $('stopwords').value = txt;
        updateStopStat();
        showLoading('正在重新分析…');
        setTimeout(run, 30);
      });
      this.value = '';
    });

    $('rawText').addEventListener('input', updateTextStat);

    $('btnSample').addEventListener('click', function () {
      if (state.sampleText) {
        $('rawText').value = state.sampleText;
        updateTextStat();
        run();
        return;
      }
      // 内联示例语料优先（file:// 直接打开时同样可用）
      if (typeof window.__SAMPLE_CORPUS__ === 'string' && window.__SAMPLE_CORPUS__.length > 200) {
        state.sampleText = window.__SAMPLE_CORPUS__;
        $('rawText').value = state.sampleText;
        updateTextStat();
        run();
        return;
      }
      fetch('data/sample.txt').then(function (r) { return r.text(); }).then(function (t) {
        state.sampleText = t;
        $('rawText').value = t;
        updateTextStat();
        run();
      }).catch(function () {
        alert('未找到示例语料，请直接粘贴文章内容，或上传 .txt 文件。');
      });
    });

    $('btnClear').addEventListener('click', function () {
      $('rawText').value = '';
      state.files = [];
      renderFileList();
      updateTextStat();
    });

    $('btnRun').addEventListener('click', function () { run(); });
    $('btnRunCloud').addEventListener('click', function () { drawCloud(); });
    $('btnDownloadPng').addEventListener('click', downloadPng);
    $('btnReport').addEventListener('click', downloadReport);

    // ---- 标签页 ----
    $$('#tabs .tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        $$('#tabs .tab').forEach(function (t) { t.classList.remove('active'); });
        $$('.pane').forEach(function (p) { p.classList.remove('active'); });
        tab.classList.add('active');
        var pane = document.querySelector('.pane[data-pane="' + tab.dataset.tab + '"]');
        if (pane) { pane.classList.add('active'); }
      });
    });

    // ---- 词云形状联动 ----
    $('optShape').addEventListener('change', function () {
      $('optShapeText').disabled = this.value !== 'text';
    });
    $('optShapeText').disabled = true;

    // ---- 词云悬停提示 ----
    var canvas = $('cloud'), tip = $('cloudTip');
    canvas.addEventListener('mousemove', function (e) {
      if (!state.cloud) { return; }
      var rect = canvas.getBoundingClientRect();
      var x = (e.clientX - rect.left) * (state.cloud.width / rect.width);
      var y = (e.clientY - rect.top) * (state.cloud.height / rect.height);
      var hit = null;
      for (var i = state.cloud.placed.length - 1; i >= 0; i--) {
        var p = state.cloud.placed[i];
        if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) { hit = p; break; }
      }
      if (hit) {
        var total = state.result ? state.result.frequencies.total : 1;
        tip.innerHTML = '<strong>' + esc(hit.word) + '</strong> · 出现 ' + hit.count + ' 次 · 占比 ' +
          (hit.count / Math.max(total, 1) * 100).toFixed(2) + '%' +
          (hit.tag ? ' · ' + esc(hit.tagName || hit.tag) : '');
        tip.style.left = Math.min(e.clientX - rect.left + 14, rect.width - 200) + 'px';
        tip.style.top = (e.clientY - rect.top + 14) + 'px';
        tip.classList.add('show');
      } else {
        tip.classList.remove('show');
      }
    });
    canvas.addEventListener('mouseleave', function () { tip.classList.remove('show'); });
  }

  function handleFiles(files) {
    if (!files || !files.length) { return; }
    var list = Array.prototype.slice.call(files);
    var pending = list.length;
    list.forEach(function (f) {
      readFile(f).then(function (txt) {
        state.files.push({ name: f.name, size: f.size, text: txt, encoding: state.lastEncoding });
        if (--pending === 0) { afterFiles(); }
      }).catch(function (err) {
        alert('读取文件「' + f.name + '」失败：' + (err.message || err));
        if (--pending === 0) { afterFiles(); }
      });
    });
  }

  function afterFiles() {
    // 把已上传文件内容填入文本框，便于用户查看与二次编辑
    var text = state.files.map(function (f) { return f.text; }).join('\n\n');
    if (text.trim()) { $('rawText').value = text; }
    renderFileList();
    updateTextStat();
  }

  function renderFileList() {
    var ul = $('fileList');
    ul.innerHTML = '';
    state.files.forEach(function (f, i) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="fname">' + esc(f.name) + '</span>' +
        '<span class="fsize">' + (f.size / 1024).toFixed(1) + ' KB · ' +
        (f.text.match(/[\u4E00-\u9FD5]/g) || []).length + ' 汉字' +
        (f.encoding ? ' · ' + esc(f.encoding) : '') + '</span>' +
        '<button class="rm" data-i="' + i + '">×</button>';
      ul.appendChild(li);
    });
    $$('#fileList .rm').forEach(function (b) {
      b.addEventListener('click', function () {
        state.files.splice(parseInt(this.dataset.i, 10), 1);
        afterFiles();
      });
    });
  }

  /**
   * 自动判定文本编码并解码。
   * 中文语料常是 GBK/GB18030（Windows 记事本"ANSI"），直接按 UTF-8 读会乱码，
   * 因此先按 UTF-8 解码，看是否出现替换字符 U+FFFD，失败再回退 GBK。
   */
  function decodeBuffer(buf) {
    var bytes = new Uint8Array(buf);
    var utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (utf8.indexOf('\uFFFD') < 0) {
      return { text: utf8, encoding: 'UTF-8' };
    }
    try {
      var gbk = new TextDecoder('gbk', { fatal: false }).decode(bytes);
      var u8bad = (utf8.match(/\uFFFD/g) || []).length;
      var gbkbad = (gbk.match(/\uFFFD/g) || []).length;
      if (gbkbad === 0 || gbkbad < u8bad) {
        return { text: gbk, encoding: gbkbad ? 'GBK/GB18030（含无法解码字符）' : 'GBK/GB18030' };
      }
      return { text: utf8, encoding: 'UTF-8（含无法解码字符）' };
    } catch (e) {
      return { text: utf8, encoding: 'UTF-8（含无法解码字符）' };
    }
  }

  /** 读取文件：纯文本自动识别编码；docx 尝试后端接口（若存在） */
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var name = file.name.toLowerCase();
      if (/\.docx$/.test(name)) {
        // 浏览器无法直接解析 docx，尝试后端转换接口，失败则给出提示
        var fd = new FormData();
        fd.append('file', file);
        fetch('api/extract', { method: 'POST', body: fd })
          .then(function (r) { if (!r.ok) { throw new Error('no backend'); } return r.json(); })
          .then(function (j) { resolve(j.text); })
          .catch(function () {
            reject(new Error('纯前端无法解析 .docx。请把 Word 内容复制粘贴到文本框，' +
              '或另存为 .txt 后再上传。'));
          });
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var buf = reader.result;
        if (buf instanceof ArrayBuffer) {
          var dec = decodeBuffer(buf);
          // 记录识别出的编码，显示在文件列表里便于排查乱码
          state.lastEncoding = dec.encoding;
          resolve(dec.text);
        } else {
          resolve(String(buf || ''));
        }
      };
      reader.onerror = function () { reject(reader.error); };
      try {
        reader.readAsArrayBuffer(file);
      } catch (e) { reject(e); }
    });
  }

  function updateTextStat() {
    var t = $('rawText').value || '';
    var cjk = (t.match(/[\u4E00-\u9FD5]/g) || []).length;
    $('textStat').textContent = '共 ' + t.length + ' 字符，其中 ' + cjk + ' 个汉字' +
      (cjk < 1000 ? '（建议不少于 1000 字）' : '');
  }

  // ==================================================================== 运行
  function collectOptions() {
    var stopText = $('stopwords').value || state.stopwordText;
    var stopSet = PipelineUtil.parseStopwords(stopText);
    return {
      pre: {
        removeHtml: $('optRemoveHtml').checked,
        keepPunct: $('optKeepPunct').checked,
        minLen: parseInt($('optMinLen').value, 10) || 2,
        maxLen: parseInt($('optMaxLen').value, 10) || 12,
        stopwords: stopSet,
        useTagFilter: $('optTagFilter').checked
      },
      jieba: {
        mode: $('optJiebaMode').value,
        hmm: $('optJiebaHmm').value === '1',
        userDict: $('userDict').value,
        addWords: $('addWords').value,
        suggestFreq: $('suggestFreq').value
      },
      self: {
        strategy: $('optSelfStrategy').value,
        maxLen: parseInt($('optSelfMaxLen').value, 10) || 6,
        maxLenTuned: parseInt($('optSelfMaxLenTuned').value, 10) || 9,
        hmmFallback: $('optSelfHmm').value === '1',
        extendFromJieba: $('optSelfExtend').checked
      },
      goldText: $('goldText').value,
      cloud: {
        shape: $('optShape').value,
        shapeText: $('optShapeText').value || '词',
        palette: $('optPalette').value,
        mapping: $('optMapping').value,
        maxWords: parseInt($('optMaxWords').value, 10) || 150,
        minSize: parseInt($('optMinSize').value, 10) || 12,
        maxSize: parseInt($('optMaxSize').value, 10) || 110,
        fontFamily: $('optFont').value,
        weight: $('optWeight').value,
        width: parseInt($('optWidth').value, 10) || 900,
        height: parseInt($('optHeight').value, 10) || 620,
        rotateRatio: parseFloat($('optRotate').value) || 0,
        bg: $('optBg').value
      }
    };
  }

  function run() {
    var raw = $('rawText').value || '';
    if ((raw.match(/[\u4E00-\u9FD5]/g) || []).length < 20) {
      alert('请先上传或粘贴文章内容（汉字数太少，无法分析）。');
      return;
    }
    showLoading('正在预处理与分词…');
    setTimeout(function () {
      try {
        var t0 = Date.now();
        var opts = collectOptions();
        var res = state.pipeline.run({ rawText: raw }, opts, function (stage) {
          setLoadingText('正在' + stage + '…');
        });
        state.result = res;
        setLoadingText('正在布局词云…');
        setTimeout(function () {
          renderAll(res);
          hideLoading();
          state.lastRunMs = Date.now() - t0;
          console.log('分析耗时 ' + (Date.now() - t0) + ' ms');
        }, 30);
      } catch (e) {
        hideLoading();
        console.error(e);
        alert('分析失败：' + (e.message || e));
      }
    }, 30);
  }

  function renderAll(res) {
    renderCloud(res);
    renderFreq(res);
    renderCompare(res);
    renderMetrics(res);
    renderTune(res);
    renderReport(res);
    $('btnReport').disabled = false;
    $('btnDownloadPng').disabled = false;
    // 暴露给自动化测试 / 控制台调试
    window.__lastMetrics = res.metrics;
    window.__lastFreq = res.frequencies.list;
    window.__lastResult = res;
  }

  // ------------------------------------------------------------- 词云渲染
  function renderCloud(res) {
    var opts = collectOptions().cloud;
    opts.canvas = $('cloud');
    opts.words = res.frequencies.list;
    $('cloudEmpty').style.display = 'none';
    state.lastCloudOpts = opts;
    var t0 = Date.now();
    var cloud = WordCloud.render(opts, function (p) {
      setLoadingText('正在布局词云 ' + p.done + '/' + p.total + '…');
    });
    state.cloud = cloud;
    window.__cloudPlaced = cloud.placed;
    $('cloudMeta').textContent = '已放置 ' + cloud.placed.length + ' 词' +
      (cloud.dropped.length ? '，舍去 ' + cloud.dropped.length + ' 词' : '') +
      ' · 画布 ' + cloud.width + '×' + cloud.height +
      ' · 布局耗时 ' + (Date.now() - t0) + ' ms';
    renderLegend(cloud, opts.palette);
  }

  function drawCloud() {
    if (!state.result) { alert('请先执行一次分析。'); return; }
    renderCloud(state.result);
  }

  function renderLegend(cloud, paletteName) {
    var pal = WordCloud.PALETTES[paletteName] || WordCloud.PALETTES.viridis;
    var stops = [];
    for (var i = 0; i <= 10; i++) {
      stops.push(WordCloud.samplePalette(pal, i / 10) + ' ' + (i * 10) + '%');
    }
    var top = cloud.placed.slice(0, 12).map(function (p) {
      return '<span class="lg-word" style="font-size:' + Math.max(12, Math.min(20, p.size / 5)) +
        'px;color:' + p.color + '">' + esc(p.word) + '</span>';
    }).join('');
    $('cloudLegend').innerHTML =
      '<div class="legend-bar" style="background:linear-gradient(90deg,' + stops.join(',') + ')"></div>' +
      '<div class="legend-words">' + top + '</div>';
  }

  function downloadPng() {
    if (!state.cloud) { return; }
    var canvas = $('cloud');
    canvas.toBlob(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'wordcloud.png';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    }, 'image/png');
  }

  // ------------------------------------------------------------- 词频面板
  function renderFreq(res) {
    var list = res.frequencies.list;
    var total = res.frequencies.total;
    var sum = list.reduce(function (a, b) { return a + b.count; }, 0);
    $('freqMeta').textContent = '保留 ' + list.length + ' 个词，累计出现 ' + sum + ' 次（分词总词数 ' + total + '）';

    var top = list.slice(0, 30);
    var max = top.length ? top[0].count : 1;
    $('barList').innerHTML = top.map(function (w, i) {
      var pct = (w.count / max * 100).toFixed(1);
      return '<div class="bar-row"><span class="bar-rank">' + (i + 1) + '</span>' +
        '<span class="bar-word">' + esc(w.word) + '</span>' +
        '<span class="bar-track"><i style="width:' + pct + '%"></i></span>' +
        '<span class="bar-count">' + w.count + '</span></div>';
    }).join('');

    var rows = ['<thead><tr><th>#</th><th>词语</th><th>词频</th><th>占比</th><th>词性</th></tr></thead><tbody>'];
    list.slice(0, 300).forEach(function (w, i) {
      rows.push('<tr><td>' + (i + 1) + '</td><td>' + esc(w.word) + '</td><td>' + w.count +
        '</td><td>' + (w.count / sum * 100).toFixed(3) + '%</td><td>' +
        (w.tag ? esc(w.tag + (w.tagName ? '（' + w.tagName + '）' : '')) : '—') + '</td></tr>');
    });
    rows.push('</tbody>');
    $('freqTable').innerHTML = rows.join('');

    var d = res.frequencies.dropped;
    $('dropStats').innerHTML = [
      ['停用词过滤', d.stopword], ['长度不足', d.short], ['超长词丢弃', d.long],
      ['标点符号', d.punct], ['纯数字/符号', d.number], ['虚词词性过滤', d.tag]
    ].map(function (kv) {
      return '<div class="ds-item"><b>' + kv[1] + '</b><span>' + kv[0] + '</span></div>';
    }).join('');
  }

  // ------------------------------------------------------------- 对比面板
  function renderCompare(res) {
    var text = res.text;
    var map = {
      jieba_default: 'segJiebaDefault',
      jieba_tuned: 'segJiebaTuned',
      self_default: 'segSelfDefault',
      self_tuned: 'segSelfTuned'
    };
    // 以 jieba 调优后的边界为"参考"，标出不一致处
    var refBounds = Object.create(null);
    res.variants[1].tokens.forEach(function (t) { refBounds[t.start + ':' + t.end] = 1; });

    Object.keys(map).forEach(function (key) {
      var v = res.variants.filter(function (x) { return x.key === key; })[0];
      var html = v.tokens.slice(0, 700).map(function (t) {
        var same = refBounds[t.start + ':' + t.end];
        var cls = same ? 'tk same' : 'tk diff';
        return '<span class="' + cls + '" title="位置 ' + t.start + '-' + t.end + '">' +
          esc(t.word) + '</span>';
      }).join('');
      $(map[key]).innerHTML = html + (v.tokens.length > 700 ? '<span class="hint"> …（仅显示前 700 个词）</span>' : '');
    });

    $('cmpMeta').textContent = '共 ' + res.sentences + ' 句 · 标准来源：' + res.goldSource;

    renderDiffTable($('diffTable'), res.diffs, 'jieba');
    renderDiffTable($('diffTableSelf'), res.diffsSelf, '自建工具');
  }

  function renderDiffTable(el, diffs, who) {
    if (!diffs.length) {
      el.innerHTML = '<tbody><tr><td class="hint">调优前后切分结果完全一致。</td></tr></tbody>';
      return;
    }
    var rows = ['<thead><tr><th>片段（原文）</th><th>' + who + ' 调优前</th><th>' + who + ' 调优后</th><th>说明</th></tr></thead><tbody>'];
    diffs.slice(0, 200).forEach(function (d) {
      var solved = d.after !== '（未成词）' && d.before === '（未成词）';
      var note = solved ? '调优后新增该词（未登录词被正确识别）'
        : (d.before !== '（未成词）' && d.after === '（未成词）' ? '调优后不再单独成词（被合并或降频）'
          : '切分边界发生变化');
      rows.push('<tr><td class="hl">' + esc(d.text) + '</td><td class="before">' + esc(d.before) +
        '</td><td class="after">' + esc(d.after) + '</td><td class="hint">' + note + '</td></tr>');
    });
    rows.push('</tbody>');
    el.innerHTML = rows.join('');
  }

  // ------------------------------------------------------------- 指标面板
  function renderMetrics(res) {
    $('metricMeta').textContent = '标准来源：' + res.goldSource +
      ' · 标准词数 ' + res.gold.length;
    var order = ['jieba_default', 'jieba_tuned', 'self_default', 'self_tuned'];
    var rows = ['<thead><tr><th>分词工具</th><th>准确率 P</th><th>召回率 R</th><th>F1 值</th>' +
      '<th>输出词数</th><th>切分点</th><th>整句完全一致率</th></tr></thead><tbody>'];
    order.forEach(function (k) {
      var m = res.metrics[k];
      rows.push('<tr><td class="hl">' + esc(m.label) + '</td>' +
        '<td>' + pct(m.precision) + '</td><td>' + pct(m.recall) + '</td>' +
        '<td class="f1">' + pct(m.f1) + '</td>' +
        '<td>' + m.sysWordCount + '</td><td>' + m.sysBoundaries + '</td>' +
        '<td>' + pct(m.exactMatch) + '</td></tr>');
    });
    rows.push('</tbody>');
    $('metricTable').innerHTML = rows.join('');

    var jd = res.metrics.jieba_default, jt = res.metrics.jieba_tuned;
    var sd = res.metrics.self_default, st = res.metrics.self_tuned;
    $('metricCards').innerHTML = [
      card('jieba F1 提升', delta(jd.f1, jt.f1), '默认 ' + pct(jd.f1) + ' → 调优 ' + pct(jt.f1)),
      card('自建工具 F1 提升', delta(sd.f1, st.f1), '默认 ' + pct(sd.f1) + ' → 调优 ' + pct(st.f1)),
      card('调优后两者差距', delta(jt.f1, st.f1), 'jieba ' + pct(jt.f1) + ' / 自建 ' + pct(st.f1)),
      card('标准词数', res.gold.length + ' 词', res.goldSource)
    ].join('');

    // 错误类型分布
    var ekeys = ['jieba_default', 'jieba_tuned', 'self_default', 'self_tuned'];
    var types = { split: '切碎（过度切分）', merge: '粘连（切分不足）', oov: '未登录词' };
    var erows = ['<thead><tr><th>错误类型</th>' + ekeys.map(function (k) {
      return '<th>' + esc(res.metrics[k].label) + '</th>';
    }).join('') + '</tr></thead><tbody>'];
    Object.keys(types).forEach(function (t) {
      erows.push('<tr><td class="hl">' + types[t] + '</td>' + ekeys.map(function (k) {
        var c = res.errors[k].byType[t] || 0;
        return '<td>' + c + '</td>';
      }).join('') + '</tr>');
    });
    erows.push('<tr class="total"><td>合计</td>' + ekeys.map(function (k) {
      return '<td>' + res.errors[k].issues.length + '</td>';
    }).join('') + '</tr>');
    erows.push('</tbody>');
    $('errorTable').innerHTML = erows.join('');

    // 错误明细
    var issues = res.errors.jieba_tuned.issues.slice(0, 150);
    if (!issues.length) {
      $('errorDetail').innerHTML = '<tbody><tr><td class="hint">未检出错误。</td></tr></tbody>';
    } else {
      var drows = ['<thead><tr><th>类型</th><th>原文片段</th><th>标准切分</th><th>系统输出</th><th>原因分析</th></tr></thead><tbody>'];
      issues.forEach(function (it) {
        drows.push('<tr><td>' + esc(it.label) + '</td><td class="hl">' + esc(it.text) +
          '</td><td>' + esc(it.gold) + '</td><td>' + esc(it.sys) + '</td><td class="hint">' +
          esc(it.reason) + '</td></tr>');
      });
      drows.push('</tbody>');
      $('errorDetail').innerHTML = drows.join('');
    }

    // 噪声
    var noise = res.errors.jieba_tuned.noise;
    if (!noise.length) {
      $('noiseStats').innerHTML = '<p class="hint">分词结果中未发现明显噪声词。</p>';
    } else {
      $('noiseStats').innerHTML = noise.map(function (n) {
        return '<div class="ds-item"><b>' + n.count + '</b><span>' + esc(n.label) +
          '</span><em class="hint">' + esc(n.samples.join('、')) + '</em></div>';
      }).join('');
    }
  }

  function card(title, value, sub) {
    return '<div class="mcard"><div class="mcard-title">' + esc(title) + '</div>' +
      '<div class="mcard-value">' + value + '</div>' +
      '<div class="mcard-sub">' + esc(sub) + '</div></div>';
  }
  function pct(v) { return (v * 100).toFixed(2) + '%'; }
  function delta(a, b) {
    var d = (b - a) * 100;
    var s = (d >= 0 ? '+' : '') + d.toFixed(2) + ' pt';
    return '<span class="' + (d >= 0 ? 'up' : 'down') + '">' + s + '</span>';
  }

  // ------------------------------------------------------------- 调优记录
  function renderTune(res) {
    var html = [];
    html.push(logBlock('用户词典加载', res.userLoadInfo ?
      '共加载 ' + res.userLoadInfo.loaded + ' 条，其中新词 ' + res.userLoadInfo.newWords + ' 条' :
      '未启用（jieba 使用默认词典）'));
    if (res.tuneInfo.length) {
      html.push(logBlock('词频调整 suggest_freq', res.tuneInfo.map(function (t) {
        return t.word + '：' + (t.from === null || t.from === undefined ? '未收录' : t.from) +
          ' → ' + t.to + (t.tune ? '（调高）' : '（调低）');
      }).join('；')));
    } else {
      html.push(logBlock('词频调整 suggest_freq', '未启用'));
    }
    html.push(logBlock('自建词典扩充', res.extendInfo.added ?
      '从 jieba 结果新增 ' + res.extendInfo.added + ' 个词，例如：' +
      res.extendInfo.words.slice(0, 24).join('、') : '未启用'));
    html.push(logBlock('HMM 开关', res.options.jieba.hmm ? 'jieba 调优后：开启 HMM（识别未登录词）' :
      'jieba 调优后：关闭 HMM（HMM=False）'));
    html.push(logBlock('切分模式', {
      exact: '精确模式 lcut()', full: '全模式 cut_all=True', search: '搜索引擎模式 lcut_for_search()'
    }[res.options.jieba.mode] || res.options.jieba.mode));
    html.push(logBlock('自建工具策略', {
      fmm: '正向最大匹配 FMM', bmm: '逆向最大匹配 RMM', bidir: '双向最大匹配（含歧义消解规则）'
    }[res.options.self.strategy] + '，max_len：默认 ' + res.options.self.maxLen +
      ' → 调优 ' + res.options.self.maxLenTuned +
      (res.options.self.hmmFallback ? '，并对未登录词启用 HMM 回退' : '，不启用 HMM 回退')));
    $('tuneLog').innerHTML = html.join('');

    var ds = res.dictStats;
    $('dictState').innerHTML = [
      ['词典词条数', ds.entries.toLocaleString()],
      ['词典总词频', ds.total.toLocaleString()],
      ['加载的用户词', ds.userWords],
      ['调频词数', ds.tunedWords]
    ].map(function (kv) {
      return '<div class="ds-item"><b>' + kv[1] + '</b><span>' + kv[0] + '</span></div>';
    }).join('');
  }

  function logBlock(title, body) {
    return '<div class="log-block"><h4>' + esc(title) + '</h4><p>' + esc(body) + '</p></div>';
  }

  // ------------------------------------------------------------- 报告生成
  function renderReport(res) {
    $('reportBody').innerHTML = buildReportHTML(res);
  }

  function buildReportHTML(res) {
    var m = res.metrics;
    var order = ['jieba_default', 'jieba_tuned', 'self_default', 'self_tuned'];
    var stats = res.rawStats;
    var top = res.frequencies.list.slice(0, 15);
    var html = [];

    html.push('<h3>3.1 语料选取与预处理</h3>');
    html.push('<p>本次实验语料共 <b>' + res.sentences + '</b> 句，' +
      '原始文本 <b>' + stats.original + '</b> 字符，其中汉字 <b>' + stats.cjk +
      '</b> 个；预处理后剩余 <b>' + stats.cleaned + '</b> 字符（去除 HTML 标签、实体、URL、' +
      '零宽字符与多余空白共 ' + stats.removed + ' 字符）。预处理步骤：①去 HTML 标签与实体；' +
      '②去 URL 与零宽字符；③统一换行与空白；④' +
      (res.options.pre.keepPunct ? '保留中文标点便于分句' : '统一剔除标点') + '。</p>');

    html.push('<h3>3.2 jieba 分词与调优</h3>');
    html.push('<p>切分模式：<b>' + ({ exact: '精确模式 lcut()', full: '全模式 cut_all=True', search: '搜索引擎模式 lcut_for_search()' }[res.options.jieba.mode]) +
      '</b>；HMM 新词发现：<b>' + (res.options.jieba.hmm ? '开启' : '关闭（HMM=False）') + '</b>。</p>');
    html.push('<p>调优手段：' +
      (res.userLoadInfo ? '加载自定义词典（' + res.userLoadInfo.loaded + ' 条，新增 ' + res.userLoadInfo.newWords + ' 词）' : '未加载自定义词典') +
      '；' + (res.tuneInfo.length ? 'suggest_freq 调整 ' + res.tuneInfo.length + ' 个词的词频' : '未做词频调整') +
      '；' + (res.extendInfo.added ? '并用 jieba 结果反向为自建工具扩充 ' + res.extendInfo.added + ' 个词' : '未做词典反向扩充') + '。</p>');

    html.push('<h3>3.3 自建分词工具与调优</h3>');
    html.push('<p>自建工具采用 <b>' + ({ fmm: '正向最大匹配', bmm: '逆向最大匹配', bidir: '双向最大匹配' }[res.options.self.strategy]) +
      '</b>算法；最大词长 max_len 由默认 <b>' + res.options.self.maxLen + '</b> 调整为 <b>' +
      res.options.self.maxLenTuned + '</b>；' +
      (res.options.self.hmmFallback ? '并对未登录词加入 HMM 回退。' : '未启用未登录词回退。') + '</p>');

    html.push('<h3>3.4 分词结果对比分析</h3>');
    html.push('<p>（1）定量对比（标准来源：' + esc(res.goldSource) + '，标准词数 ' + res.gold.length + '）</p>');
    html.push('<table class="data-table"><thead><tr><th>分词工具</th><th>准确率 P</th><th>召回率 R</th>' +
      '<th>F1 值</th><th>输出词数</th><th>切分点</th><th>整句一致率</th></tr></thead><tbody>');
    order.forEach(function (k) {
      var x = m[k];
      html.push('<tr><td>' + esc(x.label) + '</td><td>' + pct(x.precision) + '</td><td>' + pct(x.recall) +
        '</td><td><b>' + pct(x.f1) + '</b></td><td>' + x.sysWordCount + '</td><td>' + x.sysBoundaries +
        '</td><td>' + pct(x.exactMatch) + '</td></tr>');
    });
    html.push('</tbody></table>');

    html.push('<p>（2）定性对比</p>');
    var jd = m.jieba_default, jt = m.jieba_tuned, sd = m.self_default, st = m.self_tuned;
    html.push('<ul>' +
      '<li><b>调优效果</b>：jieba 的 F1 从 ' + pct(jd.f1) + ' 变为 ' + pct(jt.f1) +
      '（' + ((jt.f1 - jd.f1) * 100 >= 0 ? '+' : '') + ((jt.f1 - jd.f1) * 100).toFixed(2) +
      ' pt）；自建工具从 ' + pct(sd.f1) + ' 变为 ' + pct(st.f1) +
      '（' + ((st.f1 - sd.f1) * 100 >= 0 ? '+' : '') + ((st.f1 - sd.f1) * 100).toFixed(2) + ' pt）。</li>' +
      '<li><b>错误类型</b>：切碎 ' + (res.errors.jieba_tuned.byType.split || 0) + ' 处、粘连 ' +
      (res.errors.jieba_tuned.byType.merge || 0) + ' 处、未登录词 ' +
      (res.errors.jieba_tuned.byType.oov || 0) + ' 处（以调优后 jieba 为例）。</li>' +
      '<li><b>工具差异</b>：调优后两者 F1 相差 ' +
      Math.abs((jt.f1 - st.f1) * 100).toFixed(2) + ' pt。</li>' +
      '</ul>');

    html.push('<h3>3.5 词云图制作</h3>');
    var c = res.options.cloud;
    html.push('<p>分词结果经停用词过滤（' + (state.stopwords ? state.stopwords.__size : 0) +
      ' 词停用表）与长度过滤后，保留 <b>' + res.frequencies.list.length +
      '</b> 个词；词云参数：形状 <b>' + c.shape + '</b>' +
      (c.shape === 'text' ? '（"' + esc(c.shapeText) + '"字）' : '') +
      '、配色 <b>' + c.palette + '</b>、词频映射 <b>' + c.mapping + '</b>、最多 <b>' + c.maxWords +
      '</b> 词、字号 ' + c.minSize + '–' + c.maxSize + 'px、字体 <b>' + c.fontFamily + '</b>。');
    html.push('图中' + top.slice(0, 6).map(function (w) { return '“' + esc(w.word) + '”'; }).join('、') +
      '等词最为突出，反映语料主题集中于相关领域的关键概念。</p>');
    html.push('<p>高频词（前 15）：' + top.map(function (w) {
      return esc(w.word) + '(' + w.count + ')';
    }).join('、') + '</p>');

    html.push('<h3>四、思考与总结</h3>');
    html.push('<p>1. <b>中文分词的难点</b>在于未登录词识别与歧义切分。jieba 借助前缀词典 + 动态规划最大概率路径，' +
      '并用 HMM 处理词典未覆盖片段，因此在专有名词与网络新词上表现较好；自建的最大匹配工具完全依赖词表覆盖，' +
      '词典缺词时容易把专有名词切碎。本次实验中自建工具默认配置检出切碎问题 ' +
      (res.errors.self_default.byType.split || 0) + ' 处，调优后降至 ' +
      (res.errors.self_tuned.byType.split || 0) + ' 处。</p>');
    html.push('<p>2. <b>调优的重要性</b>：加载自定义词典、动态加词、调整词频与开关 HMM 都能改变切分结果。' +
      '本次调优使 jieba 的 F1 变化 ' + ((jt.f1 - jd.f1) * 100).toFixed(2) +
      ' pt，说明"通用工具 + 领域适配"是分词工程的关键。</p>');
    html.push('<p>3. <b>工具对比的价值</b>：jieba 通用性强、开箱即用；自建工具可控性高、便于理解算法细节，' +
      '适合教学与研究。两者互为参照：可用 jieba 的结果反向扩充自建词典（本次扩充 ' +
      res.extendInfo.added + ' 词），也可用自建工具暴露 jieba 的切分偏好。</p>');
    html.push('<p>4. <b>可视化</b>：词云把技术结果转化为直观的视觉呈现，形状蒙版、配色与词频归一化共同决定' +
      '可读性；过滤停用词与单字词是提升词云质量最有效的一步。</p>');

    return html.join('');
  }

  function buildReportMarkdown(res) {
    var m = res.metrics;
    var order = ['jieba_default', 'jieba_tuned', 'self_default', 'self_tuned'];
    var stats = res.rawStats;
    var top = res.frequencies.list.slice(0, 20);
    var L = [];
    L.push('# 主题词云图设计 · 分词对比分析报告');
    L.push('');
    L.push('> 由「主题词云图生成系统」自动生成 · ' + new Date().toLocaleString('zh-CN'));
    L.push('');
    L.push('## 一、实验目的');
    L.push('掌握中文分词的基本原理与方法；通过自建分词工具与 jieba 的参数调优与定量对比（P/R/F1），');
    L.push('定位并解决分词错误问题；并将满意结果用于词云图可视化。');
    L.push('');
    L.push('## 二、实验要求');
    L.push('选取不少于 1000 字的语料；分别使用 jieba 与自建分词工具分词并调优；');
    L.push('对比调优前后结果、分析错误类型；基于分词结果制作有设计感的词云图。');
    L.push('');
    L.push('## 三、实验内容');
    L.push('');
    L.push('### 3.1 语料选取与预处理');
    L.push('- 语料规模：' + res.sentences + ' 句，原始 ' + stats.original + ' 字符，汉字 ' + stats.cjk + ' 个');
    L.push('- 预处理后：' + stats.cleaned + ' 字符（清除 ' + stats.removed + ' 个字符的噪声）');
    L.push('- 步骤：去 HTML 标签/实体/URL → 去零宽字符 → 统一换行空白 → ' +
      (res.options.pre.keepPunct ? '保留中文标点' : '剔除标点'));
    L.push('');
    L.push('### 3.2 jieba 分词与调优');
    L.push('- 模式：' + ({ exact: '精确模式 lcut()', full: '全模式 cut_all=True', search: '搜索引擎模式 lcut_for_search()' }[res.options.jieba.mode]));
    L.push('- HMM：' + (res.options.jieba.hmm ? '开启' : '关闭（HMM=False）'));
    L.push('- 自定义词典：' + (res.userLoadInfo ? res.userLoadInfo.loaded + ' 条（新增 ' + res.userLoadInfo.newWords + ' 词）' : '未启用'));
    L.push('- 词频调整：' + (res.tuneInfo.length ? res.tuneInfo.map(function (t) {
      return t.word + ' ' + (t.from === null || t.from === undefined ? '—' : t.from) + '→' + t.to;
    }).join('；') : '未启用'));
    L.push('');
    L.push('### 3.3 自建分词工具与调优');
    L.push('- 算法：' + ({ fmm: '正向最大匹配 FMM', bmm: '逆向最大匹配 RMM', bidir: '双向最大匹配' }[res.options.self.strategy]));
    L.push('- max_len：' + res.options.self.maxLen + ' → ' + res.options.self.maxLenTuned);
    L.push('- 未登录词回退：' + (res.options.self.hmmFallback ? '启用 HMM 回退' : '未启用'));
    L.push('- 词典扩充：' + (res.extendInfo.added ? '用 jieba 结果新增 ' + res.extendInfo.added + ' 词' : '未启用'));
    L.push('');
    L.push('### 3.4 分词结果对比分析');
    L.push('');
    L.push('**（1）定量对比**（标准来源：' + res.goldSource + '，标准词数 ' + res.gold.length + '）');
    L.push('');
    L.push('| 分词工具 | 准确率 P | 召回率 R | F1 值 | 输出词数 | 切分点数 | 整句一致率 |');
    L.push('| --- | --- | --- | --- | --- | --- | --- |');
    order.forEach(function (k) {
      var x = m[k];
      L.push('| ' + x.label + ' | ' + pct(x.precision) + ' | ' + pct(x.recall) + ' | ' +
        pct(x.f1) + ' | ' + x.sysWordCount + ' | ' + x.sysBoundaries + ' | ' + pct(x.exactMatch) + ' |');
    });
    L.push('');
    L.push('**（2）定性对比**');
    var jd = m.jieba_default, jt = m.jieba_tuned, sd = m.self_default, st = m.self_tuned;
    L.push('- 调优效果：jieba F1 ' + pct(jd.f1) + ' → ' + pct(jt.f1) + '（' +
      ((jt.f1 - jd.f1) * 100).toFixed(2) + ' pt）；自建工具 F1 ' + pct(sd.f1) + ' → ' + pct(st.f1) +
      '（' + ((st.f1 - sd.f1) * 100).toFixed(2) + ' pt）');
    L.push('- 错误类型统计（jieba 调优后）：切碎 ' + (res.errors.jieba_tuned.byType.split || 0) +
      ' 处、粘连 ' + (res.errors.jieba_tuned.byType.merge || 0) + ' 处、未登录词 ' +
      (res.errors.jieba_tuned.byType.oov || 0) + ' 处');
    L.push('- 工具差异：调优后两者 F1 相差 ' + Math.abs((jt.f1 - st.f1) * 100).toFixed(2) + ' pt');
    L.push('');
    L.push('**中文分词错误类型分布**');
    L.push('');
    L.push('| 错误类型 | jieba默认 | jieba调优 | 自建默认 | 自建调优 |');
    L.push('| --- | --- | --- | --- | --- |');
    ['split', 'merge', 'oov'].forEach(function (t) {
      var label = { split: '切碎（过度切分）', merge: '粘连（切分不足）', oov: '未登录词' }[t];
      L.push('| ' + label + ' | ' + (res.errors.jieba_default.byType[t] || 0) + ' | ' +
        (res.errors.jieba_tuned.byType[t] || 0) + ' | ' + (res.errors.self_default.byType[t] || 0) +
        ' | ' + (res.errors.self_tuned.byType[t] || 0) + ' |');
    });
    L.push('');
    L.push('### 3.5 词云图制作');
    var c = res.options.cloud;
    L.push('- 形状蒙版：' + c.shape + (c.shape === 'text' ? '（"' + c.shapeText + '"）' : ''));
    L.push('- 配色方案：' + c.palette);
    L.push('- 词频映射：' + c.mapping + '；字号 ' + c.minSize + '–' + c.maxSize + 'px；最多 ' + c.maxWords + ' 词');
    L.push('- 字体：' + c.fontFamily + '；背景：' + c.bg + '；画布 ' + c.width + '×' + c.height);
    L.push('- 停用词过滤：' + (state.stopwords ? state.stopwords.__size : 0) + ' 词停用表 + 最短词长 ' + res.options.pre.minLen);
    L.push('');
    L.push('**高频词（前 20）**');
    L.push('');
    L.push('| 排名 | 词语 | 词频 | 词性 |');
    L.push('| --- | --- | --- | --- |');
    top.forEach(function (w, i) {
      L.push('| ' + (i + 1) + ' | ' + w.word + ' | ' + w.count + ' | ' + (w.tag || '—') + ' |');
    });
    L.push('');
    L.push('## 四、思考与总结');
    L.push('');
    L.push('### 4.1 实验收获');
    L.push('1. 中文分词的核心难点是未登录词识别与歧义切分。jieba 用前缀词典 + 动态规划最大概率路径，');
    L.push('   并以 HMM 兜底处理词典未覆盖片段；自建最大匹配工具完全依赖词表覆盖，缺词时容易切碎专有名词。');
    L.push('2. 调优能实质改变结果：自定义词典、add_word、suggest_freq、HMM 开关都会影响切分路径，');
    L.push('   本次实验中 jieba F1 变化 ' + ((jt.f1 - jd.f1) * 100).toFixed(2) + ' pt。');
    L.push('3. 两个工具互为参照：用 jieba 的结果反向扩充自建词表（本次新增 ' + res.extendInfo.added + ' 词），');
    L.push('   可显著改善自建工具的 OOV 问题。');
    L.push('');
    L.push('### 4.2 遇到的问题与解决');
    L.push('');
    L.push('| 问题 | 原因 | 解决方案 |');
    L.push('| --- | --- | --- |');
    L.push('| 专有名词被切碎 | 词典未收录 | 加载自定义词典 / add_word |');
    L.push('| 歧义切分错误 | 词频设置不合理 | suggest_freq 调整词频；改用双向最大匹配 |');
    L.push('| 词云中无意义词过多 | 未过滤停用词 | 停用词表 + 长度过滤 + 词性过滤 |');
    L.push('| 自建工具 OOV 严重 | 词典规模小 | 用 jieba 结果反向扩充词表 |');
    L.push('');
    L.push('### 4.3 改进方向');
    L.push('1. 引入 BiLSTM-CRF / BERT-BiLSTM-CRF 等序列标注模型替代纯词典方法；');
    L.push('2. 构建领域词典；3. 引入切分一致性、OOV 召回率等更多指标；');
    L.push('4. 词云交互化（鼠标悬停查看词频）；5. 端到端 Pipeline 封装（本系统已实现）。');
    L.push('');
    L.push('## 附：系统说明');
    L.push('- 本报告的代码流程封装为 Pipeline：语料预处理 → 分词 → 调优 → 对比 → 词云，见 `web/js/pipeline.js`。');
    L.push('- 浏览器端复现了 jieba 的分词算法（DAG + 动态规划 + HMM），词典规模 ' +
      (state.dict ? state.dict.stats().entries.toLocaleString() : '349,046') + ' 词。');
    return L.join('\n');
  }

  function downloadReport() {
    if (!state.result) { return; }
    var md = buildReportMarkdown(state.result);
    var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '分词对比分析报告.md';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  // ---------------------------------------------------------------- 小工具
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function showLoading(text) {
    $('loading').hidden = false;
    setLoadingText(text || '正在处理…');
  }
  function hideLoading() { $('loading').hidden = true; }
  function setLoadingText(t) { $('loadingText').textContent = t; }

  // ------------------------------------------------------- 自动化测试钩子
  // 供 tools/browser_test.js 校验"自定义词典 / add_word / suggest_freq"确实改变切分结果
  window.__runWithUserDict = function () {
    var sample = '自然语言处理课程与深度学习模型是人工智能的核心';
    var base = new Pipeline({ dict: state.dict, hmm: state.hmm, jieba: state.jieba });
    var before = new JiebaSegmenter(state.jieba).segment(sample, { mode: 'exact', hmm: true })
      .map(function (t) { return t.word; });
    var res = base.run({ rawText: sample }, {
      pre: { minLen: 2, stopwords: Object.create(null) },
      jieba: {
        mode: 'exact', hmm: true,
        userDict: '自然语言处理 5000 nz\n深度学习 4000 n\n人工智能 3000 n',
        addWords: '', suggestFreq: ''
      },
      self: { strategy: 'fmm', maxLen: 6, maxLenTuned: 8, hmmFallback: true, extendFromJieba: true }
    });
    var after = res.variants[1].tokens.map(function (t) { return t.word; });
    // 调优后应当出现"自然语言处理""深度学习"等完整词，且调优前没有
    var gained = ['自然语言处理', '深度学习', '人工智能'].filter(function (w) {
      return after.indexOf(w) >= 0 && before.indexOf(w) < 0;
    });
    window.__testSegBefore = before;
    window.__testSegAfter = after;
    window.__testGained = gained;
    return gained.length >= 2;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();
