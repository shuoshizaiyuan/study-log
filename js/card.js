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
  var THUMB = 150;              /* 缩略图边长 */
  var C = {
    bg: '#FFFFFF', ink: '#1B2130', ink2: '#5C6678', ink3: '#8D96A6',
    line: '#E6EAF1', sunk: '#EEF2F7', blue: '#185FA5', blueL: '#E6F1FB', teal: '#0F6E56'
  };
  function fnt(sz, bold) {
    return (bold ? '600 ' : '400 ') + sz + 'px -apple-system,"PingFang SC","Microsoft YaHei",system-ui,sans-serif';
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
    s = String(s == null ? '' : s);
    if (ctx.measureText(s).width <= maxW) return s;
    var out = s;
    while (out.length > 1 && ctx.measureText(out + '…').width > maxW) out = out.slice(0, -1);
    return out + '…';
  }
  function wrap(ctx, s, maxW) {
    s = String(s == null ? '' : s);
    var lines = [], line = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === '\n') { lines.push(line); line = ''; continue; }
      if (line && ctx.measureText(line + ch).width > maxW) { lines.push(line); line = ch; }
      else line += ch;
    }
    if (line) lines.push(line);
    return lines;
  }
  function zishu(s) { return String(s == null ? '' : s).replace(/\s+/g, '').length; }

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

    /* 饼图数据：最多 6 块，多出来的并成「其他」 */
    var legend = groups.map(function (g) { return { name: g.name, min: g.min, color: g.color }; });
    if (legend.length > 6) {
      var restMin = legend.slice(6).reduce(function (s, x) { return s + x.min; }, 0);
      legend = legend.slice(0, 6).concat([{ name: '其他 ' + (groups.length - 6) + ' 类', min: restMin, color: C.ink3 }]);
    }
    legend.forEach(function (p) { p.frac = totalMin > 0 ? p.min / totalMin : 0; });

    var scratch = document.createElement('canvas');
    scratch.width = W; scratch.height = 10;
    var mc = scratch.getContext('2d');
    /* 量文字用的上下文必须和正文同一个字号，否则换行位置会算错 */
    mc.font = fnt(26);

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

    /* ---------- 总时长 + 饼图 ---------- */
    var PIE_R = 92;
    var cardTop = y;
    var pieCX = PAD + PW - PIE_R - 32;
    var pieCY = cardTop + 36 + PIE_R;
    var baseH = PIE_R * 2 + 76;
    var lgPerRow = 3;
    var lgCell = Math.floor((PW - 60) / lgPerRow);
    var lgRows = legend.length ? Math.ceil(legend.length / lgPerRow) : 1;
    var cardH = baseH + lgRows * 46 + 14;
    var bigY = cardTop + 34;
    var cntY = cardTop + 128;
    var allY = cardTop + 170;

    push(function (ctx) {
      ctx.fillStyle = C.sunk; ctx.globalAlpha = 0.55;
      rr(ctx, PAD, cardTop, PW, cardH, 18); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.textBaseline = 'top';
      /* 总时长（大字） */
      ctx.fillStyle = C.ink; ctx.font = fnt(72, true);
      ctx.fillText(U.dur(totalMin), PAD + 32, bigY);
      ctx.fillStyle = C.ink2; ctx.font = fnt(27);
      ctx.fillText(segCount + ' 段' + (imgCount ? '　·　' + imgCount + ' 张图' : ''), PAD + 34, cntY);
      if (sel !== null && allMin > totalMin) {
        ctx.fillStyle = C.ink3; ctx.font = fnt(23);
        ctx.fillText('全天共 ' + U.dur(allMin) + '，另有 ' + U.dur(allMin - totalMin) + ' 不在所选分类', PAD + 34, allY);
      }
      /* 饼图（甜甜圈） */
      var a0 = -Math.PI / 2;
      legend.forEach(function (p) {
        if (p.frac <= 0) return;
        var a1 = a0 + p.frac * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(pieCX, pieCY);
        ctx.arc(pieCX, pieCY, PIE_R, a0, a1); ctx.closePath();
        ctx.fillStyle = p.color; ctx.fill();
        ctx.strokeStyle = C.bg; ctx.lineWidth = 3; ctx.stroke();
        a0 = a1;
      });
      if (!legend.length) {
        ctx.beginPath(); ctx.arc(pieCX, pieCY, PIE_R, 0, Math.PI * 2);
        ctx.fillStyle = C.line; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(pieCX, pieCY, PIE_R * 0.58, 0, Math.PI * 2);
      ctx.fillStyle = C.bg; ctx.fill();
      ctx.fillStyle = C.ink3; ctx.font = fnt(22);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(legend.length + ' 类', pieCX, pieCY);
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      /* 图例 */
      var lgTop = cardTop + baseH + 8;
      legend.forEach(function (p, i) {
        var cx = PAD + 30 + (i % lgPerRow) * lgCell;
        var cy = lgTop + Math.floor(i / lgPerRow) * 46;
        ctx.fillStyle = p.color;
        rr(ctx, cx, cy + 8, 18, 18, 5); ctx.fill();
        ctx.fillStyle = C.ink2; ctx.font = fnt(24);
        ctx.fillText(ellipsis(ctx, p.name, lgCell - 178), cx + 28, cy + 7);
        ctx.fillStyle = C.ink3; ctx.font = fnt(23);
        var rt = U.dur(p.min) + '  ' + Math.round(p.frac * 100) + '%';
        ctx.fillText(rt, cx + lgCell - 30 - ctx.measureText(rt).width, cy + 8);
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
          var s2 = String(en.text || '').trim();
          if (s2) {
            var ls = wrap(mc, s2, PW - 40);
            bodyLines.push({ at: en.at || '', lines: ls.slice(0, 2), n: zishu(s2), more: ls.length > 2 });
          } else if ((en.images || []).length) {
            bodyLines.push({ at: en.at || '', lines: [], n: 0, more: false });
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
              ctx.fillStyle = C.teal; ctx.font = fnt(23, true);
              ctx.fillText(b.at, PAD + 26, yy);
            }
            if (b.n) {
              ctx.fillStyle = C.ink3; ctx.font = fnt(22);
              var label = b.n + ' 字';
              ctx.fillText(label, PAD + PW - 26 - ctx.measureText(label).width, yy + 1);
            }
            ctx.fillStyle = C.ink2; ctx.font = fnt(26);
            b.lines.forEach(function (ln, i) {
              ctx.fillText(ln + (b.more && i === b.lines.length - 1 ? ' …' : ''), PAD + 26, yy + 30 + i * 34);
            });
          });
          yy += 26 + b.lines.length * 34 + (b.lines.length ? 8 : 0);
        });
        if (ens.length > 3) {
          push(function (ctx) {
            ctx.fillStyle = C.ink3; ctx.font = fnt(23); ctx.textBaseline = 'top';
            ctx.fillText('（这个任务还有 ' + (ens.length - 3) + ' 次记录，这里只放前 3 次）', PAD + 26, yy);
          });
          yy += 30;
        }
        thumbs.forEach(function (img, i) {
          var x = PAD + 26 + i * (THUMB + 14);
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
        if (thumbs.length) yy += THUMB + 16;

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
