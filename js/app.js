/* app.js — 启动 / 路由 / 跨页桥接 */
(function (root) {
  'use strict';
  var A = root.App = root.App || {};
  var U = A.util, S = A.store, UI = A.ui;

  A.state = {
    view: 'timeline',
    tlDay: U.dateStr(),
    taskMode: 'quad',
    dashMonth: U.monthStr(),
    exportRange: { mode: 'today' }
  };

  /* 每次切页都把 #main 整个换掉，彻底清掉旧的监听，避免叠加 */
  function freshMain() {
    var old = document.getElementById('main');
    var fresh = old.cloneNode(false);
    old.parentNode.replaceChild(fresh, old);
    return fresh;
  }

  function updateTabs() {
    document.querySelectorAll('#tabbar .tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === A.state.view);
    });
  }

  A.go = function (view) {
    if (!A.views[view]) view = 'timeline';
    A.state.view = view;
    updateTabs();
    var main = freshMain();
    var v = A.views[view];
    document.getElementById('tb-title').textContent = v.title;
    if (view !== 'timeline') document.getElementById('tb-sub').textContent = '';
    try {
      v.render(main);
    } catch (e) {
      main.innerHTML = '<div class="empty">这一页渲染出错了：' + U.esc(e.message) +
        '<br><br>你的数据没有丢，切回时间轴看看。</div>';
    }
    if (v.bind) { try { v.bind(main); } catch (e) { /* 忽略 */ } }
  };

  /* 任务页 → 直接开始这个任务 */
  A.timeline = {
    startWith: function (task) {
      var run = S.running();
      if (run && run.startTs) A.views.timeline.settleAndSave();
      S.setRunning({
        startTs: Date.now(),
        date: U.dateStr(),
        title: task.title,
        taskId: task.id || null,
        categoryId: task.categoryId || null,
        tagIds: task.tagIds || []
      });
      A.sync.markRunning();
      A.sync.scheduleAuto(300);
      A.go('timeline');
      UI.toast('已开始：' + task.title);
    }
  };

  /* 忘了停的时段：超过 12 小时就提醒修一下 */
  function guardLongRunning() {
    var r = S.running();
    if (!r || !r.startTs) return;
    var el = Date.now() - r.startTs;
    if (el < 12 * 3600 * 1000) return;

    var defEnd = new Date(r.startTs + 60 * 60000);
    var html = '<p class="hint" style="margin:6px 0 12px">有一段从 <b>' + U.esc(U.hhmm(r.startTs)) +
      '</b>（' + U.esc(r.date) + '）开始的任务一直没有停，已经过去 ' + U.dur(Math.round(el / 60000)) +
      '。请确认它实际是几点结束的，避免记录失真。</p>' +
      '<label class="label">实际结束时间</label>' +
      '<input class="input" type="time" id="gr-end" value="' + U.hhmm(defEnd) + '">' +
      '<label class="label">结束日期</label>' +
      '<input class="input" type="date" id="gr-date" value="' + (r.date || U.dateStr()) + '">';

    UI.sheet({
      title: '有一段忘了停',
      bodyHTML: html,
      footHTML: '<button class="btn ghost" data-cancel>先不管</button>' +
        '<button class="btn primary" data-ok>按这个时间结束</button>',
      onMount: function (el2, close) {
        el2.querySelector('[data-cancel]').onclick = function () { close(); A.go('timeline'); };
        el2.querySelector('[data-ok]').onclick = function () {
          var endStr = el2.querySelector('#gr-end').value;
          var dayStr = el2.querySelector('#gr-date').value;
          var endTs = new Date(dayStr + 'T' + endStr + ':00').getTime();
          if (!endTs || endTs <= r.startTs) { UI.toast('结束时间必须晚于开始时间'); return; }
          var rec = A.model.newRecord({
            date: r.date,
            start: U.hhmm(r.startTs), end: U.hhmm(endTs),
            startTs: r.startTs, endTs: endTs,
            minutes: U.minutesBetween(r.startTs, endTs),
            title: r.title, taskId: r.taskId,
            categoryId: r.categoryId, tagIds: r.tagIds,
            entries: A.views.timeline.takeLiveEntries(r.startTs)
          });
          S.setRunning(null);
          A.sync.markRunning();
          var all = S.records(); all.push(rec);
          S.saveRecords(all);
          A.sync.markMonthOf(rec);
          A.sync.scheduleAuto(800);
          close(); A.go('timeline');
          UI.toast('已按 ' + U.dur(rec.minutes) + ' 记录');
        };
      }
    });
  }

  function boot() {
    document.querySelectorAll('#tabbar .tab').forEach(function (b) {
      b.onclick = function () { A.go(b.getAttribute('data-view')); };
    });

    A.go('timeline');
    guardLongRunning();

    var cfg = S.syncCfg();
    if (cfg.enabled && cfg.owner && cfg.repo && cfg.token) {
      A.sync.setStatus('busy');
      A.sync.pull().then(function (r) {
        if (A.state.view === 'timeline') A.views.timeline.render();
        if (r && r.tookOver) UI.toast('这段已被另一台设备接手，本机已停止计时', 5000);
        else UI.toast('已从云端取回最新数据');
      }).catch(function (e) {
        UI.toast('同步失败：' + e.message + '（数据仍在本机，不会丢）', 6000);
      });
    } else {
      A.sync.setStatus('idle');
    }

    /* 开机时如果本机还有一段没结束的计时，立刻广播一次，让别的设备看得到 */
    if (S.running() && S.running().startTs) {
      setTimeout(function () { A.sync.markRunning(); }, 600);
    }

    /* 切后台 / 锁屏前立刻把"正在计时"推上去；切回前台再补一次全量同步 */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        if (S.running() && S.running().startTs) A.sync.markRunning();
        return;
      }
      var c = S.syncCfg();
      if (c.enabled && c.owner && c.repo && c.token) A.sync.scheduleAuto(400);
      if (A.state.view === 'timeline' && A.views.timeline.isRunning()) {
        A.views.timeline.render();
      }
    });

    /* 离开页面（关标签 / 跳走）时也尽力推一次 */
    window.addEventListener('pagehide', function () {
      if (S.running() && S.running().startTs) A.sync.markRunning();
    });

    /* 离线缓存（可选项，失败不影响使用） */
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () { });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
