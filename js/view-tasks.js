/* view-tasks.js — 任务页：四象限 / 列表 双视图 */
(function (root) {
  'use strict';
  var A = root.App = root.App || {};
  var U = A.util, S = A.store, UI = A.ui;
  A.views = A.views || {};

  var QUAD = [
    { id: 'q1', name: '重要且紧急' },
    { id: 'q2', name: '重要不紧急' },
    { id: 'q3', name: '紧急不重要' },
    { id: 'q4', name: '都不紧急' }
  ];

  function live() { return S.tasks().filter(function (t) { return !t.archived; }); }

  function taskSheet(task, presetQuadrant) {
    var t = task ? A.model.clone(task) : A.model.newTask({ quadrant: presetQuadrant || 'q1' });
    var settings = S.settings();
    var isNew = !task;
    var cat = t.categoryId, tags = (t.tagIds || []).slice(), quad = t.quadrant;

    var html = '';
    html += '<label class="label" style="margin-top:6px">任务名</label>';
    html += '<input class="input" id="tk-title" value="' + U.esc(t.title) + '" placeholder="要做什么">';
    html += '<label class="label">分类（只能选一个）</label><div class="row wrap" id="tk-cats">' +
      settings.categories.map(function (c) {
        return '<button class="chip' + (c.id === cat ? ' on' : '') + '" data-cat="' + c.id + '">' + U.esc(c.name) + '</button>';
      }).join('') + '<button class="chip" data-newcat>+ 新建分类</button></div>';
    html += '<label class="label">标签（可以多选）</label><div class="row wrap" id="tk-tags">' +
      settings.tags.map(function (x) {
        return '<button class="chip' + (tags.indexOf(x.id) >= 0 ? ' on' : '') + '" data-tag="' + x.id + '">' + U.esc(x.name) + '</button>';
      }).join('') + '<button class="chip" data-newtag>+ 新建标签</button></div>';
    html += '<label class="label">归属象限</label><div class="row wrap" id="tk-quad">' +
      QUAD.map(function (q) {
        return '<button class="chip' + (q.id === quad ? ' on' : '') + '" data-q="' + q.id + '">' + q.name + '</button>';
      }).join('') + '</div>';
    html += '<label class="label">预期完成时间</label>';
    html += '<input class="input" id="tk-due" type="date" value="' + U.esc(t.dueDate || '') + '">';
    html += '<label class="label">预定时长（分钟，可留空）</label>';
    html += '<input class="input" id="tk-min" type="number" inputmode="numeric" value="' +
      (t.presetMinutes || '') + '" placeholder="例如 60">';
    if (!isNew) {
      html += '<div class="row" style="margin-top:16px;gap:8px">' +
        '<button class="btn sm" data-start>直接开始这个任务</button>' +
        '<button class="btn sm ghost" data-archive>' + (t.archived ? '恢复' : '归档') + '</button>' +
        '<button class="btn sm ghost" data-del>删除</button></div>';
    }

    UI.sheet({
      title: isNew ? '新建任务' : '编辑任务',
      bodyHTML: html,
      footHTML: '<button class="btn ghost" data-cancel>取消</button>' +
        '<button class="btn primary" data-save>' + (isNew ? '创建' : '保存') + '</button>',
      onMount: function (el, close) {
        el.querySelectorAll('[data-cat]').forEach(function (b) {
          b.onclick = function () {
            cat = (cat === b.dataset.cat) ? null : b.dataset.cat;
            el.querySelectorAll('[data-cat]').forEach(function (x) { x.classList.toggle('on', x.dataset.cat === cat); });
          };
        });
        el.querySelectorAll('[data-tag]').forEach(function (b) {
          b.onclick = function () {
            var i = tags.indexOf(b.dataset.tag);
            if (i >= 0) tags.splice(i, 1); else tags.push(b.dataset.tag);
            b.classList.toggle('on', tags.indexOf(b.dataset.tag) >= 0);
          };
        });
        el.querySelectorAll('[data-q]').forEach(function (b) {
          b.onclick = function () {
            quad = b.dataset.q;
            el.querySelectorAll('[data-q]').forEach(function (x) { x.classList.toggle('on', x.dataset.q === quad); });
          };
        });
        el.querySelector('[data-newcat]').onclick = function () {
          var name = prompt('新分类名称'); if (!name) return;
          A.meta.ensureCategory(name);
          A.sync.markDirty('settings', 'settings'); close(); taskSheet(t, quad);
        };
        el.querySelector('[data-newtag]').onclick = function () {
          var name = prompt('新标签名称'); if (!name) return;
          A.meta.ensureTag(name);
          A.sync.markDirty('settings', 'settings'); close(); taskSheet(t, quad);
        };

        function collect() {
          t.title = String(el.querySelector('#tk-title').value || '').trim();
          t.categoryId = cat; t.tagIds = tags; t.quadrant = quad;
          t.dueDate = el.querySelector('#tk-due').value || null;
          var mv = parseInt(el.querySelector('#tk-min').value, 10);
          t.presetMinutes = isNaN(mv) ? null : mv;
          return t;
        }

        if (!isNew) {
          el.querySelector('[data-start]').onclick = function () {
            collect();
            if (!A.model.validateTask(t).ok) { UI.toast('请先填任务名'); return; }
            t.lastUsedAt = new Date().toISOString();
            t.updatedAt = new Date().toISOString();
            var all = S.tasks();
            for (var i = 0; i < all.length; i++) if (all[i].id === t.id) { all[i] = t; break; }
            S.saveTasks(all);
            A.sync.markDirty('tasks', 'tasks');
            close();
            A.timeline.startWith(t);
          };
          el.querySelector('[data-archive]').onclick = function () {
            collect(); t.archived = !t.archived; t.updatedAt = new Date().toISOString();
            var all = S.tasks();
            for (var i = 0; i < all.length; i++) if (all[i].id === t.id) { all[i] = t; break; }
            S.saveTasks(all); A.sync.markDirty('tasks', 'tasks');
            close(); A.views.tasks.render();
            UI.toast(t.archived ? '已归档' : '已恢复');
          };
          el.querySelector('[data-del]').onclick = function () {
            close();
            UI.confirm('删除任务「' + t.title + '」？已记录的时段不会受影响。', '删除').then(function (ok) {
              if (!ok) return;
              S.saveTasks(S.tasks().filter(function (x) { return x.id !== t.id; }));
              A.sync.markDirty('tasks', 'tasks');
              A.views.tasks.render(); UI.toast('已删除');
            });
          };
        }

        el.querySelector('[data-cancel]').onclick = close;
        el.querySelector('[data-save]').onclick = function () {
          collect();
          var v = A.model.validateTask(t);
          if (!v.ok) { UI.toast(v.errors[0]); return; }
          t.updatedAt = new Date().toISOString();
          var all = S.tasks();
          var idx = -1;
          for (var i = 0; i < all.length; i++) if (all[i].id === t.id) { idx = i; break; }
          if (idx >= 0) all[idx] = t; else all.unshift(t);
          S.saveTasks(all);
          A.sync.markDirty('tasks', 'tasks');
          A.sync.scheduleAuto(1200);
          close(); A.views.tasks.render();
          UI.toast(isNew ? '已创建' : '已保存');
        };
        if (isNew) setTimeout(function () { el.querySelector('#tk-title').focus(); }, 260);
      }
    });
  }

  function importSheet() {
    var html = '<div class="hint" style="margin:6px 0 10px">一行一个任务，直接粘进来就行。导入后点每个任务可以再归到象限。</div>' +
      '<textarea class="input" id="im-text" style="min-height:150px" placeholder="背诵社会研究方法第3章&#10;英语一 2019 Text 2 精读&#10;政治 马原 第一章"></textarea>' +
      '<label class="label">先统一归到</label><div class="row wrap" id="im-q">' +
      QUAD.map(function (q, i) {
        return '<button class="chip' + (i === 0 ? ' on' : '') + '" data-q="' + q.id + '">' + q.name + '</button>';
      }).join('') + '</div>';
    var quad = 'q1';
    UI.sheet({
      title: '导入任务',
      bodyHTML: html,
      footHTML: '<button class="btn ghost" data-cancel>取消</button>' +
        '<button class="btn primary" data-go>导入</button>',
      onMount: function (el, close) {
        el.querySelectorAll('[data-q]').forEach(function (b) {
          b.onclick = function () {
            quad = b.dataset.q;
            el.querySelectorAll('[data-q]').forEach(function (x) { x.classList.toggle('on', x.dataset.q === quad); });
          };
        });
        el.querySelector('[data-cancel]').onclick = close;
        el.querySelector('[data-go]').onclick = function () {
          var lines = String(el.querySelector('#im-text').value || '')
            .split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
          if (!lines.length) { UI.toast('没有可导入的内容'); return; }
          var all = S.tasks();
          var added = 0;
          lines.forEach(function (ln) {
            var hit = all.filter(function (x) { return x.title === ln; })[0];
            if (hit) return;
            all.unshift(A.model.newTask({ title: ln, quadrant: quad }));
            added++;
          });
          S.saveTasks(all);
          A.sync.markDirty('tasks', 'tasks');
          A.sync.scheduleAuto(1000);
          close(); A.views.tasks.render();
          UI.toast('导入了 ' + added + ' 条');
        };
      }
    });
  }

  function render(el) {
    var main = document.getElementById('main');
    var tasks = live();
    var mode = A.state.taskMode || 'quad';
    var html = '<div class="view">';
    html += '<div class="row" style="padding:12px 16px 0;gap:8px">' +
      '<button class="btn sm' + (mode === 'quad' ? ' primary' : '') + '" data-mode="quad">四象限</button>' +
      '<button class="btn sm' + (mode === 'list' ? ' primary' : '') + '" data-mode="list">列表</button>' +
      '<button class="btn sm' + (mode === 'cat' ? ' primary' : '') + '" data-mode="cat">分类</button>' +
      '<span style="flex:1"></span>' +
      '<button class="btn sm" data-import>导入</button></div>';

    if (mode === 'quad') {
      html += '<div class="q-grid">';
      QUAD.forEach(function (q) {
        var items = tasks.filter(function (t) { return t.quadrant === q.id; });
        html += '<div class="q-cell" data-cell="' + q.id + '">' +
          '<div class="qh"><span class="qn">' + q.name + '（' + items.length + '）</span>' +
          '<button class="add" data-add="' + q.id + '">+</button></div>' +
          '<div class="qbody">' +
          (items.length ? items.slice(0, 4).map(function (t) {
            return '<div class="q-task" data-task="' + t.id + '"><span class="qt">' + U.esc(t.title) + '</span>' +
              '<span class="qm">' + U.esc([A.meta.catName(t.categoryId)].concat(A.meta.tagNames(t.tagIds)).filter(Boolean).join(' · ') || '未分类') +
              (t.dueDate ? ' · 预期 ' + U.esc(t.dueDate) : '') + '</span></div>';
          }).join('') + (items.length > 4 ? '<div class="qm" style="text-align:center;font-size:11px;color:var(--ink3)">还有 ' + (items.length - 4) + ' 条</div>' : '')
            : '<div class="q-empty">点右上角 + 加一条</div>') +
          '</div></div>';
      });
      html += '</div>';
      html += '<p class="mini-note">点右上角「+」或方块空白处新建；点已有任务可编辑、直接开始或归档。</p>';
    } else if (mode === 'cat') {
      /* 按「分类」分组：任务不止学习，还有生活，按分类比按象限顺 */
      var cats = S.settings().categories;
      var known = {};
      cats.forEach(function (c) { known[c.id] = 1; });
      var groups = [];
      cats.forEach(function (c) {
        var items = tasks.filter(function (t) { return t.categoryId === c.id; });
        if (items.length) groups.push({ name: c.name, items: items });
      });
      var noCat = tasks.filter(function (t) { return !t.categoryId || !known[t.categoryId]; });
      if (noCat.length) groups.push({ name: '未分类', items: noCat });

      if (!groups.length) {
        html += '<div class="empty">还没有任务<br>点上面「导入」批量加，或切回四象限点「+」</div>';
      } else {
        groups.forEach(function (g) {
          html += '<div class="sec-title" style="display:flex;justify-content:space-between">' +
            '<span>' + U.esc(g.name) + '</span><span style="font-weight:400;color:var(--ink3)">' + g.items.length + ' 条</span></div>';
          html += '<div class="card tight" style="margin-top:0">';
          g.items.slice().sort(function (a, b) {
            return String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'));
          }).forEach(function (t) {
            var q = QUAD.filter(function (x) { return x.id === t.quadrant; })[0];
            html += '<div class="list-row" style="padding:10px 0;border-bottom:1px solid var(--line)" data-task="' + t.id + '">' +
              '<div style="min-width:0"><div class="lr-t">' + U.esc(t.title) + '</div>' +
              '<div class="lr-s">' + U.esc([q ? q.name : ''].concat(A.meta.tagNames(t.tagIds)).filter(Boolean).join(' · ') || '无标签') +
              (t.presetMinutes ? ' · 预计 ' + t.presetMinutes + 'min' : '') +
              (t.dueDate ? ' · 预期 ' + U.esc(t.dueDate) : '') + '</div></div>' +
              '<span style="color:var(--ink3)">›</span></div>';
          });
          html += '</div>';
        });
        html += '<p class="mini-note">点任意一条可编辑、直接开始或归档。分类的增删改在「设置」页。</p>';
      }
    } else {
      if (!tasks.length) {
        html += '<div class="empty">还没有任务<br>点上面「导入」批量加，或切回四象限点「+」</div>';
      } else {
        html += '<div style="margin-top:12px">';
        tasks.slice().sort(function (a, b) {
          if (a.quadrant !== b.quadrant) return a.quadrant < b.quadrant ? -1 : 1;
          return String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'));
        }).forEach(function (t) {
          var q = QUAD.filter(function (x) { return x.id === t.quadrant; })[0];
          html += '<div class="list-row" data-task="' + t.id + '">' +
            '<div><div class="lr-t">' + U.esc(t.title) + '</div>' +
            '<div class="lr-s">' + U.esc([q ? q.name : ''].concat(A.meta.catName(t.categoryId) ? [A.meta.catName(t.categoryId)] : [])
              .concat(A.meta.tagNames(t.tagIds)).filter(Boolean).join(' · ')) +
            (t.dueDate ? ' · 预期 ' + U.esc(t.dueDate) : '') + '</div></div>' +
            '<span style="color:var(--ink3)">›</span></div>';
        });
        html += '</div>';
      }
    }
    html += '</div>';
    main.innerHTML = html;
    void el;
  }

  function bind() {
    var main = document.getElementById('main');
    main.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-mode],[data-add],[data-task],[data-import],[data-cell]') : null;
      if (!t) return;
      if (t.hasAttribute('data-mode')) { A.state.taskMode = t.getAttribute('data-mode'); render(); return; }
      if (t.hasAttribute('data-import')) { importSheet(); return; }
      if (t.hasAttribute('data-add')) { taskSheet(null, t.getAttribute('data-add')); return; }
      if (t.hasAttribute('data-task')) {
        var id = t.getAttribute('data-task');
        var task = S.tasks().filter(function (x) { return x.id === id; })[0];
        if (task) taskSheet(task);
        return;
      }
      if (t.hasAttribute('data-cell') && !e.target.closest('[data-task]') && !e.target.closest('[data-add]')) {
        taskSheet(null, t.getAttribute('data-cell'));
      }
    });
  }

  A.views.tasks = { title: '任务', render: render, bind: bind, taskSheet: taskSheet, QUAD: QUAD };
})(window);
