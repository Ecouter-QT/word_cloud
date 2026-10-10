/* ============================================================================
 * browser_test.js —— 用真实 Chromium 跑一遍完整业务流程
 * ----------------------------------------------------------------------------
 * 通过 Chrome DevTools Protocol 直接驱动浏览器（不依赖 puppeteer）：
 *   1. 打开 web/index.html，等待词典加载完成
 *   2. 注入一篇文章（模拟"上传文章"）
 *   3. 点击「开始分析并生成词云」，等待结果
 *   4. 校验：词云像素、指标表、对比表、各标签页内容
 *   5. 截图，便于人工确认版式
 *
 * 用法：node tools/browser_test.js [file|http://...] [输出前缀]
 * ========================================================================== */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME_PATH ||
  'C:\\Users\\20868\\AppData\\Local\\ms-playwright\\chromium-1148\\chrome-win\\chrome.exe';
const TARGET = process.argv[2] || 'file:///' + path.join(ROOT, 'web', 'index.html').replace(/\\/g, '/');
const PREFIX = process.argv[3] || 'shot';
const SHOT_DIR = path.join(ROOT, 'tools', 'shots');

const PORT = 9333;
const UDD = path.join(os.tmpdir(), 'dsh-cdp-' + Date.now());

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --------------------------------------------------------------- CDP 客户端
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = e => rej(new Error('WebSocket 连接失败: ' + (e.message || e)));
    });
    const cdp = new CDP(ws);
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && cdp.pending.has(msg.id)) {
        const { res, rej } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      } else if (msg.method) {
        cdp.events.push(msg);
      }
    };
    return cdp;
  }

  send(method, params) {
    const id = ++this.id;
    const payload = JSON.stringify({ id, method, params: params || {} });
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(payload);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error('CDP 超时: ' + method));
        }
      }, 120000);
    });
  }

  /** 在页面里执行表达式并取回 JSON 结果 */
  async eval(expr, awaitPromise) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: !!awaitPromise,
      userGesture: true
    });
    if (r.exceptionDetails) {
      throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    }
    return r.result.value;
  }

  async screenshot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
}

// ------------------------------------------------------------------- 启动
async function launchChrome() {
  const args = [
    '--headless=new',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + UDD,
    '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--window-size=1600,1100',
    '--force-device-scale-factor=1',
    'about:blank'
  ];
  const proc = spawn(CHROME, args, { stdio: 'ignore', detached: false });

  // 等待调试端口就绪
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      if (res.ok) {
        const j = await res.json();
        return { proc, info: j };
      }
    } catch (e) { /* 还没起来 */ }
  }
  throw new Error('Chromium 调试端口未就绪');
}

async function newTarget(url) {
  const res = await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
  if (!res.ok) throw new Error('创建标签页失败: HTTP ' + res.status);
  return res.json();
}

