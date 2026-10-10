/*!
 * wordcloud.js —— 词云布局与绘制（纯前端 Canvas 实现）
 * ---------------------------------------------------------------------------
 * 设计要点（对应实验要求 "设计感要点"）：
 *   · 形状蒙版：圆形 / 椭圆 / 心形 / 星形 / 云朵 / 菱形 / 文字轮廓 / 矩形
 *   · 配色方案：内置 viridis / plasma / inferno / magma / 冷暖色 / 马卡龙 等色带
 *   · 词频归一化：linear / sqrt / log 三种映射，避免超高频词独占画面
 *   · 字体选择：系统中文字体（黑体 / 微软雅黑 / 楷体 / 宋体 / 等线）
 *   · 悬停交互：返回每个词的包围盒，供上层做 tooltip
 *
 * 布局：阿基米德螺旋线逐个摆放，用「位压缩碰撞图」做重叠检测。
 * 关键设计：buildSprite() 只负责生成碰撞用的位图，drawWord() 只负责上色绘制，
 *          两者使用完全相同的字体/变换参数，因此"看起来的位置"与"占位"严格一致。
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- 配色方案
  var PALETTES = {
    viridis: ['#440154', '#482878', '#3E4A89', '#31688E', '#26828E', '#1F9E89', '#35B779', '#6DCD59', '#B4DE2C', '#FDE725'],
    plasma: ['#0D0887', '#46039F', '#7201A8', '#9C179E', '#BD3786', '#D8576B', '#ED7953', '#FB9F3A', '#FDCA26', '#F0F921'],
    inferno: ['#000004', '#1B0C41', '#4A0C6B', '#781C6D', '#A52C60', '#CF4446', '#ED6925', '#FB9B06', '#F7D13D', '#FCFFA4'],
    magma: ['#000004', '#180F3D', '#440F76', '#721F81', '#9E2F7F', '#CD4071', '#F1605D', '#FD9668', '#FEC98D', '#FCFDBF'],
    cividis: ['#00204D', '#00336F', '#39486B', '#575D6D', '#707173', '#8A8779', '#A69D75', '#C4B56C', '#E4CF5B', '#FFEA46'],
    turbo: ['#30123B', '#4145AB', '#4675ED', '#39A2FC', '#1BCFD4', '#61F2A5', '#A4FC3B', '#E1DD37', '#FEA34E', '#E5460C'],
    warm: ['#7F1D1D', '#B91C1C', '#DC2626', '#EA580C', '#F59E0B', '#FBBF24', '#FCD34D', '#FDE68A'],
    cool: ['#0C4A6E', '#075985', '#0369A1', '#0284C7', '#0EA5E9', '#38BDF8', '#7DD3FC', '#BAE6FD'],
    ocean: ['#04293A', '#064663', '#0B6E4F', '#14868B', '#1FA5A0', '#4FC3A1', '#8ED9B0', '#CFF5C8'],
    macaron: ['#F94144', '#F3722C', '#F8961E', '#F9C74F', '#90BE6D', '#43AA8B', '#4D908E', '#577590'],
    forest: ['#1B4332', '#2D6A4F', '#40916C', '#52B788', '#74C69D', '#95D5B2', '#B7E4C7', '#D8F3DC'],
    sunset: ['#6A0572', '#AB83A1', '#E36588', '#F58A63', '#FFC15E', '#FFE29A'],
    ink: ['#111827', '#1F2937', '#374151', '#4B5563', '#6B7280', '#9CA3AF'],
    rainbow: ['#E63946', '#F77F00', '#FCBF49', '#A8DADC', '#457B9D', '#1D3557', '#8338EC', '#3A86FF']
  };

  var PALETTE_LABELS = {
    viridis: 'viridis（默认，冷绿黄）', plasma: 'plasma（紫橙黄）', inferno: 'inferno（黑红金）',
    magma: 'magma（暗紫橙）', cividis: 'cividis（蓝黄，色盲友好）', turbo: 'turbo（高对比彩虹）',
    warm: 'warm（暖色）', cool: 'cool（冷色）', ocean: 'ocean（海洋）',
    macaron: 'macaron（马卡龙）', forest: 'forest（森林绿）', sunset: 'sunset（日落）',
    ink: 'ink（水墨灰）', rainbow: 'rainbow（彩虹）'
  };

  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }

  /** 在色带上按 t∈[0,1] 线性插值取色 */
  function samplePalette(palette, t) {
    if (!(t >= 0)) { t = 0; }
    if (t > 1) { t = 1; }
    var n = palette.length;
    var x = t * (n - 1);
    var i = Math.floor(x);
    var f = x - i;
    var a = hexToRgb(palette[i]);
    var b = hexToRgb(palette[Math.min(i + 1, n - 1)]);
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' +
      Math.round(a[1] + (b[1] - a[1]) * f) + ',' +
      Math.round(a[2] + (b[2] - a[2]) * f) + ')';
  }

  // ---------------------------------------------------------------- 形状蒙版
  var SHAPES = {
    rect: function () { return true; },
    ellipse: function (x, y, w, h) {
      var dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2);
      return dx * dx + dy * dy <= 0.94;
    },
    circle: function (x, y, w, h) {
      var r = Math.min(w, h) / 2 * 0.96;
      var dx = x - w / 2, dy = y - h / 2;
      return dx * dx + dy * dy <= r * r;
    },
    heart: function (x, y, w, h) {
      // 心形隐函数 (x²+y²-1)³ - x²y³ <= 0
      var nx = (x - w / 2) / (w / 2) * 1.45;
      var ny = -(y - h / 2) / (h / 2) * 1.45 + 0.35;
      var a = nx * nx + ny * ny - 1;
      return a * a * a - nx * nx * ny * ny * ny <= 0;
    },
    star: function (x, y, w, h) {
      var cx = w / 2, cy = h / 2;
      var dx = (x - cx) / (w / 2), dy = (y - cy) / (h / 2);
      var ang = Math.atan2(dy, dx);
      var rad = Math.sqrt(dx * dx + dy * dy);
      var spikes = 5, outer = 0.98, inner = 0.45;
      var seg = Math.PI / spikes;
      var a2 = ((ang % (2 * seg)) + 2 * seg) % (2 * seg);
      var f = Math.abs(a2 - seg) / seg;
      var limit = inner + (outer - inner) * (1 - f) * 1.0;
      return rad <= limit;
    },
    diamond: function (x, y, w, h) {
      var dx = Math.abs(x - w / 2) / (w / 2 * 0.96);
      var dy = Math.abs(y - h / 2) / (h / 2 * 0.96);
      return dx + dy <= 1;
    },
    cloud: function (x, y, w, h) {
      var blobs = [[0.30, 0.60, 0.22], [0.47, 0.44, 0.27], [0.66, 0.55, 0.22], [0.55, 0.68, 0.22], [0.78, 0.67, 0.14]];
      var u = x / w, v = y / h;
      for (var i = 0; i < blobs.length; i++) {
        var bx = (u - blobs[i][0]) / blobs[i][2];
        var by = (v - blobs[i][1]) / (blobs[i][2] * (w / h));
        if (bx * bx + by * by <= 1) { return true; }
      }
      return false;
    }
  };

  /** 把一个汉字渲染成蒙版：字内为 true */
  function makeTextMask(char, w, h) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#000';
    var size = Math.min(w / Math.max(char.length, 1), h) * 0.95;
    ctx.font = '700 ' + size + 'px "Microsoft YaHei","SimHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(char, w / 2, h / 2);
    var data = ctx.getImageData(0, 0, w, h).data;
    var mask = new Uint8Array(w * h);
    for (var i = 0, p = 3; i < w * h; i++, p += 4) { mask[i] = data[p] > 100 ? 1 : 0; }
    return mask;
  }

  // ------------------------------------------------- 位压缩碰撞图（1 像素 = 1 bit）
  function BitMap(w, h) {
    this.w = w; this.h = h;
    this.words = Math.ceil(w / 32) + 1;   // 多留一个字，右移时可直接写下一字
    this.data = new Uint32Array(this.words * h);
  }
  /** 把 (x,y) 标记为已占用；越界视为已占用（起蒙版作用） */
  BitMap.prototype.set = function (x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) { return; }
    this.data[y * this.words + (x >> 5)] |= (1 << (x & 31));
  };

  /**
   * 判断位图精灵放在 (gx,gy) 是否与已有内容重叠。
   * 精灵自身也用位压缩表示，因此可用按位与批量判断。
   */
  function spriteCollide(bm, sprite, gx, gy) {
    var W = bm.w, H = bm.h, words = bm.words, data = bm.data;
    var sb = sprite.bits, swWords = sprite.words, sw = sprite.sw, sh = sprite.sh;
    var shift = gx & 31;
    var wordIdx0 = gx >> 5;
    for (var j = 0; j < sh; j++) {
      var y = gy + j;
      var sRow = j * swWords;
      if (y < 0 || y >= H) {
        for (var q = 0; q < swWords; q++) { if (sb[sRow + q]) { return true; } }
        continue;
      }
      var mRow = y * words;
      for (var k = 0; k < swWords; k++) {
        var sv = sb[sRow + k];
        if (sv === 0) { continue; }
        var mIdx = wordIdx0 + k;
        // 精灵字 k 覆盖画布列 [gx+32k, gx+32k+32)
        var cur = 0;
        if (mIdx >= 0 && mIdx < words) { cur |= (data[mRow + mIdx] >>> shift); }
        if (shift && mIdx + 1 >= 0 && mIdx + 1 < words) { cur |= (data[mRow + mIdx + 1] << (32 - shift)); }
        if ((cur & sv) !== 0) { return true; }
      }
      // 左越界部分：gx<0 时上面的移位会丢弃负列，需单独检查
      if (gx < 0) {
        for (var i = 0; i < Math.min(sw, -gx); i++) {
          if ((sb[sRow + (i >> 5)] >> (i & 31)) & 1) { return true; }
        }
      }
      // 右越界部分
      if (gx + sw > W) {
        for (var i2 = Math.max(0, W - gx); i2 < sw; i2++) {
          if ((sb[sRow + (i2 >> 5)] >> (i2 & 31)) & 1) { return true; }
        }
      }
    }
    return false;
  }

  /** 把精灵写入碰撞图 */
  function spriteOr(bm, sprite, gx, gy) {
    var W = bm.w, H = bm.h, words = bm.words, data = bm.data;
    var sb = sprite.bits, swWords = sprite.words, sw = sprite.sw, sh = sprite.sh;
    var shift = gx & 31;
    var wordIdx0 = gx >> 5;
    for (var j = 0; j < sh; j++) {
      var y = gy + j;
      if (y < 0 || y >= H) { continue; }
      var mRow = y * words;
      var sRow = j * swWords;
      for (var k = 0; k < swWords; k++) {
        var sv = sb[sRow + k];
        if (sv === 0) { continue; }
        var mIdx = wordIdx0 + k;
        if (shift) {
          if (mIdx >= 0 && mIdx < words) { data[mRow + mIdx] |= (sv << shift); }
          if (mIdx + 1 >= 0 && mIdx + 1 < words) { data[mRow + mIdx + 1] |= (sv >>> (32 - shift)); }
        } else {
          if (mIdx >= 0 && mIdx < words) { data[mRow + mIdx] |= sv; }
        }
      }
    }
  }

  // ---------------------------------------------------------------- 字体/精灵
  function fontStack(name) {
    var m = {
      'SimHei': '"SimHei","黑体",sans-serif',
      'Microsoft YaHei': '"Microsoft YaHei","微软雅黑",sans-serif',
      'KaiTi': '"KaiTi","楷体",serif',
      'SimSun': '"SimSun","宋体",serif',
      'DengXian': '"DengXian","等线",sans-serif',
      'STZhongsong': '"STZhongsong","华文中宋",serif',
      'Microsoft JhengHei': '"Microsoft JhengHei",sans-serif'
    };
    return m[name] || ('"' + name + '","Microsoft YaHei",sans-serif');
  }

  function cssFont(size, weight, family) {
    return (weight === 'bold' ? '700 ' : '400 ') + size + 'px ' + family;
  }

  /**
   * 统一的绘制函数：把词画在画布上。
   * 精灵生成与最终上色都调用它，从而保证「占位」与「显示」严格一致。
   */
  function drawWord(ctx, word, cx, cy, size, rotate, weight, family, color) {
    ctx.save();
    ctx.font = cssFont(size, weight, family);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (color) { ctx.fillStyle = color; }
    ctx.translate(cx, cy);
    if (rotate) { ctx.rotate(Math.PI / 2); }
    ctx.fillText(word, 0, 0);
    ctx.restore();
  }

  /**
   * 生成碰撞用精灵（离屏渲染同一段文字，取其 alpha 通道）。
   * 返回 { bits, words, sw, sh, size, rotate }，其中 (sw,sh) 为包围盒。
   */
  function buildSprite(word, size, rotate, weight, family) {
    var probe = document.createElement('canvas');
    probe.width = 8; probe.height = 8;
    var pctx = probe.getContext('2d');
    pctx.font = cssFont(size, weight, family);
    var m = pctx.measureText(word);
    var tw = Math.ceil(m.width) + 6;
    var th = Math.ceil(size * 1.42) + 4;
    if (tw <= 6 || th <= 6) { return null; }
    var cw = rotate ? th : tw;
    var ch = rotate ? tw : th;
    if (cw > 4000 || ch > 4000) { return null; }

    var cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    var ctx = cv.getContext('2d');
    // 先用与碰撞精灵完全一致的方式画一遍（黑色）
    drawWord(ctx, word, cw / 2, ch / 2, size, rotate, weight, family, '#000');

    var data = ctx.getImageData(0, 0, cw, ch).data;
    var words = Math.ceil(cw / 32);
    var bits = new Uint32Array(words * ch);
    for (var y = 0, p = 3; y < ch; y++) {
      for (var x = 0; x < cw; x++, p += 4) {
        if (data[p] > 24) { bits[y * words + (x >> 5)] |= (1 << (x & 31)); }
      }
    }
    return { bits: bits, words: words, sw: cw, sh: ch, size: size, rotate: rotate };
  }

  // ---------------------------------------------------------------- 主入口
  /**
   * @param {object} opt {canvas, words, width, height, maxWords, shape, shapeText,
   *                      palette, mapping, minSize, maxSize, fontFamily, weight,
   *                      rotateRatio, bg}
   * @param {function} onProgress
   */
  function render(opt, onProgress) {
    var canvas = opt.canvas;
    var W = Math.max(200, Math.round(opt.width || 900));
    var H = Math.max(200, Math.round(opt.height || 600));
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var bgColor = opt.bg || '#ffffff';
    var t0 = Date.now();

    // ---- 1. 词表准备 ----
    var words = (opt.words || []).filter(function (w) { return w && w.word && w.count > 0; });
    var maxWords = opt.maxWords || 150;
    var total = words.length;
    words = words.slice(0, maxWords);
    if (!words.length) {
      ctx.fillStyle = bgColor; ctx.fillRect(0, 0, W, H);
      return { placed: [], dropped: [], width: W, height: H, elapsed: 0 };
    }

    // ---- 2. 形状蒙版（形状之外预先标记为占用）----
    var bm = new BitMap(W, H);
    var shapeFn = SHAPES[opt.shape] || SHAPES.rect;
    var textMask = (opt.shape === 'text' && opt.shapeText) ? makeTextMask(opt.shapeText, W, H) : null;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var inside = textMask ? (textMask[y * W + x] === 1) : shapeFn(x, y, W, H);
        if (!inside) { bm.set(x, y); }
      }
    }

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);

    // ---- 3. 字号映射 ----
    var counts = words.map(function (w) { return w.count; });
    var maxC = Math.max.apply(null, counts);
    var minC = Math.min.apply(null, counts);
    var minSize = opt.minSize || 12;
    // 最大字号不能只看用户输入：画布较小时把最大字号压到画布的 19%，
    // 否则头部几个词会撑满整个形状，导致后面 70% 的词放不下。
    var maxSize = Math.min(opt.maxSize || 999, Math.max(28, Math.min(W, H) * 0.19));
    if (maxSize < minSize) { maxSize = minSize; }
    var lMax = Math.log(maxC + 1), lMin = Math.log(minC + 1);

    function norm(c) {
      if (maxC === minC) { return 1; }
      if (opt.mapping === 'log') { return (Math.log(c + 1) - lMin) / (lMax - lMin); }
      if (opt.mapping === 'linear') { return (c - minC) / (maxC - minC); }
      return (Math.sqrt(c) - Math.sqrt(minC)) / (Math.sqrt(maxC) - Math.sqrt(minC));
    }

    var palette = PALETTES[opt.palette] || PALETTES.viridis;
    var family = fontStack(opt.fontFamily || 'Microsoft YaHei');
    var weight = opt.weight === 'bold' ? 'bold' : 'normal';
    var rotateRatio = opt.rotateRatio === undefined ? 0 : opt.rotateRatio;

    var placed = [], dropped = [];
    var cx0 = W / 2, cy0 = H / 2;
    var maxR = Math.sqrt(W * W + H * H) / 2 + Math.max(W, H) * 0.15;
    var aspect = W / H;
    var step = Math.max(1, Math.min(W, H) / 380);

    /** 沿阿基米德螺旋线寻找第一个不重叠的位置（角度增量小，避免漏掉缝隙） */
    function search(sprite) {
      var a = 0, rr = 0, b = Math.max(0.8, step);
      while (rr < maxR) {
        rr = b * a;
        var px = Math.round(cx0 + aspect * rr * Math.cos(a) - sprite.sw / 2);
        var py = Math.round(cy0 + rr * Math.sin(a) - sprite.sh / 2);
        if (!spriteCollide(bm, sprite, px, py)) { return { x: px, y: py }; }
        a += 0.22;
      }
      return null;
    }

    for (var i = 0; i < words.length; i++) {
      var item = words[i];
      var t = norm(item.count);
      var size = Math.round(minSize + (maxSize - minSize) * t);
      var rotate = rotateRatio > 0 && item.word.length <= 6 && Math.random() < rotateRatio;

      // 尝试放置；放不下就缩小字号重试
      var sprite = null, placedPos = null, trySize = size;
      var attempts = 0;
      while (trySize >= minSize && attempts < 6) {
        attempts++;
        sprite = buildSprite(item.word, trySize, rotate, weight, family);
        if (!sprite) {
          if (rotate) { rotate = false; continue; }   // 竖排放不下就改横排
          break;
        }
        if (sprite.sw > W * 0.98 || sprite.sh > H * 0.98) {
          if (rotate) { rotate = false; continue; }
          trySize = Math.round(trySize * 0.82);
          continue;
        }
        placedPos = search(sprite);
        if (placedPos) { break; }
        if (rotate) { rotate = false; continue; }
        trySize = Math.round(trySize * 0.86);
      }
      if (!sprite || !placedPos) { dropped.push(item.word); continue; }

      spriteOr(bm, sprite, placedPos.x, placedPos.y);
      var color = samplePalette(palette, 1 - t);
      drawWord(ctx, item.word, placedPos.x + sprite.sw / 2, placedPos.y + sprite.sh / 2,
        sprite.size, sprite.rotate, weight, family, color);

      placed.push({
        word: item.word, count: item.count, size: sprite.size, color: color,
        rotate: sprite.rotate, x: placedPos.x, y: placedPos.y,
        w: sprite.sw, h: sprite.sh,
        cx: placedPos.x + sprite.sw / 2, cy: placedPos.y + sprite.sh / 2
      });

      if (onProgress && (i % 10 === 0 || i === words.length - 1)) {
        onProgress({ done: i + 1, total: words.length });
      }
    }

    return {
      placed: placed, dropped: dropped,
      width: W, height: H, dpr: dpr,
      elapsed: Date.now() - t0
    };
  }

  global.WordCloud = {
    render: render,
    PALETTES: PALETTES,
    PALETTE_LABELS: PALETTE_LABELS,
    SHAPES: ['rect', 'ellipse', 'circle', 'heart', 'star', 'diamond', 'cloud', 'text'],
    fontStack: fontStack,
    samplePalette: samplePalette
  };
})(window);
