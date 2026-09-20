/* view-dashboard.js — 总览：当天 / 月总览 两个口径，都在本页内切换 */
(function (root) {
  'use strict';
  var A = root.App = root.App || {};
  var U = A.util, S = A.store;
  A.views = A.views || {};

  function monthOfDay(ds) { return String(ds || '').slice(0, 7); }

  function statsFor(records) {
    var total = 0, byCat = {}, byDay = {}, days = {}, segs = 0;
    records.forEach(function (r) {
      if (r.deleted) return;
      total += r.minutes || 0;
      segs++;
      var k = A.meta.catName(r.categoryId) || '未分类';
      byCat[k] = (byCat[k] || 0) + (r.minutes || 0);
      byDay[r.date] = (byDay[r.date] || 0) + (r.minutes || 0);
      days[r.date] = 1;
    });
    return { total: total, byCat: byCat, byDay: byDay, dayCount: Object.keys(days).length, segs: segs };
  }

  function catBars(byCat) {
    var keys = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
    if (!keys.length) return '<div class="hint" style="margin:0">还没有记录</div>';
    var maxv = byCat[keys[0]] || 1;
    return keys.map(function (k) {
      var v = byCat[k];
      return '<div style="padding:6px 0">' +
        '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px">' +
        '<span>' + U.esc(k) + '</span><span style="color:var(--ink2);font-variant-numeric:tabular-nums">' +
        U.dur(v) + '</span></div>' +
        '<div style="height:6px;border-radius:4px;background:var(--sunk);overflow:hidden">' +
        '<div style="height:100%;width:' + Math.max(3, Math.round(v / maxv * 100)) + '%;background:var(--blue)"></div></div></div>';
    }).join('');
  }

  /* 当天：一条 24 小时的横条 */
  function dayBar(dayRecs) {
    var bands = dayRecs.map(function (r) {
      var s = new Date(r.startTs || 0);
      var startMin = s.getHours() * 60 + s.getMinutes();
      var m = Math.max(2, r.minutes || 0);
      return '<div class="db" style="left:' + (startMin / 1440 * 100) + '%;width:' +
        Math.max(0.6, m / 1440 * 100) + '%;background:' + A.meta.recColor(r) +
        '" title="' + U.esc((r.title || '') + ' ' + r.start + '–' + r.end) + '"></div>';
    }).join('');
    return '<div class="daybar">' + bands +
      '<div class="dbtick" style="left:25%"></div><div class="dbtick" style="left:50%"></div>' +
      '<div class="dbtick" style="left:75%"></div></div>' +
      '<div class="daylbl"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>';
  }

  function calendar(cur, byDay, today, dashDay) {
    var y = +cur.slice(0, 4), mo = +cur.slice(5, 7) - 1;
    var startDow = new Date(y, mo, 1).getDay();
    var days = new Date(y, mo + 1, 0).getDate();
    var html = '<div class="cal">';
    ['日', '一', '二', '三', '四', '五', '六'].forEach(function (w) { html += '<div class="cw">' + w + '</div>'; });
    for (var p = 0; p < startDow; p++) html += '<div class="cd pad"></div>';
    for (var dd = 1; dd <= days; dd++) {
      var ds = cur + '-' + U.pad(dd);
      var has = (byDay[ds] || 0) > 0;
      var cls = 'cd' + (has ? ' has' : '') + (ds === today ? ' today' : '') + (ds === dashDay ? ' sel' : '');
      html += '<div class="' + cls + '" data-cal="' + ds + '">' + dd + '</div>';
    }
    html += '</div>';
    return html;
  }

  function render() {
    var main = document.getElementById('main');
    var today = U.dateStr();
    var mode = A.state.dashMode || 'day';
    var dashDay = A.state.dashDay || today;
    var cur = A.state.dashMonth || monthOfDay(dashDay);
    if (monthOfDay(dashDay) !== cur) cur = monthOfDay(dashDay);

    var all = S.records().filter(function (r) { return !r.deleted; });
    var live = S.running();
    var liveMin = (live && live.date === today) ? U.minutesBetween(live.startTs, Date.now()) : 0;

    var html = '<div class="view">';

    /* 口径切换 */
    html += '<div class="row" style="padding:12px 16px 0;gap:8px">' +
      '<button class="btn sm' + (mode === 'day' ? ' primary' : '') + '" data-dmode="day">当天</button>' +
      '<button class="btn sm' + (mode === 'month' ? ' primary' : '') + '" data-dmode="month">月总览</button>' +
      '<span style="flex:1"></span>' +
      '<button class="btn sm ghost" data-open-tl>在时间轴里看这天</button></div>';

    if (mode === 'day') {
      /* ---------- 当天 ---------- */
      var dayRecs = all.filter(function (r) { return r.date === dashDay; })
        .sort(function (a, b) { return (a.startTs || 0) - (b.startTs || 0); });
      var dayMin = dayRecs.reduce(function (s, r) { return s + (r.minutes || 0); }, 0);
      if (dashDay === today) dayMin += liveMin;

      html += '<div class="sec-title" style="display:flex;align-items:center;justify-content:space-between">' +
        '<span style="font-size:13px;color:var(--ink2)">' + U.esc(dashDay) + ' 周' + U.weekday(dashDay) +
        (dashDay === today ? '（今天）' : '') + '</span><span>' +
        '<button class="btn sm ghost" data-dd="-1" style="height:26px">◀</button>' +
        '<button class="btn sm ghost" data-dd="1" style="height:26px;margin-left:6px">▶</button></span></div>';

      html += '<div class="stat-grid" style="padding-top:0">' +
        '<div class="stat"><div class="sl">这天总时长</div><div class="sv">' + U.dur(dayMin) + '</div></div>' +
        '<div class="stat"><div class="sl">段数</div><div class="sv">' + dayRecs.length + '</div></div>' +
        '</div>';

      html += '<div class="card tight" style="margin-top:0"><h3>这天的时间轴</h3>' + dayBar(dayRecs) + '</div>';

      var dstat = statsFor(dayRecs);
      if (dashDay === today && live && live.date === today) {
        var k0 = A.meta.catName(live.categoryId) || '未分类';
        dstat.byCat[k0] = (dstat.byCat[k0] || 0) + liveMin;
      }
      html += '<div class="card tight"><h3>这天的分类投入</h3>' + catBars(dstat.byCat) + '</div>';

      html += '<div class="sec-title">这天的每一段</div>';
      if (!dayRecs.length && !(dashDay === today && liveMin)) {
        html += '<div class="empty">这天还没有记录</div>';
      } else {
        html += '<div class="card tight">';
        dayRecs.forEach(function (r) {
          var cat = [A.meta.catName(r.categoryId)].concat(A.meta.tagNames(r.tagIds)).filter(Boolean).join(' · ') || '未分类';
          html += '<div class="list-row" style="padding:10px 0;border-bottom:1px solid var(--line)">' +
            '<div style="min-width:0">' +
            '<div class="lr-t">' + U.esc(r.title || '（未命名）') + '</div>' +
            '<div class="lr-s">' + U.esc(r.start + '–' + r.end + '　' + cat) +
            ((r.entries && r.entries.length) ? '　· ' + r.entries.length + ' 条记录' : '') + '</div></div>' +
            '<span style="white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--ink2);font-size:13px">' +
            U.dur(r.minutes) + '</span></div>';
        });
        if (dashDay === today && live && live.date === today) {
          html += '<div class="list-row" style="padding:10px 0;border-bottom:none">' +
            '<div style="min-width:0"><div class="lr-t" style="color:var(--blue)">' +
            U.esc(live.title || '（未命名）') + '　· 进行中</div>' +
            '<div class="lr-s">' + U.hhmm(live.startTs) + ' 开始</div></div>' +
            '<span style="white-space:nowrap;color:var(--blue);font-variant-numeric:tabular-nums;font-size:13px">' +
            U.dur(liveMin) + '</span></div>';
        }
        html += '</div>';
      }
    } else {
      /* ---------- 月总览 ---------- */
      var monthRecs = all.filter(function (r) { return monthOfDay(r.date) === cur; });
      var mst = statsFor(monthRecs);
      var y = +cur.slice(0, 4), mo = +cur.slice(5, 7);
      var days = new Date(y, mo, 0).getDate();
      var mtotal = mst.total + (monthOfDay(today) === cur ? liveMin : 0);

      html += '<div class="sec-title" style="display:flex;align-items:center;justify-content:space-between">' +
        '<span style="font-size:13px;color:var(--ink2)">' + cur + '</span><span>' +
        '<button class="btn sm ghost" data-m="-1" style="height:26px">◀</button>' +
        '<button class="btn sm ghost" data-m="1" style="height:26px;margin-left:6px">▶</button></span></div>';

      html += '<div class="stat-grid" style="padding-top:0">' +
        '<div class="stat"><div class="sl">本月总时长</div><div class="sv">' + U.dur(mtotal) + '</div></div>' +
        '<div class="stat"><div class="sl">有记录的天数</div><div class="sv">' + mst.dayCount + ' / ' + days + '</div></div>' +
        '<div class="stat"><div class="sl">日均（按有记录的天）</div><div class="sv">' +
        (mst.dayCount ? U.dur(Math.round(mtotal / mst.dayCount)) : '—') + '</div></div>' +
        '<div class="stat"><div class="sl">段数</div><div class="sv">' + mst.segs + '</div></div>' +
        '</div>';

      /* 每天一根柱 */
      html += '<div class="card tight"><h3>每天投入</h3><div class="mbars">';
      var maxv = 1;
      for (var d = 1; d <= days; d++) {
        var ds = cur + '-' + U.pad(d);
        var v = mst.byDay[ds] || 0;
        if (ds === today) v += liveMin;
        if (v > maxv) maxv = v;
      }
      for (var d2 = 1; d2 <= days; d2++) {
        var ds2 = cur + '-' + U.pad(d2);
        var v2 = mst.byDay[ds2] || 0;
        if (ds2 === today) v2 += liveMin;
        var hh = v2 ? Math.max(4, Math.round(v2 / maxv * 76)) : 2;
        html += '<div class="mb' + (v2 ? ' has' : '') + (ds2 === dashDay ? ' sel' : '') +
          '" data-cal="' + ds2 + '" title="' + U.esc(ds2 + '　' + (v2 ? U.dur(v2) : '没有记录')) + '">' +
          '<span style="height:' + hh + 'px"></span></div>';
      }
      html += '</div><div class="daylbl" style="padding:0 14px"><span>1</span><span>' +
        Math.round(days / 2) + '</span><span>' + days + '</span></div></div>';

      html += '<div class="card tight"><h3>本月各分类投入</h3>' + catBars(mst.byCat) + '</div>';
    }

    /* 日历（两个口径都显示，点某天=在本页切到那天） */
    html += '<div class="sec-title">日历　<span style="font-weight:400;color:var(--ink3)">点某天 = 转到那天（不跳页）</span></div>';
    html += calendar(cur, statsFor(all).byDay, today, dashDay);
    html += '<p class="mini-note">绿色 = 那天有记录；蓝框 = 当前选中；红框 = 今天。</p>';

    html += '</div>';
    main.innerHTML = html;
  }

  function shiftDay(n) {
    var d = new Date((A.state.dashDay || U.dateStr()) + 'T00:00:00');
    d.setDate(d.getDate() + n);
    A.state.dashDay = U.dateStr(d);
    A.state.dashMonth = monthOfDay(A.state.dashDay);
  }

  function bind() {
    document.getElementById('main').addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-m],[data-cal],[data-dmode],[data-dd],[data-open-tl]') : null;
      if (!t) return;

      if (t.hasAttribute('data-dmode')) { A.state.dashMode = t.getAttribute('data-dmode'); render(); return; }
      if (t.hasAttribute('data-dd')) { shiftDay(+t.getAttribute('data-dd')); A.state.dashMode = 'day'; render(); return; }
      if (t.hasAttribute('data-open-tl')) {
        A.state.tlDay = A.state.dashDay || U.dateStr();
        A.go('timeline');
        return;
      }
      if (t.hasAttribute('data-m')) {
        var cur = A.state.dashMonth || U.monthStr();
        var yy = +cur.slice(0, 4), mm = +cur.slice(5, 7) - 1 + (+t.getAttribute('data-m'));
        A.state.dashMonth = U.monthStr(new Date(yy, mm, 1));
        render();
        return;
      }
      if (t.hasAttribute('data-cal')) {
        /* 留在总览页：切到那天看当天口径 */
        var ds = t.getAttribute('data-cal');
        A.state.dashDay = ds;
        A.state.dashMonth = monthOfDay(ds);
        A.state.dashMode = 'day';
        render();
        return;
      }
    });
  }

  A.views.dashboard = { title: '总览', render: render, bind: bind };
})(window);