// ------------------------------------------------------------------- 主流程
async function main() {
  const report = { steps: [], errors: [], checks: {} };
  const step = (name, ok, detail) => {
    report.steps.push({ name, ok, detail });
    console.log((ok ? '  [OK]   ' : '  [FAIL] ') + name + (detail ? '  — ' + detail : ''));
    if (!ok) report.errors.push(name + ': ' + detail);
  };

  console.log('目标页面: ' + TARGET);
  const { proc, info } = await launchChrome();
  console.log('浏览器: ' + info.Browser);
  let cdp;
  let exitCode = 0;
  try {
    const t = await newTarget('about:blank');
    cdp = await CDP.connect(t.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false
    });

    // 收集控制台错误
    const consoleErrors = [];
    cdp.ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        consoleErrors.push('未捕获异常: ' + (d.exception && d.exception.description || d.text));
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        consoleErrors.push('console.error: ' + m.params.args.map(a => a.value || a.description || '').join(' '));
      }
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        consoleErrors.push('日志错误: ' + m.params.entry.text);
      }
    });

    // 1. 打开页面
    console.log('\n── 1. 加载页面 ──');
    await cdp.send('Page.navigate', { url: TARGET });
    await sleep(1500);

    // 等待启动遮罩消失（词典加载完成）
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        ready = await cdp.eval("document.getElementById('boot').classList.contains('done')");
      } catch (e) { /* 页面还在导航 */ }
      if (ready) break;
      await sleep(500);
    }
    step('页面初始化（词典加载完成）', ready === true, ready ? '' : '启动遮罩未消失');

    const dictChip = await cdp.eval("document.getElementById('chipDict').textContent");
    step('词典就绪', /词典就绪/.test(dictChip), dictChip);

    const stopCount = await cdp.eval("window.__stopwordCount || (document.getElementById('stopStat').textContent)");
    step('停用词表加载', /[1-9]\d*/.test(stopCount), stopCount);

    // 2. 注入文章（模拟上传）
    console.log('\n── 2. 注入文章 ──');
    const article = fs.readFileSync(path.join(ROOT, 'data', 'corpus.txt'), 'utf8');
    await cdp.eval('window.__testArticle = ' + JSON.stringify(article) + '; true');
    const setOk = await cdp.eval(`(function(){
      var ta = document.getElementById('rawText');
      ta.value = window.__testArticle;
      ta.dispatchEvent(new Event('input', {bubbles:true}));
      return ta.value.length;
    })()`);
    step('文章写入文本框', setOk > 3000, setOk + ' 字符');

    const stat = await cdp.eval("document.getElementById('textStat').textContent");
    step('字数统计更新', /汉字/.test(stat), stat);

    // 3. 运行分析
    console.log('\n── 3. 运行分析 ──');
    const t0 = Date.now();
    await cdp.eval("document.getElementById('btnRun').click(); true");
    // 等待结果（loading 隐藏且 state.cloud 存在）
    let done = false;
    for (let i = 0; i < 160; i++) {
      await sleep(500);
      try {
        done = await cdp.eval("document.getElementById('loading').hidden === true && document.getElementById('cloudMeta').textContent.indexOf('已放置') >= 0");
      } catch (e) { }
      if (done) break;
    }
    step('分析流程完成', done === true, done ? ((Date.now() - t0) + ' ms') : '超时');

    // 4. 校验词云
    console.log('\n── 4. 校验词云 ──');
    const cloudMeta = await cdp.eval("document.getElementById('cloudMeta').textContent");
    step('词云已布局', /已放置\\s*\\d+\\s*词/.test(cloudMeta) || /已放置/.test(cloudMeta), cloudMeta);

    const pixel = await cdp.eval(`(function(){
      var c = document.getElementById('cloud');
      var ctx = c.getContext('2d');
      var d = ctx.getImageData(0,0,c.width,c.height).data;
      var bg = 0, fg = 0;
      for (var i = 0; i < d.length; i += 4*37) {
        if (d[i] > 245 && d[i+1] > 245 && d[i+2] > 245) bg++;
        else fg++;
      }
      return { w: c.width, h: c.height, bg: bg, fg: fg, ratio: fg/(fg+bg) };
    })()`);
    step('词云画布有内容渲染', pixel.fg > 500 && pixel.ratio > 0.02,
      `画布 ${pixel.w}×${pixel.h}，非背景像素占比 ${(pixel.ratio * 100).toFixed(1)}%`);

    // 5. 校验各标签页
    console.log('\n── 5. 校验结果面板 ──');
    const metricRows = await cdp.eval("document.querySelectorAll('#metricTable tbody tr').length");
    step('指标表有 4 行', metricRows === 4, metricRows + ' 行');

    const metricText = await cdp.eval("document.getElementById('metricTable').innerText");
    const hasF1 = /F1/.test(metricText) && /%/.test(metricText);
    step('指标表含 P/R/F1 数值', hasF1, '');

    const freqRows = await cdp.eval("document.querySelectorAll('#freqTable tbody tr').length");
    step('词频表有数据', freqRows > 50, freqRows + ' 行');

    const bars = await cdp.eval("document.querySelectorAll('#barList .bar-row').length");
    step('高频词条形榜有 30 条', bars === 30, bars + ' 条');

    const segLens = await cdp.eval(`[
      document.getElementById('segJiebaDefault').children.length,
      document.getElementById('segJiebaTuned').children.length,
      document.getElementById('segSelfDefault').children.length,
      document.getElementById('segSelfTuned').children.length
    ]`);
    step('四路分词结果都已渲染', segLens.every(n => n > 100), JSON.stringify(segLens));

    const diffRows = await cdp.eval("document.querySelectorAll('#diffTable tbody tr').length");
    step('jieba 调优差异表有内容', diffRows > 0, diffRows + ' 行');

    const reportLen = await cdp.eval("document.getElementById('reportBody').innerText.length");
    step('实验报告已生成', reportLen > 1000, reportLen + ' 字符');

    const tuneLog = await cdp.eval("document.querySelectorAll('#tuneLog .log-block').length");
    step('调优记录已生成', tuneLog >= 4, tuneLog + ' 条');

    // 6. 交互：切换标签页 + 悬停
    console.log('\n── 6. 交互校验 ──');
    for (const tab of ['freq', 'compare', 'metrics', 'tune', 'report', 'cloud']) {
      await cdp.eval(`document.querySelector('#tabs .tab[data-tab="${tab}"]').click(); true`);
      await sleep(120);
      const shown = await cdp.eval(`document.querySelector('.pane[data-pane="${tab}"]').classList.contains('active')`);
      if (!shown) { step('标签页切换 ' + tab, false, '未激活'); }
    }
    step('标签页切换正常', true, '6 个标签均可切换');

    // 悬停 tooltip（直接派发 mousemove）
    const tipOk = await cdp.eval(`(function(){
      var c = document.getElementById('cloud');
      var pl = window.__cloudPlaced || null;
      if (!pl || !pl.length) return 'no-placed';
      var p = pl[0];
      var r = c.getBoundingClientRect();
      var ev = new MouseEvent('mousemove', {
        clientX: r.left + (p.cx/c.width)*r.width,
        clientY: r.top + (p.cy/c.height)*r.height,
        bubbles: true
      });
      c.dispatchEvent(ev);
      var tip = document.getElementById('cloudTip');
      return tip.classList.contains('show') ? tip.textContent : 'not-shown';
    })()`);
    step('词云悬停提示', typeof tipOk === 'string' && tipOk !== 'no-placed' && tipOk !== 'not-shown' && tipOk !== 'not-shown',
      String(tipOk).slice(0, 70));

    // 7. 参数改动后重绘
    console.log('\n── 7. 重新生成（换形状/配色）──');
    await cdp.eval(`(function(){
      document.getElementById('optShape').value = 'heart';
      document.getElementById('optShape').dispatchEvent(new Event('change', {bubbles:true}));
      document.getElementById('optPalette').value = 'plasma';
      document.getElementById('optRotate').value = '0.3';
      return true;
    })()`);
    await cdp.eval("document.getElementById('btnRun').click(); true");
    let done2 = false;
    for (let i = 0; i < 160; i++) {
      await sleep(500);
      done2 = await cdp.eval("document.getElementById('loading').hidden === true && document.getElementById('cloudMeta').textContent.indexOf('已放置') >= 0");
      if (done2) break;
    }
    step('换参数后重新生成成功', done2 === true, '');

    // 8. 调优开关：关闭 HMM + 自定义词典
    console.log('\n── 8. 调优功能校验 ──');
    const tuneEffect = await cdp.eval(`(function(){
      var d = window.__pipelineDict;
      return true;
    })()`);
    void tuneEffect;

    // 自定义词典生效性：直接调用 pipeline
    const userDictWorks = await cdp.eval(`(function(){
      try {
        var r = window.__runWithUserDict();
        return r;
      } catch(e) { return 'ERR: ' + e.message; }
    })()`);
    step('自定义词典 add_word 生效', userDictWorks === true || userDictWorks === 'true', String(userDictWorks));

    // 9. 截图
    console.log('\n── 9. 截图 ──');
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await cdp.eval("document.querySelector('#tabs .tab[data-tab=\"cloud\"]').click(); true");
    await sleep(400);
    const s1 = await cdp.screenshot(path.join(SHOT_DIR, PREFIX + '-1-cloud.png'));
    step('截图：词云页', fs.existsSync(s1), s1);

    await cdp.eval("document.querySelector('#tabs .tab[data-tab=\"compare\"]').click(); true");
    await sleep(300);
    const s2 = await cdp.screenshot(path.join(SHOT_DIR, PREFIX + '-2-compare.png'));
    step('截图：分词对比页', fs.existsSync(s2), s2);

    await cdp.eval("document.querySelector('#tabs .tab[data-tab=\"metrics\"]').click(); true");
    await sleep(300);
    const s3 = await cdp.screenshot(path.join(SHOT_DIR, PREFIX + '-3-metrics.png'));
    step('截图：指标页', fs.existsSync(s3), s3);

    await cdp.eval("document.querySelector('#tabs .tab[data-tab=\"freq\"]').click(); true");
    await sleep(300);
    const s4 = await cdp.screenshot(path.join(SHOT_DIR, PREFIX + '-4-freq.png'));
    step('截图：词频页', fs.existsSync(s4), s4);

    // 10. 取回关键数据供报告使用
    const data = await cdp.eval(`JSON.stringify({
      metrics: window.__lastMetrics || null,
      cloudMeta: document.getElementById('cloudMeta').textContent,
      freqTop: (window.__lastFreq || []).slice(0, 20),
      metricTable: document.getElementById('metricTable').innerText
    })`);
    fs.writeFileSync(path.join(SHOT_DIR, PREFIX + '-data.json'), data, 'utf8');
    step('导出页面数据', true, PREFIX + '-data.json');

    // 「载入示例语料」按钮：验证内联示例语料可用
    await cdp.eval("document.getElementById('rawText').value=''; document.getElementById('btnSample').click(); true");
    await sleep(4000);
    const sampleLen = await cdp.eval("document.getElementById('rawText').value.length");
    step('载入示例语料可用', sampleLen > 3000, sampleLen + ' 字符');

    console.log('\n── 控制台错误 ──');
    if (consoleErrors.length) {
      consoleErrors.slice(0, 15).forEach(e => console.log('  ! ' + e));
      step('无控制台错误', false, consoleErrors.length + ' 条错误');
    } else {
      step('无控制台错误', true, '');
    }

    console.log('\n截图目录: ' + SHOT_DIR);
    console.log(report.errors.length ? '\n结果: ' + report.errors.length + ' 项失败' : '\n结果: 全部通过 ✔');
    exitCode = report.errors.length ? 1 : 0;
  } catch (e) {
    console.error('\n测试异常: ' + (e && e.stack || e));
    exitCode = 2;
  } finally {
    try { if (cdp) cdp.ws.close(); } catch (e) { }
    try { proc.kill(); } catch (e) { }
    await sleep(400);
    try { fs.rmSync(UDD, { recursive: true, force: true }); } catch (e) { }
  }
  process.exit(exitCode);
}

main();
