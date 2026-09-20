/* card.js — 把某一天画成一张「打卡长图」（纯 Canvas，无第三方库、无外链）
   图内包含：当天时间轴 + 逐条记录 + 每条记录里分次写的内容（摘录 + 字数）+ 图片缩略图 */
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
    var totalMin = recs.reduce(function (s, r) { return s + (r.minutes || 0); }, 0);
    var imgCount = 0;
    recs.forEach(function (r) {
      (r.entries || []).forEach(function (en) { imgCount += ((en.images || []).length ? (en.images || []).length : 0); });
    });

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
    var subY = y;
    var sub = '共 ' + U.dur(totalMin) + '　·　' + recs.length + ' 段' + (imgCount ? '　·　' + imgCount + ' 张图' : '');
    push(function (ctx) {
      ctx.fillStyle = C.ink2; ctx.font = fnt(30);
      ctx.textBaseline = 'top';
      ctx.fillText(sub, PAD, subY);
    });
    y += 46;
    var lineY = y;
    push(function (ctx) {
      ctx.fillStyle = C.line; ctx.fillRect(PAD, lineY, PW, 2);
    });
    y += 34;

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
      return { rec: r, s: s, e: (r.endTs && r.endTs > s) ? r.endTs : s + 60000 };
    });
    lanesOf(items).forEach(function (it) {
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

    /* ---------- 逐条记录 ---------- */
    var secY = y;
    push(function (ctx) {
      ctx.fillStyle = C.ink3; ctx.font = fnt(26, true); ctx.textBaseline = 'top';
      ctx.fillText('这天做了什么', PAD, secY);
    });
    y += 46;

    recs.forEach(function (r, idx) {
      var ens = (r.entries || []).slice().sort(function (a, b) { return (a.atTs || 0) - (b.atTs || 0); });
      /* 先算这块有多高 */
      var bodyLines = [];
      var thumbs = [];
      ens.slice(0, 3).forEach(function (en) {
        var t = String(en.text || '').trim();
        if (t) {
          var ls = wrap(mc, t, PW - 34).slice(0, 2);
          bodyLines.push({ at: en.at || '', lines: ls, n: zishu(t), more: wrap(mc, t, PW - 34).length > 2 });
        } else if ((en.images || []).length) {
          bodyLines.push({ at: en.at || '', lines: [], n: 0, more: false });
        }
        (en.images || []).forEach(function (im) {
          if (thumbs.length < 3 && im.__img) thumbs.push(im.__img);
        });
      });
      var hHead = 40 + 34 + 30;                                  /* 时间行 + 任务名 + 分类标签行 */
      var hBody = bodyLines.reduce(function (s, b) { return s + 26 + b.lines.length * 34 + (b.lines.length ? 8 : 0); }, 0);
      var hThumb = thumbs.length ? THUMB + 16 : 0;
      var hMore = ens.length > 3 ? 30 : 0;
      var hCard = hHead + hBody + hThumb + hMore + 26;

      var top = y;
      var color = A.meta.recColor(r);
      var cat = [A.meta.catName(r.categoryId)].concat(A.meta.tagNames(r.tagIds)).filter(Boolean).join(' · ') || '未分类';

      push(function (ctx) {
        ctx.fillStyle = C.sunk; ctx.globalAlpha = 0.55;
        rr(ctx, PAD, top + 4, PW, hCard, 16); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        rr(ctx, PAD, top + 4, 6, hCard, 3); ctx.fill();
        ctx.textBaseline = 'top';
        /* 序号 + 时间 + 时长 */
        ctx.fillStyle = C.ink3; ctx.font = fnt(24);
        ctx.fillText('#' + (idx + 1), PAD + 24, top + 22);
        ctx.fillStyle = color; ctx.font = fnt(28, true);
        ctx.fillText(r.start + '–' + r.end + '　' + U.dur(r.minutes), PAD + 80, top + 18);
        /* 任务名 */
        ctx.fillStyle = C.ink; ctx.font = fnt(36, true);
        ctx.fillText(ellipsis(ctx, r.title || '（未命名）', PW - 48), PAD + 24, top + 58);
        /* 分类标签 */
        ctx.fillStyle = C.ink3; ctx.font = fnt(24);
        ctx.fillText(ellipsis(ctx, cat, PW - 48), PAD + 24, top + 104);
      });

      var yy = top + hHead;
      bodyLines.forEach(function (b) {
        push(function (ctx) {
          ctx.textBaseline = 'top';
          if (b.at) {
            ctx.fillStyle = C.teal; ctx.font = fnt(23, true);
            ctx.fillText(b.at, PAD + 24, yy);
          }
          if (b.n) {
            ctx.fillStyle = C.ink3; ctx.font = fnt(22);
            var label = b.n + ' 字';
            ctx.fillText(label, PAD + PW - 24 - ctx.measureText(label).width, yy + 1);
          }
          ctx.fillStyle = C.ink2; ctx.font = fnt(26);
          b.lines.forEach(function (ln, i) {
            ctx.fillText(ln + (b.more && i === b.lines.length - 1 ? ' …' : ''), PAD + 24, yy + 30 + i * 34);
          });
        });
        yy += 26 + b.lines.length * 34 + (b.lines.length ? 8 : 0);
      });
      if (ens.length > 3) {
        push(function (ctx) {
          ctx.fillStyle = C.ink3; ctx.font = fnt(23); ctx.textBaseline = 'top';
          ctx.fillText('（这条还有 ' + (ens.length - 3) + ' 次记录，这里只放前 3 次）', PAD + 24, yy);
        });
        yy += 30;
      }
      thumbs.forEach(function (img, i) {
        var x = PAD + 24 + i * (THUMB + 14);
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

      y = top + hCard + 16;
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
