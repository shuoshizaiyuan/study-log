/* view-dashboard.js — 总览：日历回看 + 统计 */
(function (root) {
  'use strict';
  var A = root.App = root.App || {};
  var U = A.util, S = A.store;
  A.views = A.views || {};

  function monthOfDay(ds) { return ds.slice(0, 7); }

  function statsFor(records) {
    var total = 0, byCat = {}, byDay = {};
    records.forEach(function (r) {
      if (r.deleted) return;
      total += r.minutes || 0;
      var k = A.meta.catName(r.categoryId) || '未分类';
      byCat[k] = (byCat[k] || 0) + (r.minutes || 0);
      byDay[r.date] = (byDay[r.date] || 0) + (r.minutes || 0);
    });
    return { total: total, byCat: byCat, byDay: byDay };
  }

  function render() {
    var main = document.getElementById('main');
    var cur = A.state.dashMonth || U.monthStr();
    var all = S.records().filter(function (r) { return !r.deleted; });
    var monthRecs = all.filter(function (r) { return monthOfDay(r.date) === cur; });
    var st = statsFor(all);
    var mst = statsFor(monthRecs);

    var today = U.dateStr();
    var week = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      var ds = U.dateStr(d);
      week.push({ date: ds, min: st.byDay[ds] || 0 });
    }
    var weekTotal = week.reduce(function (s, x) { return s + x.min; }, 0);
    var live = S.running();
    if (live && live.date === today) weekTotal += U.minutesBetween(live.startTs, Date.now());

    var html = '<div class="view">';
    html += '<div class="stat-grid">' +
      '<div class="stat"><div class="sl">今日</div><div class="sv">' + U.dur((st.byDay[today] || 0) +
        (live && live.date === today ? U.minutesBetween(live.startTs, Date.now()) : 0)) + '</div></div>' +
      '<div class="stat"><div class="sl">最近 7 天</div><div class="sv">' + U.dur(weekTotal) + '</div></div>' +
      '<div class="stat"><div class="sl">本月</div><div class="sv">' + U.dur(mst.total) + '</div></div>' +
      '<div class="stat"><div class="sl">累计</div><div class="sv">' + U.dur(st.total) + '</div></div>' +
      '</div>';

    /* 日历 */
    html += '<div class="sec-title" style="display:flex;align-items:center;justify-content:space-between">' +
      '<span>回看</span><span>' +
      '<button class="btn sm ghost" data-m="-1" style="height:26px">◀</button> ' +
      '<span style="font-size:13px;color:var(--ink2);margin:0 6px">' + cur + '</span>' +
      '<button class="btn sm ghost" data-m="1" style="height:26px">▶</button></span></div>';

    var y = +cur.slice(0, 4), mo = +cur.slice(5, 7) - 1;
    var first = new Date(y, mo, 1);
    var startDow = first.getDay();
    var days = new Date(y, mo + 1, 0).getDate();
    html += '<div class="cal">';
    ['日', '一', '二', '三', '四', '五', '六'].forEach(function (w) {
      html += '<div class="cw">' + w + '</div>';
    });
    for (var p = 0; p < startDow; p++) html += '<div class="cd pad"></div>';
    for (var dd = 1; dd <= days; dd++) {
      var ds = cur + '-' + U.pad(dd);
      var has = (st.byDay[ds] || 0) > 0;
      var cls = 'cd' + (has ? ' has' : '') + (ds === today ? ' today' : '');
      html += '<div class="' + cls + '" data-day="' + ds + '">' + dd + '</div>';
    }
    html += '</div>';
    html += '<p class="mini-note">绿色 = 那天有记录。点某天可直接跳到那天的时间轴。</p>';

    /* 分类占比 */
    var keys = Object.keys(mst.byCat).sort(function (a, b) { return mst.byCat[b] - mst.byCat[a]; });
    if (keys.length) {
      html += '<div class="sec-title">本月各分类投入</div><div class="card tight">';
      var maxv = mst.byCat[keys[0]] || 1;
      keys.forEach(function (k) {
        var v = mst.byCat[k];
        html += '<div style="padding:6px 0">' +
          '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px">' +
          '<span>' + U.esc(k) + '</span><span style="color:var(--ink2);font-variant-numeric:tabular-nums">' + U.dur(v) + '</span></div>' +
          '<div style="height:6px;border-radius:4px;background:var(--sunk);overflow:hidden">' +
          '<div style="height:100%;width:' + Math.max(3, Math.round(v / maxv * 100)) + '%;background:var(--blue)"></div></div></div>';
      });
      html += '</div>';
    }

    /* 最近 7 天 */
    html += '<div class="sec-title">最近 7 天</div><div class="card tight">';
    var wmax = Math.max.apply(null, week.map(function (x) { return x.min; }).concat([1]));
    week.forEach(function (x) {
      html += '<div style="display:flex;align-items:center;gap:10px;padding:4px 0">' +
        '<span style="font-size:12px;color:var(--ink3);width:56px;font-variant-numeric:tabular-nums">' +
        x.date.slice(5) + '</span>' +
        '<span style="flex:1;height:8px;border-radius:5px;background:var(--sunk);overflow:hidden;display:block">' +
        '<span style="display:block;height:100%;width:' + Math.round(x.min / wmax * 100) + '%;background:' +
        (x.date === today ? 'var(--blue)' : 'var(--teal-m)') + '"></span></span>' +
        '<span style="font-size:12px;color:var(--ink2);width:52px;text-align:right;font-variant-numeric:tabular-nums">' +
        (x.min ? U.dur(x.min) : '—') + '</span></div>';
    });
    html += '</div>';

    if (!all.length) {
      html += '<div class="empty">还没有任何记录<br>先去时间轴开始第一段</div>';
    }

    html += '</div>';
    main.innerHTML = html;
  }

  function bind() {
    document.getElementById('main').addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-m],[data-day]') : null;
      if (!t) return;
      if (t.hasAttribute('data-m')) {
        var cur = A.state.dashMonth || U.monthStr();
        var y = +cur.slice(0, 4), m = +cur.slice(5, 7) - 1 + (+t.getAttribute('data-m'));
        var d = new Date(y, m, 1);
        A.state.dashMonth = U.monthStr(d);
        render();
        return;
      }
      if (t.hasAttribute('data-day')) {
        A.state.tlDay = t.getAttribute('data-day');
        A.go('timeline');
      }
    });
  }

  A.views.dashboard = { title: '总览', render: render, bind: bind };
})(window);
