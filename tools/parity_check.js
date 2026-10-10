/* parity_check.js —— 用浏览器版 JS 实现跑同一批句子，与 Python 结果逐句比对。
 * 用法：node tools/parity_check.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sb = { window: {}, console, Math, Object, Array, JSON, Infinity, parseInt, String, Number };
sb.window.window = sb.window;
vm.createContext(sb);
['web/data/jieba_dict.js', 'web/data/jieba_hmm.js', 'web/js/dict.js', 'web/js/jieba.js']
  .forEach(r => vm.runInContext(fs.readFileSync(path.join(ROOT, r), 'utf8'), sb, { filename: r }));

const W = sb.window;
const dict = new W.Dict(W.__JIEBA_DICT__);
const jb = new W.Jieba(dict, W.__JIEBA_HMM__);

const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'parity_cases.json'), 'utf8'));
const modes = ['exact', 'nohmm', 'full', 'search'];

const stat = {};
modes.forEach(m => { stat[m] = { pass: 0, fail: 0, tokTotal: 0, tokHit: 0 }; });
const fails = [];

function eqArr(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

for (const c of cases) {
  const got = {
    exact: jb.lcut(c.sentence, false, true),
    nohmm: jb.lcut(c.sentence, false, false),
    full: jb.lcut(c.sentence, true, true),
    search: jb.lcutForSearch(c.sentence, true)
  };
  for (const m of modes) {
    const want = c[m];
    stat[m].tokTotal += Math.max(want.length, 1);
    // 逐词位置命中率（更细的指标）
    let hit = 0;
    const n = Math.min(want.length, got[m].length);
    for (let i = 0; i < n; i++) if (want[i] === got[m][i]) hit++;
    stat[m].tokHit += hit;
    if (eqArr(want, got[m])) stat[m].pass++;
    else {
      stat[m].fail++;
      if (fails.length < 12) {
        fails.push({ mode: m, sent: c.sentence.slice(0, 46), want: want.join('/'), got: got[m].join('/') });
      }
    }
  }
}

console.log('句子总数: ' + cases.length);
console.log('');
console.log('模式        整句完全一致            词级位置一致率');
for (const m of modes) {
  const s = stat[m];
  const sentRate = (s.pass / cases.length * 100).toFixed(1);
  const tokRate = (s.tokHit / s.tokTotal * 100).toFixed(2);
  console.log(
    m.padEnd(10) +
    (s.pass + '/' + cases.length).padEnd(12) + (sentRate + '%').padEnd(12) +
    (s.tokHit + '/' + s.tokTotal).padEnd(14) + tokRate + '%'
  );
}
console.log('');
if (fails.length) {
  console.log('不一致样例（最多 12 条）：');
  for (const f of fails) {
    console.log('--- [' + f.mode + '] ' + f.sent);
    console.log('    py: ' + f.want);
    console.log('    js: ' + f.got);
  }
} else {
  console.log('全部一致 ✔');
}
const totalFail = modes.reduce((a, m) => a + stat[m].fail, 0);
process.exit(totalFail === 0 ? 0 : 1);
