/* export.js — 两份结构化资料：节点视图（时间导向）/ 自然视图（任务导向） */
(function (root) {
  'use strict';
  var A = root.App = root.App || {};
  var U = A.util;

  var MIN = 60000;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function hmOfTs(ts) {
    var d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function tsOf(dateStr, hm) {
    var p = String(dateStr).split('-');
    var t = U.parseHm(hm);
    if (t == null) return 0;
    return new Date(+p[0], +p[1] - 1, +p[2], Math.floor(t / 60), t % 60, 0, 0).getTime();
  }
  function inRange(rec, range) {
    if (!range) return true;
    var d = rec.date;
    if (!d) return false;
    if (range.mode === 'all') return true;
    if (range.mode === 'day') return d === range.day;
    if (range.mode === 'range') return d >= range.from && d <= range.to;
    return true;
  }
  function dayLabel(dateStr) {
    return dateStr + ' 周' + U.weekday(dateStr);
  }

  /* ---------- 标签文字 ---------- */
  function tagsText(rec) {
    var parts = [];
    var c = A.meta.catName(rec.categoryId);
    if (c) parts.push('分类：' + c);
    var t = A.meta.tagNames(rec.tagIds);
    if (t.length) parts.push('标签：' + t.join('、'));
    return parts.join(' ｜ ');
  }

  /* ---------- 资料一：节点视图（以时间为导向，把任务切开） ---------- */
  function nodeDump(records, range) {
    var list = records.filter(function (r) { return !r.deleted && inRange(r, range); })
      .slice().sort(function (a, b) { return (a.startTs || 0) - (b.startTs || 0); });
    if (!list.length) return '# 节点视图\n\n（该范围内没有记录）\n';

    var days = {};
    list.forEach(function (r) { (days[r.date] = days[r.date] || []).push(r); });

    var out = ['# 节点视图 · 以时间为导向，把任务切开', ''];

    Object.keys(days).sort().forEach(function (date) {
      var recs = days[date];
      var minTs = Infinity, maxTs = -Infinity;
      recs.forEach(function (r) {
        if (r.startTs) minTs = Math.min(minTs, r.startTs);
        if (r.endTs) maxTs = Math.max(maxTs, r.endTs);
      });
      if (!isFinite(minTs)) return;
      var hFrom = new Date(minTs).getHours();
      var hTo = new Date(maxTs - 1).getHours();

      out.push('## ' + dayLabel(date));
      out.push('');

      for (var h = hFrom; h <= hTo; h++) {
        var hs = tsOf(date, pad2(h) + ':00');
        var he = hs + 3600000;
        var lines = [];
        var entries = [];

        recs.forEach(function (r) {
          var s = Math.max(r.startTs || hs, hs);
          var e = Math.min(r.endTs || hs, he);
          if (e > s) {
            var cross = ((r.startTs || 0) < hs) || ((r.endTs || 0) > he);
            lines.push('  ' + hmOfTs(s) + '–' + hmOfTs(e === he ? he : e) + '  ' +
              (r.title || '（未命名）') + '   ' + U.dur(Math.round((e - s) / MIN)) +
              '   ← 任务 ' + r.start + '–' + r.end + (cross ? '（跨节点）' : ''));
          }
          (r.entries || []).forEach(function (en) {
            var ts = en.atTs || tsOf(date, en.at);
            if (ts >= hs && ts < he) entries.push({ rec: r, en: en, ts: ts });
          });
        });

        out.push('【' + pad2(h) + ':00–' + pad2(h + 1) + ':00】');
        if (!lines.length && !entries.length) {
          out.push('  （空）');
        } else {
          lines.forEach(function (l) { out.push(l); });
          entries.sort(function (a, b) { return a.ts - b.ts; }).forEach(function (x) {
            out.push('    · ' + hmOfTs(x.ts) + ' 记录（' + x.rec.title +
              (x.en.text ? '）：' + oneLine(x.en.text) : '）'));
            if (x.en.images && x.en.images.length) {
              out.push('      图：' + x.en.images.map(function (i) { return i.name; }).join('、'));
            }
          });
        }
        out.push('');
      }
    });
    return out.join('\n');
  }

  function oneLine(s) {
    return String(s || '').replace(/\s*\n+\s*/g, ' / ').trim();
  }

  /* ---------- 资料二：自然视图（以任务为导向，把时间切开） ---------- */
  function naturalDump(records, range) {
    var list = records.filter(function (r) { return !r.deleted && inRange(r, range); })
      .slice().sort(function (a, b) { return (a.startTs || 0) - (b.startTs || 0); });
    if (!list.length) return '# 自然视图\n\n（该范围内没有记录）\n';

    var days = {};
    list.forEach(function (r) { (days[r.date] = days[r.date] || []).push(r); });

    var out = ['# 自然视图 · 以任务为导向，把时间切开', ''];

    Object.keys(days).sort().forEach(function (date) {
      var recs = days[date].filter(function (r) { return r.startTs && r.endTs; })
        .sort(function (a, b) { return a.startTs - b.startTs; });
      if (!recs.length) return;
      out.push('## ' + dayLabel(date));
      out.push('');

      var cursor = recs[0].startTs;
      recs.forEach(function (r) {
        if (r.startTs > cursor) {
          var gap = Math.round((r.startTs - cursor) / MIN);
          if (gap >= 1) out.push(hmOfTs(cursor) + '–' + hmOfTs(r.startTs) + '　空　' + U.dur(gap));
          out.push('');
        }
        out.push(r.start + '–' + r.end + '　' + (r.title || '（未命名）') + '　' +
          U.dur(r.minutes || Math.round((r.endTs - r.startTs) / MIN)));
        var tt = tagsText(r);
        if (tt) out.push('  ' + tt);

        var ens = (r.entries || []).slice().sort(function (a, b) {
          return (a.atTs || 0) - (b.atTs || 0);
        });
        ens.forEach(function (en) {
          var ts = en.atTs || tsOf(date, en.at);
          var slot = ts ? (new Date(ts).getHours() + '点') : '';
          var line = '  · ' + (en.at || hmOfTs(ts)) + (slot ? '（' + slot + '）' : '') + '　';
          line += en.text ? '「' + oneLine(en.text) + '」' : '（无文字）';
          if (en.images && en.images.length) {
            line += '　图：' + en.images.map(function (i) { return i.name; }).join('、');
          }
          out.push(line);
        });
        out.push('');
        cursor = Math.max(cursor, r.endTs);
      });
    });
    return out.join('\n');
  }

  /* ---------- JSON ---------- */
  function jsonDump(records, range) {
    var list = records.filter(function (r) { return !r.deleted && inRange(r, range); })
      .slice().sort(function (a, b) { return (a.startTs || 0) - (b.startTs || 0); });
    var cats = {};
    A.store.settings().categories.forEach(function (c) { cats[c.id] = c.name; });
    var tags = {};
    A.store.settings().tags.forEach(function (t) { tags[t.id] = t.name; });
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      range: range,
      categoryNames: cats,
      tagNames: tags,
      records: list
    }, null, 2);
  }

  /* ---------- 范围 ---------- */
  function resolveRange(opt) {
    opt = opt || {};
    if (opt.mode === 'all') return { mode: 'all', label: '全部' };
    if (opt.mode === 'today') {
      var d = U.dateStr();
      return { mode: 'day', day: d, label: '今日 ' + d };
    }
    if (opt.mode === 'yesterday') {
      var y = new Date(); y.setDate(y.getDate() - 1);
      var ds = U.dateStr(y);
      return { mode: 'day', day: ds, label: '昨日 ' + ds };
    }
    if (opt.mode === 'day') return { mode: 'day', day: opt.day, label: opt.day };
    return { mode: 'range', from: opt.from, to: opt.to, label: opt.from + ' ~ ' + opt.to };
  }

  function fileBase(range) {
    if (range.mode === 'all') return '全部';
    if (range.mode === 'day') return range.day;
    return range.from + '_' + range.to;
  }

  A.exporter = {
    nodeDump: nodeDump,
    naturalDump: naturalDump,
    jsonDump: jsonDump,
    resolveRange: resolveRange,
    inRange: inRange,
    fileBase: fileBase
  };
})(window);
