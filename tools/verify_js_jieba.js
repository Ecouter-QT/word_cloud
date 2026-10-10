/* 对拍脚本：在 Node 中加载浏览器版 jieba.js，与 Python jieba 的输出做逐句比对。
 * 用法：node tools/verify_js_jieba.js <cases.json>
 * cases.json: [{sentence, jieba_exact, jieba_full, jieba_search, jieba_nohmm}, ...]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sandbox = { window: {}, console: console, Math: Math, Object: Object, Array: Array, JSON: JSON, Infinity: Infinity };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);

function load(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  vm.runInContext(code, sandbox, { filename: rel });
}

load('web/data/jieba_dict.js');
load('web/data/jieba_hmm.js');
load('web/js/dict.js');
load('web/js/jieba.js');

const W = sandbox.window;
const dict = new W.Dict(W.__JIEBA_DICT__);
const jb = new W.Jieba(dict, W.__JIEBA_HMM__);

const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let pass = 0, fail = 0;
const failures = [];

function eq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

for (const c of cases) {
  const got = {
    jieba_exact: jb.lcut(c.sentence, false, true),
    jieba_full: jb.lcut(c.sentence, true, true),
    jieba_search: jb.lcutForSearch(c.sentence, true),
    jieba_nohmm: jb.lcut(c.sentence, false, false)
  };
  for (const key of Object.keys(got)) {
    const want = c[key];
    if (!want) continue;
    if (eq(got[key], want)) { pass++; }
    else {
      fail++;
      failures.push({ sentence: c.sentence.slice(0, 40), mode: key, want: want.join('/'), got: got[key].join('/') });
    }
  }
}

console.log(`PASS ${pass}  FAIL ${fail}`);
for (const f of failures.slice(0, 25)) {
  console.log(`--- [${f.mode}] ${f.sentence}`);
  console.log(`    python: ${f.want}`);
  console.log(`    js    : ${f.got}`);
}
process.exit(fail === 0 ? 0 : 1);
