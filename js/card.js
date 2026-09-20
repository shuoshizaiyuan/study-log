/* card.js — 把某一天画成一张「打卡长图」（纯 Canvas，无第三方库、无外链）
   图上依次是：① 总时长 + 分类占比饼图（含图例）
              ② 时间轴（只画「设置里选中的分类」，没选中的留成空白条）
              ③ 按分类分组：分类总时长 → 每个任务各多久 → 该任务下的分次记录（摘录 + 字数）+ 图片缩略图
   只统计哪些分类由 设置 → 打卡长图里显示哪些分类 决定（settings.cardCats） */
(function (root) {
  'use strict';
  var A = root.App = root.App || {};
  var U = A.util, S = A.store;

  var W = 1080;                 /* 画布宽 */
  var PAD = 54;                 /* 左右留白 */
  var PW = W - PAD * 2;         /* 内容宽 */
  var HOUR = 34;                /* 时间轴每小时像素高 */
  var AXIS = 76;                /* 时间轴左侧刻度宽 */
  var THUMB = 96;               /* 缩略图边长（小一点，图上不占地方） */
  var C = {
    bg: '#FFFFFF', ink: '#1B2130', ink2: '#5C6678', ink3: '#8D96A6',
    line: '#E6EAF1', sunk: '#EEF2F7', blue: '#185FA5', blueL: '#E6F1FB', teal: '#0F6E56'
  };
  /* 字体栈写宽一点：安卓常见的是 Noto Sans CJK，苹果是 PingFang，
     原来只写 PingFang + 雅黑，有些机型会落到一个缺字很多的默认字体上 → 画出来是方块/乱码 */
  var FONT_STACK = 'system-ui,-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",' +
    '"Noto Sans CJK SC","Source Han Sans SC","WenQuanYi Micro Hei",sans-serif';
  function fnt(sz, bold) {
    return (bold ? '600 ' : '400 ') + sz + 'px ' + FONT_STACK;
  }
  /* 画之前先把文字洗干净 —— 这是「图上出现乱码」最常见的原因：
     从别处粘进来的控制字符 / 零宽字符 / BOM / 方向控制符 / 行分隔符，
     字体里没有这些字形，画出来就是一个奇怪的方块。 */
  function clean(s) {
    s = String(s == null ? '' : s);
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
    s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/g, '');
    s = s.replace(/[\u2028\u2029]/g, ' ');
    s = s.replace(/[\u00A0\u3000\t\r\n]+/g, ' ');
    return s.replace(/ {2,}/g, ' ').trim();
  }
  /* 按「码点」拆字，别用 charAt/slice —— emoji、生僻字是代理对，
     从中间切开就会拼出半个字符，渲染出来正是乱码 */
  function chars(s) {
    s = String(s == null ? '' : s);
    if (typeof Array.from === 'function') return Array.from(s);
    var out = [], i = 0;
    while (i < s.length) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) { out.push(s.substr(i, 2)); i += 2; }
      else { out.push(s.charAt(i)); i += 1; }
    }
    return out;
  }
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  function ellipsis(ctx, s, maxW) {
    s = clean(s);
    if (ctx.measureText(s).width <= maxW) return s;
    var arr = chars(s), out = '';
    for (var i = 0; i < arr.length; i++) {
      if (ctx.measureText(out + arr[i] + '…').width > maxW) break;
      out += arr[i];
    }
    return out + '…';
  }
  function wrap(ctx, s, maxW) {
    s = clean(s);
    var arr = chars(s);
    var lines = [], line = '';
    for (var i = 0; i < arr.length; i++) {
      var ch = arr[i];
      if (line && ctx.measureText(line + ch).width > maxW) { lines.push(line); line = ch; }
      else line += ch;
    }
    if (line) lines.push(line);
    return lines;
  }
  function zishu(s) { return chars(clean(s).replace(/ /g, '')).length; }

  /* 时间轴上把重叠的段分开画 */
  function lanesOf(items) {
    var arr = items.slice().sort(function (a, b) { return a.s - b.s || a.e - b.e; });
    var i = 0;
    while (i < arr.length) {
      var j = i, end = arr[i].e;
      while (j + 1 < arr.length && arr[j + 1].s < end) { j++; if (arr[j].e > end) end = arr[j].e; }
      var g = arr.slice(i, j + 1), laneEnds = [];
      g.forEach(function (it) {
        var put = false;
        for (var k = 0; k < laneEnds.length; k++) {
          if (laneEnds[k] <= it.s) { it.lane = k; laneEnds[k] = it.e; put = true; break; }
        }
        if (!put) { it.lane = laneEnds.length; laneEnds.push(it.e); }
      });
      var n = laneEnds.length;
      g.forEach(function (it) { it.lanes = n; });
      i = j + 1;
    }
    return arr;
  }

  /* 取出这一天要用到的图片地址（优先本机，其次云端；失败就当没有） */
  function collectImages(recs) {
    var metas = [];
    recs.forEach(function (r) {
      (r.entries || []).forEach(function (en) {
        (en.images || []).forEach(function (im) { if (im && im.id) metas.push(im); });
      });
    });
    return Promise.all(metas.map(function (m) {
      return A.imgStore.src(m).then(function (url) { return { id: m.id, url: url || '' }; })
        .catch(function () { return { id: m.id, url: '' }; });
    })).then(function (list) {
      var map = {};
      list.forEach(function (x) { if (x.url) map[x.id] = x.url; });
      return map;
    });
  }
  function loadImg(url) {
    return new Promise(function (res) {
      if (!url) return res(null);
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { res(null); };
      im.src = url;
    });
  }

  /* 主流程：返回 {canvas, filename} */
  function build(day) {
    day = day || U.dateStr();
    var recs = S.records().filter(function (r) { return !r.deleted && r.date === day; })
      .sort(function (a, b) { return (a.startTs || 0) - (b.startTs || 0); });
    if (!recs.length) return Promise.reject(new Error('这一天还没有记录'));
    /* 筛过分类之后可能一条都不剩，这时给一句能照着改的提示 */
    var selNow = S.settings().cardCats;
    if (selNow !== null && !recs.some(function (r) { return selNow.indexOf(r.categoryId || '') >= 0; })) {
      return Promise.reject(new Error('这一天在所选分类里还没有记录（设置 → 打卡长图里显示哪些分类）'));
    }

    return collectImages(recs).then(function (imgMap) {
      /* ---- 先把图都解码出来 ---- */
      var jobs = [];
      recs.forEach(function (r) {
        (r.entries || []).forEach(function (en) {
          (en.images || []).slice(0, 3).forEach(function (im) {
            jobs.push(loadImg(imgMap[im.id]).then(function (img) { im.__img = img; }));
          });
        });
      });
      return Promise.all(jobs).then(function () { return paint(day, recs); });
    });
  }

  function paint(day, recs) {
    /* ---- 只统计「设置 → 打卡长图里显示哪些分类」选中的那些；
            没选中的分类在时间轴上留成一条极淡的空白，不计入饼图和总时长 ---- */
    var sel = S.settings().cardCats;
    function shown(r) { return sel === null ? true : sel.indexOf(r.categoryId || '') >= 0; }

    /* 分类 → 任务 两级聚合（只算被选中的） */
    var gmap = {}, order = [];
    recs.forEach(function (r) {
      if (!shown(r)) return;
      var k = A.meta.catName(r.categoryId) || '未分类';
      if (!gmap[k]) {
        gmap[k] = { name: k, min: 0, segs: 0, imgs: 0, color: A.meta.recColor(r), tasks: {}, torder: [] };
        order.push(k);
      }
      var g = gmap[k];
      g.min += (r.minutes || 0); g.segs++;
      var tk = r.title || '（未命名）';
      if (!g.tasks[tk]) { g.tasks[tk] = { title: tk, min: 0, segs: 0, imgs: 0, recs: [] }; g.torder.push(tk); }
      var tt = g.tasks[tk];
      tt.min += (r.minutes || 0); tt.segs++;
      tt.imgs += (r.entries || []).reduce(function (s, en) { return s + ((en.images || []).length || 0); }, 0);
      tt.recs.push(r);
    });
    var groups = order.map(function (k) { return gmap[k]; }).sort(function (a, b) { return b.min - a.min; });
    groups.forEach(function (g) {
      g.tasks = g.torder.map(function (x) { return g.tasks[x]; }).sort(function (a, b) { return b.min - a.min; });
      delete g.torder;
      g.imgs = g.tasks.reduce(function (s, x) { return s + x.imgs; }, 0);
    });

    var totalMin = groups.reduce(function (s, g) { return s + g.min; }, 0);
    var segCount = groups.reduce(function (s, g) { return s + g.segs; }, 0);
    var imgCount = groups.reduce(function (s, g) { return s + g.imgs; }, 0);
    var allMin = recs.reduce(function (s, r) { return s + (r.minutes || 0); }, 0);

    /* 饼图按「项目（任务）」分块，不是按分类。
       每块会拉一条小引线出来，标上 任务名 / 科目 / 时长 / 占比。
       项目太多就取前 6 个，其余并成「其他」。 */
    var proj = [];
    groups.forEach(function (g) {
      g.tasks.forEach(function (t2) {
        var hit = null;
        for (var i = 0; i < proj.length; i++) if (proj[i].title === t2.title) { hit = proj[i]; break; }
        if (hit) { hit.min += t2.min; hit.segs += t2.segs; }
        else proj.push({ title: t2.title, cat: g.name, min: t2.min, segs: t2.segs });
      });
    });
    proj.sort(function (a, b) { return b.min - a.min; });

    var MAXP = 6;
    var slices = proj.slice(0, MAXP).map(function (x) {
      return { title: x.title, cat: x.cat, min: x.min, segs: x.segs };
    });
    if (proj.length > MAXP) {
      var restMin = proj.slice(MAXP).reduce(function (s, x) { return s + x.min; }, 0);
      slices = slices.concat([{ title: '其他 ' + (proj.length - MAXP) + ' 项', cat: '', min: restMin, segs: 0 }]);
    }
    /* 相邻块要能分清：按顺序取调色板的色，同一分类的几个项目才不会连成一片同色 */
    var PALETTE = ['#185FA5', '#0F6E56', '#993C1D', '#534AB7', '#854F0B', '#A32D2D', '#2F6F9F', '#6B7A8F'];
    slices.forEach(function (p, i) {
      p.color = PALETTE[i % PALETTE.length];
      p.frac = totalMin > 0 ? p.min / totalMin : 0;
    });

    var scratch = document.createElement('canvas');
    scratch.width = W; scratch.height = 10;
    var mc = scratch.getContext('2d');
    /* 量文字用的上下文必须和正文同一个字号，否则换行位置会算错（明细摘录是 22px） */
    mc.font = fnt(22);

    var ops = [];
    var y = 0;
    function push(fn) { ops.push(fn); }

    /* ---------- 头部 ---------- */
    y += PAD;
    var titleY = y;
    push(function (ctx) {
      ctx.fillStyle = C.ink; ctx.font = fnt(46, true);
      ctx.textBaseline = 'top';
      ctx.fillText('学习打卡 · ' + day + ' 周' + U.weekday(day), PAD, titleY);
    });
    y += 62;
    if (sel !== null) {
      var selY = y;
      var selLine = '只统计：' + (groups.length
        ? groups.map(function (g) { return g.name; }).join('、')
        : '（一个分类都没选，可在设置里调整）');
      push(function (ctx) {
        ctx.fillStyle = C.ink3; ctx.font = fnt(25); ctx.textBaseline = 'top';
        ctx.fillText(ellipsis(ctx, selLine, PW), PAD, selY);
      });
      y += 36;
    }
    y += 14;
    var lineY = y;
    push(function (ctx) {
      ctx.fillStyle = C.line; ctx.fillRect(PAD, lineY, PW, 2);
    });
    y += 30;

    /* ---------- 总时长 + 按项目的饼图（每块拉一条引线标注） ---------- */
    var PIE_R = 132;
    var cardTop = y;
    var cardPad = 26;
    var hasNote = (sel !== null && allMin > totalMin);
    var textH = hasNote ? 140 : 104;
    var cardH = cardPad + textH + 60 + PIE_R * 2 + cardPad;
    var pieCX = PAD + PW / 2;
    var pieCY = cardTop + cardPad + textH + 30 + PIE_R;
    var bigY = cardTop + cardPad;
    var cntY = cardTop + cardPad + 54;
    var allY = cardTop + cardPad + textH - 30;
    var TEXTW = Math.floor(PW / 2) - PIE_R - 76;

    push(function (ctx) {
      ctx.fillStyle = C.sunk; ctx.globalAlpha = 0.55;
      rr(ctx, PAD, cardTop, PW, cardH, 18); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.textBaseline = 'top';
      /* 总时长（大字）+ 段数 / 图数 */
      ctx.fillStyle = C.ink; ctx.font = fnt(72, true);
      var big = U.dur(totalMin);
      ctx.fillText(big, PAD + 32, bigY);
      var w0 = ctx.measureText(big).width;
      ctx.fillStyle = C.ink2; ctx.font = fnt(26);
      ctx.fillText(segCount + ' 段' + (imgCount ? '　·　' + imgCount + ' 张图' : ''), PAD + 44 + w0, cntY + 14);
      if (hasNote) {
        ctx.fillStyle = C.ink3; ctx.font = fnt(22);
        ctx.fillText('全天共 ' + U.dur(allMin) + '，另有 ' + U.dur(allMin - totalMin) + ' 不在所选分类', PAD + 34, allY);
      }

      /* 饼图本体 + 记录每块的引线落点 */
      var a0 = -Math.PI / 2;
      var laid = [];
      slices.forEach(function (p) {
        if (p.frac <= 0) return;
        var a1 = a0 + p.frac * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(pieCX, pieCY);
        ctx.arc(pieCX, pieCY, PIE_R, a0, a1); ctx.closePath();
        ctx.fillStyle = p.color; ctx.fill();
        ctx.strokeStyle = C.bg; ctx.lineWidth = 3; ctx.stroke();
        var mid = (a0 + a1) / 2;
        laid.push({
          p: p, mid: mid,
          side: Math.cos(mid) >= 0 ? 1 : -1,
          ly: pieCY + Math.sin(mid) * (PIE_R + 36)
        });
        a0 = a1;
      });
      if (!slices.length) {
        ctx.beginPath(); ctx.arc(pieCX, pieCY, PIE_R, 0, Math.PI * 2);
        ctx.fillStyle = C.line; ctx.fill();
      }
      /* 中间挖空：写「N 项 / 共 X」 */
      ctx.beginPath(); ctx.arc(pieCX, pieCY, PIE_R * 0.54, 0, Math.PI * 2);
      ctx.fillStyle = C.bg; ctx.fill();
      ctx.fillStyle = C.ink3; ctx.font = fnt(24);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(proj.length + ' 项', pieCX, pieCY - 13);
      ctx.font = fnt(21);
      ctx.fillText('共 ' + U.dur(totalMin), pieCX, pieCY + 17);
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';

      /* 同一侧的标注不能叠在一起：按 y 排好后强行拉开最小间距，再整体夹回卡片里 */
      var topLimit = cardTop + cardPad + textH + 34;
      var botLimit = cardTop + cardH - cardPad - 26;
      [1, -1].forEach(function (sd) {
        var list = laid.filter(function (x) { return x.side === sd; })
          .sort(function (p, q) { return p.ly - q.ly; });
        var GAP = 54;
        for (var i = 1; i < list.length; i++) {
          if (list[i].ly - list[i - 1].ly < GAP) list[i].ly = list[i - 1].ly + GAP;
        }
        if (list.length) {
          var over = list[list.length - 1].ly - botLimit;
          if (over > 0) for (var j = list.length - 1; j >= 0; j--) list[j].ly -= over;
          if (list[0].ly < topLimit) {
            var up = topLimit - list[0].ly;
            for (var k = 0; k < list.length; k++) list[k].ly += up;
          }
        }
      });

      /* 引线 + 两行标注：任务名 / 科目 · 时长 · 占比 */
      laid.forEach(function (x) {
        var p = x.p, sd = x.side;
        var ax = pieCX + Math.cos(x.mid) * PIE_R;
        var ay = pieCY + Math.sin(x.mid) * PIE_R;
        var bx = pieCX + sd * (PIE_R + 22);
        var tx = pieCX + sd * (PIE_R + 42);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, x.ly);
        ctx.lineTo(tx, x.ly);
        ctx.strokeStyle = p.color; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.textAlign = sd > 0 ? 'left' : 'right';
        ctx.fillStyle = C.ink; ctx.font = fnt(23, true);
        ctx.fillText(ellipsis(ctx, p.title, TEXTW), tx + sd * 8, x.ly - 28);
        var sub = (p.cat ? p.cat + ' · ' : '') + U.dur(p.min) + ' · ' + Math.round(p.frac * 100) + '%';
        ctx.fillStyle = C.ink3; ctx.font = fnt(21);
        ctx.fillText(ellipsis(ctx, sub, TEXTW), tx + sd * 8, x.ly - 2);
        ctx.textAlign = 'left';
      });
    });
    y = cardTop + cardH + 42;

    /* ---------- 时间轴 ---------- */
    var tlTop = y;
    var tlH = 24 * HOUR;
    push(function (ctx) {
      /* 轴线 */
      ctx.fillStyle = C.line;
      for (var h = 0; h <= 24; h++) {
        ctx.fillRect(PAD + AXIS, tlTop + h * HOUR, PW - AXIS, h === 24 ? 0 : 1);
      }
      ctx.fillStyle = C.ink3; ctx.font = fnt(22); ctx.textBaseline = 'middle';
      for (var h2 = 0; h2 < 24; h2++) {
        ctx.fillText(U.pad(h2) + ':00', PAD, tlTop + h2 * HOUR);
      }
      /* 分隔线 */
      ctx.fillStyle = C.line; ctx.fillRect(PAD + AXIS - 10, tlTop, 1, tlH);
    });

    var items = recs.map(function (r) {
      var s = r.startTs || 0;
      return { rec: r, s: s, e: (r.endTs && r.endTs > s) ? r.endTs : s + 60000, on: shown(r) };
    });
    /* 没被选中的分类：只留一条极淡的空白条，让人知道「这里本来有别的」 */
    items.filter(function (it) { return !it.on; }).forEach(function (it) {
      var d0 = new Date(it.s);
      var t0 = (d0.getHours() * 60 + d0.getMinutes()) / 60 * HOUR;
      var h0 = Math.max(6, (it.rec.minutes || 0) / 60 * HOUR);
      push(function (ctx) {
        ctx.fillStyle = C.sunk;
        rr(ctx, PAD + AXIS + 8, tlTop + t0, PW - AXIS - 16, h0, 5); ctx.fill();
      });
    });
    lanesOf(items.filter(function (it) { return it.on; })).forEach(function (it) {
      var d = new Date(it.s);
      var top = (d.getHours() * 60 + d.getMinutes()) / 60 * HOUR;
      var hgt = Math.max(6, (it.rec.minutes || 0) / 60 * HOUR);
      var lanes = it.lanes || 1;
      var each = (PW - AXIS) / lanes;
      var x = PAD + AXIS + 8 + it.lane * each;
      var w = each - 10;
      var color = A.meta.recColor(it.rec);
      push(function (ctx) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.22;
        rr(ctx, x, tlTop + top, w, hgt, 5); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        rr(ctx, x, tlTop + top, 4, hgt, 2); ctx.fill();
        if (hgt >= 26) {
          ctx.fillStyle = C.ink; ctx.font = fnt(21, true); ctx.textBaseline = 'top';
          ctx.save();
          ctx.beginPath(); ctx.rect(x + 10, tlTop + top, w - 14, hgt); ctx.clip();
          ctx.fillText(ellipsis(ctx, it.rec.title || '（未命名）', w - 20), x + 10, tlTop + top + 4);
          ctx.restore();
        }
      });
    });

    /* 「现在」的那条线（只有今天才画） */
    if (day === U.dateStr()) {
      var nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      push(function (ctx) {
        ctx.fillStyle = '#E24B4A';
        ctx.fillRect(PAD + AXIS, tlTop + nowMin / 60 * HOUR, PW - AXIS, 1);
      });
    }
    y = tlTop + tlH + 40;

    /* ---------- 这天做了什么（按分类分组：分类 → 任务 → 分次记录） ---------- */
    var secY = y;
    push(function (ctx) {
      ctx.fillStyle = C.ink3; ctx.font = fnt(26, true); ctx.textBaseline = 'top';
      ctx.fillText('这天做了什么', PAD, secY);
    });
    y += 50;

    if (!groups.length) {
      var emptyY = y;
      push(function (ctx) {
        ctx.fillStyle = C.ink3; ctx.font = fnt(26); ctx.textBaseline = 'top';
        ctx.fillText(sel === null ? '这一天还没有记录' : '所选分类里这一天还没有记录（可在设置 → 打卡长图里调整）', PAD, emptyY);
      });
      y += 46;
    }

    groups.forEach(function (g) {
      /* 分类标题行：分类名 …… 这一类总共多久 */
      var gTop = y;
      push(function (ctx) {
        ctx.textBaseline = 'top';
        ctx.fillStyle = C.ink; ctx.font = fnt(32, true);
        ctx.fillText(ellipsis(ctx, g.name, PW - 240), PAD, gTop);
        ctx.fillStyle = g.color; ctx.font = fnt(30, true);
        var gv = U.dur(g.min);
        ctx.fillText(gv, PAD + PW - ctx.measureText(gv).width, gTop + 2);
        ctx.fillStyle = C.line; ctx.fillRect(PAD, gTop + 46, PW, 1);
      });
      y = gTop + 62;

      g.tasks.forEach(function (t2) {
        /* 这个任务下面所有的分次记录，按时间排 */
        var ens = [];
        t2.recs.forEach(function (r) {
          (r.entries || []).slice().sort(function (a, b) { return (a.atTs || 0) - (b.atTs || 0); })
            .forEach(function (en) { ens.push(en); });
        });
        var bodyLines = [];
        var thumbs = [];
        ens.slice(0, 3).forEach(function (en) {
          var s2 = clean(en.text);
          if (s2) {
            /* 摘录别放太多字：长文先按字数砍一刀，再按宽度折行，最多两行
               （字数照原文算，让人知道本来有多少） */
            var CAP = 80;
            var carr = chars(s2);
            var cut = carr.length > CAP;
            var shown = cut ? carr.slice(0, CAP).join('') : s2;
            mc.font = fnt(22);                       /* 量宽度必须和真正画出来的字号一致 */
            var ls = wrap(mc, shown, PW - 40);
            bodyLines.push({ at: clean(en.at), lines: ls.slice(0, 2), n: zishu(s2), more: cut || ls.length > 2 });
          } else if ((en.images || []).length) {
            bodyLines.push({ at: clean(en.at), lines: [], n: 0, more: false });
          }
          (en.images || []).forEach(function (im) {
            if (thumbs.length < 3 && im.__img) thumbs.push(im.__img);
          });
        });

        var top = y;
        /* 只有一段就写起止时间，多段就写「N 段」 */
        var meta = (t2.segs > 1) ? (t2.segs + ' 段') : (t2.recs[0].start + '–' + t2.recs[0].end);

        push(function (ctx) {
          ctx.textBaseline = 'top';
          ctx.fillStyle = g.color;
          rr(ctx, PAD + 8, top + 13, 5, 22, 2); ctx.fill();
          ctx.fillStyle = C.ink; ctx.font = fnt(28, true);
          ctx.fillText(ellipsis(ctx, t2.title, PW - 360), PAD + 26, top + 9);
          var right = meta + '　' + U.dur(t2.min);
          ctx.fillStyle = C.ink2; ctx.font = fnt(25);
          ctx.fillText(right, PAD + PW - ctx.measureText(right).width, top + 12);
        });

        var yy = top + 46;
        bodyLines.forEach(function (b) {
          push(function (ctx) {
            ctx.textBaseline = 'top';
            if (b.at) {
              ctx.fillStyle = C.teal; ctx.font = fnt(21, true);
              ctx.fillText(b.at, PAD + 26, yy);
            }
            if (b.n) {
              ctx.fillStyle = C.ink3; ctx.font = fnt(20);
              var label = b.n + ' 字';
              ctx.fillText(label, PAD + PW - 26 - ctx.measureText(label).width, yy + 1);
            }
            ctx.fillStyle = C.ink2; ctx.font = fnt(22);
            b.lines.forEach(function (ln, i) {
              ctx.fillText(ln + (b.more && i === b.lines.length - 1 ? ' …' : ''), PAD + 26, yy + 26 + i * 28);
            });
          });
          yy += 24 + b.lines.length * 28 + (b.lines.length ? 6 : 0);
        });
        if (ens.length > 3) {
          push(function (ctx) {
            ctx.fillStyle = C.ink3; ctx.font = fnt(21); ctx.textBaseline = 'top';
            ctx.fillText('（这个任务还有 ' + (ens.length - 3) + ' 次记录，这里只放前 3 次）', PAD + 26, yy);
          });
          yy += 28;
        }
        thumbs.forEach(function (img, i) {
          var x = PAD + 26 + i * (THUMB + 12);
          var ty = yy + 8;
          push(function (ctx) {
            ctx.save();
            rr(ctx, x, ty, THUMB, THUMB, 10); ctx.clip();
            var sc = Math.max(THUMB / img.width, THUMB / img.height);
            var dw = img.width * sc, dh = img.height * sc;
            ctx.drawImage(img, x + (THUMB - dw) / 2, ty + (THUMB - dh) / 2, dw, dh);
            ctx.restore();
          });
        });
        if (thumbs.length) yy += THUMB + 12;

        y = yy + 14;
      });
      y += 16;
    });

    y += PAD - 30;
    if (y < 600) y = 600;

    /* ---------- 真正画 ---------- */
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = Math.round(y);
    var ctx = cv.getContext('2d');
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ops.forEach(function (fn) { fn(ctx); });

    return { canvas: cv, filename: '学习打卡-' + day + '.png' };
  }

  /* 导出（下载） */
  function exportDay(day) {
    return build(day).then(function (res) {
      return new Promise(function (resolve, reject) {
        if (!res.canvas.toBlob) { reject(new Error('这个浏览器不支持导出图片')); return; }
        res.canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error('图片生成失败')); return; }
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url; a.download = res.filename;
          document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 800);
          resolve(res.filename);
        }, 'image/png');
      });
    });
  }

  A.card = { build: build, exportDay: exportDay, zishu: zishu };
})(window);
