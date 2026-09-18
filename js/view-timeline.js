/* view-timeline.js — 首页：时间轴 + 计时 + 记录 */
(function (root) {
  'use strict';
  var A = root.App = root.App || {};
  var U = A.util, S = A.store, UI = A.ui;
  A.views = A.views || {};

  var PXH = 56;              /* 每小时像素高 */
  var tickTimer = null;
  var pendingImgs = [];      /* 记录弹层内的图片暂存 [{id,name,path,w,h}] */

  /* ---------------- 计时状态 ---------------- */
  function getRunning() { return S.running(); }
  function isRunning(r) { return !!(r && r.startTs); }
  function startRun(task) {
    var now = new Date();
    S.setRunning({
      startTs: now.getTime(),
      date: U.dateStr(now),
      title: task.title || '',
      taskId: task.id || null,
      categoryId: task.categoryId || null,
      tagIds: task.tagIds || []
    });
  }
  /* 结算当前段 → 生成一条记录 */
  function settle(extraEntries) {
    var r = S.running();
    if (!isRunning(r)) return null;
    var stashed = A.views.timeline.takeLiveEntries(r.startTs);
    var extra = (extraEntries || []);
    var endTs = Date.now();
    var dur = endTs - r.startTs;
    /* 不到 1 分钟且什么都没记：当作误触，不产生记录，避免假数据与重叠提示 */
    if (dur < 60 * 1000 && !stashed.length && !extra.length) {
      S.setRunning(null);
      return { skipped: true, title: r.title };
    }
    /* 有内容但太短：补足 1 分钟，避免起止落到同一分钟而无法编辑 */
    if (dur < 60 * 1000) endTs = r.startTs + 60 * 1000;
    var rec = A.model.newRecord({
      date: r.date,
      start: U.hhmm(r.startTs),
      end: U.hhmm(endTs),
      startTs: r.startTs,
      endTs: endTs,
      minutes: U.minutesBetween(r.startTs, endTs),
      title: r.title,
      taskId: r.taskId,
      categoryId: r.categoryId,
      tagIds: r.tagIds,
      entries: stashed.concat(extra)
    });
    S.setRunning(null);
    return rec;
  }

  /* 结算并落盘（重叠时交给 finishWithOverlap 处理） */
  function settleAndSave() {
    var rec = settle(null);
    if (!rec) return null;
    if (rec.skipped) { UI.toast('刚才那段不到 1 分钟，没有产生记录'); return null; }
    var res = saveRecord(rec);
    if (res.overlap) finishWithOverlap(rec);
    return rec;
  }

  function saveRecord(rec) {
    /* 重叠检测（同一天、未删除） */
    var all = S.records();
    var hit = all.filter(function (x) {
      if (x.deleted || x.id === rec.id || x.date !== rec.date) return false;
      if (!x.startTs || !x.endTs || !rec.startTs || !rec.endTs) return false;
      return rec.startTs < x.endTs && rec.endTs > x.startTs;
    });
    if (hit.length) {
      return { overlap: hit[0] };
    }
    rec.updatedAt = new Date().toISOString();
    var idx = -1;
    for (var i = 0; i < all.length; i++) if (all[i].id === rec.id) { idx = i; break; }
    if (idx >= 0) all[idx] = rec; else all.push(rec);
    S.saveRecords(all);
    A.sync.markMonthOf(rec);
    A.sync.scheduleAuto(1200);
    return { ok: true, rec: rec };
  }

  function persist(rec, force) {
    var res = saveRecord(rec);
    if (res.overlap && !force) return res;
    return res;
  }

  /* ---------------- 任务选择弹层 ---------------- */
  function openNextSheet() {
    var tasks = S.tasks().filter(function (t) { return !t.archived; });
    tasks.sort(function (a, b) { return String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || '')); });
    var settings = S.settings();
    var pickCat = null, pickTags = [];

    var html = '';
    html += '<label class="label" style="margin-top:6px">任务名</label>';
    html += '<input class="input" id="nt-title" placeholder="要做什么？例如：背诵社会研究方法" autocomplete="off">';
    html += '<label class="label">分类（只能选一个）</label><div class="row wrap" id="nt-cats">' +
      settings.categories.map(function (c) {
        return '<button class="chip" data-cat="' + c.id + '">' + U.esc(c.name) + '</button>';
      }).join('') + '<button class="chip" data-newcat>+ 新建分类</button></div>';
    html += '<label class="label">标签（可以多选）</label><div class="row wrap" id="nt-tags">' +
      settings.tags.map(function (t) {
        return '<button class="chip" data-tag="' + t.id + '">' + U.esc(t.name) + '</button>';
      }).join('') + '<button class="chip" data-newtag>+ 新建标签</button></div>';
    if (tasks.length) {
      html += '<label class="label">从任务清单里挑</label><div class="row wrap" id="nt-picks">' +
        tasks.slice(0, 24).map(function (t) {
          return '<button class="chip mini" data-pick="' + t.id + '">' + U.esc(t.title) + '</button>';
        }).join('') + '</div>';
    }
    html += '<div class="hint">选定后会立刻开始计时；上一段自动结算，两段紧挨着。</div>';
    html += '<div style="margin-top:12px"><button class="btn ghost sm block" data-stop>今天到这儿，先停下来</button></div>';

    var foot =
      '<button class="btn ghost" data-cancel>取消</button>' +
      '<button class="btn primary" data-go>开始</button>';

    UI.sheet({
      title: isRunning(getRunning()) ? '开始新任务' : '开始计时',
      bodyHTML: html, footHTML: foot,
      onMount: function (el, close) {
        var titleEl = el.querySelector('#nt-title');
        function syncCats() {
          el.querySelectorAll('[data-cat]').forEach(function (b) {
            b.classList.toggle('on', b.dataset.cat === pickCat);
          });
        }
        function syncTags() {
          el.querySelectorAll('[data-tag]').forEach(function (b) {
            b.classList.toggle('on', pickTags.indexOf(b.dataset.tag) >= 0);
          });
        }
        el.querySelectorAll('[data-cat]').forEach(function (b) {
          b.onclick = function () { pickCat = (pickCat === b.dataset.cat) ? null : b.dataset.cat; syncCats(); };
        });
        el.querySelectorAll('[data-tag]').forEach(function (b) {
          b.onclick = function () {
            var i = pickTags.indexOf(b.dataset.tag);
            if (i >= 0) pickTags.splice(i, 1); else pickTags.push(b.dataset.tag);
            syncTags();
          };
        });
        el.querySelector('[data-newcat]').onclick = function () {
          var name = prompt('新分类名称');
          if (!name) return;
          var id = A.meta.ensureCategory(name);
          if (!id) return;
          A.sync.markDirty('settings', 'settings');
          close(); openNextSheet();
        };
        el.querySelector('[data-newtag]').onclick = function () {
          var name = prompt('新标签名称');
          if (!name) return;
          A.meta.ensureTag(name);
          A.sync.markDirty('settings', 'settings');
          close(); openNextSheet();
        };
        el.querySelectorAll('[data-pick]').forEach(function (b) {
          b.onclick = function () {
            var t = S.tasks().filter(function (x) { return x.id === b.dataset.pick; })[0];
            if (!t) return;
            titleEl.value = t.title;
            pickCat = t.categoryId; pickTags = (t.tagIds || []).slice();
            syncCats(); syncTags();
          };
        });
        el.querySelector('[data-cancel]').onclick = close;
        el.querySelector('[data-stop]').onclick = function () {
          close();
          var rec = settleAndSave();
          if (rec) UI.toast('已结算 ' + U.dur(rec.minutes) + '，今天到这儿');
          A.views.timeline.render();
        };
        el.querySelector('[data-go]').onclick = function () {
          var title = String(titleEl.value || '').trim();
          if (!title) { UI.toast('请填任务名，或从清单里挑一个'); return; }
          close();
          var prev = getRunning();
          /* 先把上一段结算 */
          if (isRunning(prev)) {
            var p = settle();
            if (p && !p.skipped) {
              var rr = saveRecord(p);
              if (rr.overlap) UI.toast('上一段与已有记录时间重叠，两条都保留了');
            }
          }
          startRun({ title: title, id: null, categoryId: pickCat, tagIds: pickTags });
          /* 更新任务的使用时间 */
          var all = S.tasks();
          var hit = all.filter(function (x) { return x.title === title; })[0];
          if (hit) {
            hit.lastUsedAt = new Date().toISOString();
            S.saveTasks(all);
            A.sync.markDirty('tasks', 'tasks');
          }
          A.views.timeline.render();
          UI.toast('已开始：' + title);
        };
        setTimeout(function () { titleEl.focus(); }, 260);
      }
    });
  }

  function finishWithOverlap(rec) {
    var res = saveRecord(rec);
    if (!res.overlap) { A.views.timeline.render(); return; }
    var other = res.overlap;
    UI.sheet({
      title: '时间重叠了',
      bodyHTML: '<p class="hint" style="margin-top:6px">这段时间和已有记录重叠：<br><b>' +
        U.esc(other.start + '–' + other.end + '　' + other.title) + '</b><br><br>要怎么处理？</p>',
      footHTML: '<button class="btn ghost" data-a>并排保留</button>' +
        '<button class="btn" data-b>删掉旧的那条</button>' +
        '<button class="btn primary" data-c>仍然保存</button>',
      onMount: function (el, close) {
        el.querySelector('[data-a]').onclick = function () { close(); forceSave(rec); };
        el.querySelector('[data-b]').onclick = function () {
          close();
          var all = S.records().filter(function (x) { return x.id !== other.id; });
          S.saveRecords(all);
          A.sync.markMonthOf(other);
          forceSave(rec);
        };
        el.querySelector('[data-c]').onclick = function () { close(); forceSave(rec); };
      },
      onClose: function () { A.views.timeline.render(); }
    });
  }

  function forceSave(rec) {
    var all = S.records();
    rec.updatedAt = new Date().toISOString();
    var idx = -1;
    for (var i = 0; i < all.length; i++) if (all[i].id === rec.id) { idx = i; break; }
    if (idx >= 0) all[idx] = rec; else all.push(rec);
    S.saveRecords(all);
    A.sync.markMonthOf(rec);
    A.sync.scheduleAuto(1200);
    A.views.timeline.render();
  }

  /* ---------------- 记录一下 ---------------- */
  function openEntrySheet(recId) {
    var running = getRunning();
    if (!recId && !isRunning(running)) { UI.toast('先开始一个任务，再来记录'); return; }
    var rec = recId ? S.records().filter(function (r) { return r.id === recId; })[0] : null;
    var isLive = !rec;
    var targetTitle = isLive ? running.title : rec.title;

    /* 临时存放：本弹层里收集的条目 */
    var entries = [];
    var editing = { id: null, text: '', images: [] };

    var html = '';
    html += '<div class="hint" style="margin:0 0 10px">记到：<b>' + U.esc(targetTitle || '（当前任务）') + '</b>' +
      (isLive ? '（' + U.hhmm(running.startTs) + ' 开始，正在进行）' : '（' + rec.start + '–' + rec.end + '）') + '</div>';
    html += '<textarea class="input" id="en-text" placeholder="刚才做了什么？可直接用输入法语音，也可粘贴截图"></textarea>';
    html += '<div class="row" style="margin-top:8px">' +
      '<button class="btn sm" data-pick>从相册选</button>' +
      '<button class="btn sm" data-cam>拍照</button>' +
      '<span class="hint" style="margin:0;align-self:center" id="img-hint"></span></div>';
    html += '<div class="thumb-grid" id="thumbs"></div>';
    html += '<input type="file" accept="image/*" multiple id="f-pick" style="display:none">';
    html += '<input type="file" accept="image/*" capture="environment" id="f-cam" style="display:none">';

    if (!isLive) {
      html += '<div class="sec-title" style="margin:16px 0 4px">已记录的分次内容</div><div id="en-list"></div>';
      entries = (rec.entries || []).slice();
    } else {
      html += '<div class="hint">正在进行的内容会随着「开始新任务」一起结算，随时可以多次记录。</div>';
    }

    var foot = '<button class="btn ghost" data-cancel>关闭</button>' +
      '<button class="btn primary" data-save>保存这一条</button>';

    UI.sheet({
      title: '记录一下',
      bodyHTML: html, footHTML: foot,
      onMount: function (el, close) {
        var ta = el.querySelector('#en-text');
        var thumbs = el.querySelector('#thumbs');
        var listEl = el.querySelector('#en-list');

        function renderThumbs() {
          thumbs.innerHTML = editing.images.map(function (im, i) {
            return '<div class="thumb" data-i="' + i + '"><span class="ph">' + U.esc(im.name) + '</span>' +
              '<span class="del" data-del="' + i + '">×</span></div>';
          }).join('');
        }
        function renderList() {
          if (!listEl) return;
          listEl.innerHTML = entries.length ? entries.map(function (en) {
            return '<div class="entry"><div class="eh">' + U.esc(en.at) + '</div>' +
              '<div class="eb">' + (en.text ? U.esc(en.text) : '<span class="hint">（无文字）</span>') +
              (en.images && en.images.length ? '<div class="hint">图：' + en.images.map(function (i) { return U.esc(i.name); }).join('、') + '</div>' : '') +
              '</div></div>';
          }).join('') : '<div class="hint">还没有分次记录</div>';
        }
        renderList();

        function addFiles(files) {
          var arr = Array.prototype.slice.call(files || []);
          if (!arr.length) return;
          arr.reduce(function (p, f) {
            return p.then(function () {
              return U.compressImage(f, 1600, 0.78).then(function (c) {
                var name = U.dateStr() + '-' + U.hhmmss(new Date()).replace(/:/g, '') + '-' +
                  Math.random().toString(36).slice(2, 5) + '.jpg';
                var id = A.sync.enqueueImage(c, name);
                A.imgStore.put({ id: id, dataUrl: c.dataUrl, cachedAt: Date.now() });
                editing.images.push({ id: id, name: name, path: 'evidence/' + U.monthStr() + '/' + name, w: c.w, h: c.h });
              }).catch(function (e) { UI.toast('图片处理失败：' + e.message); });
            });
          }, Promise.resolve()).then(function () {
            renderThumbs();
            A.sync.scheduleAuto(2500);
          });
        }

        el.querySelector('[data-pick]').onclick = function () { el.querySelector('#f-pick').click(); };
        el.querySelector('[data-cam]').onclick = function () { el.querySelector('#f-cam').click(); };
        el.querySelector('#f-pick').onchange = function (e) { addFiles(e.target.files); e.target.value = ''; };
        el.querySelector('#f-cam').onchange = function (e) { addFiles(e.target.files); e.target.value = ''; };
        thumbs.onclick = function (e) {
          var d = e.target.getAttribute && e.target.getAttribute('data-del');
          if (d != null) {
            var i = +d;
            var im = editing.images[i];
            if (im) { A.imgStore.del(im.id); }
            editing.images.splice(i, 1); renderThumbs();
          }
        };
        ta.addEventListener('paste', function (e) {
          var items = (e.clipboardData && e.clipboardData.items) || [];
          var files = [];
          for (var i = 0; i < items.length; i++) {
            if (items[i].type && items[i].type.indexOf('image') === 0) {
              var f = items[i].getAsFile();
              if (f) files.push(f);
            }
          }
          if (files.length) { e.preventDefault(); addFiles(files); }
        });

        el.querySelector('[data-cancel]').onclick = close;
        el.querySelector('[data-save]').onclick = function () {
          var text = String(ta.value || '').trim();
          if (!text && !editing.images.length) { UI.toast('写点内容或加张图吧'); return; }
          var en = A.model.newEntry({ text: text, images: editing.images.slice() });
          if (isLive) {
            /* 进行中的段：把条目暂存到本地，结算时一起写入 */
            var stash = S.meta();
            stash.liveEntries = stash.liveEntries || {};
            stash.liveEntries[running.startTs] = (stash.liveEntries[running.startTs] || []).concat([en]);
            S.saveMeta(stash);
          } else {
            rec.entries = (rec.entries || []).concat([en]);
            rec.updatedAt = new Date().toISOString();
            var all = S.records();
            for (var i = 0; i < all.length; i++) if (all[i].id === rec.id) { all[i] = rec; break; }
            S.saveRecords(all);
            A.sync.markMonthOf(rec);
          }
          A.sync.scheduleAuto(1200);
          editing = { id: null, text: '', images: [] };
          ta.value = ''; renderThumbs();
          UI.toast('已记录 ' + en.at);
          A.views.timeline.render();
        };
      }
    });
  }

  /* ---------------- 点色块：查看 / 编辑 ---------------- */
  function openRecordSheet(id) {
    var rec = S.records().filter(function (r) { return r.id === id; })[0];
    if (!rec) return;
    var settings = S.settings();
    var html = '';
    html += '<label class="label" style="margin-top:6px">任务名</label>';
    html += '<input class="input" id="rd-title" value="' + U.esc(rec.title) + '">';
    html += '<div class="row" style="margin-top:12px">' +
      '<div style="flex:1"><label class="label" style="margin-top:0">开始</label>' +
      '<input class="input" id="rd-start" type="time" value="' + U.esc(rec.start) + '"></div>' +
      '<div style="flex:1"><label class="label" style="margin-top:0">结束</label>' +
      '<input class="input" id="rd-end" type="time" value="' + U.esc(rec.end) + '"></div></div>';
    html += '<label class="label">分类</label><div class="row wrap" id="rd-cats">' +
      settings.categories.map(function (c) {
        return '<button class="chip' + (c.id === rec.categoryId ? ' on' : '') + '" data-cat="' + c.id + '">' +
          U.esc(c.name) + '</button>';
      }).join('') + '</div>';
    html += '<label class="label">标签</label><div class="row wrap" id="rd-tags">' +
      settings.tags.map(function (t) {
        return '<button class="chip' + ((rec.tagIds || []).indexOf(t.id) >= 0 ? ' on' : '') + '" data-tag="' + t.id + '">' +
          U.esc(t.name) + '</button>';
      }).join('') + (settings.tags.length ? '' : '<span class="hint">还没有标签，可在设置里建</span>') + '</div>';
    html += '<div class="sec-title" style="margin:16px 0 4px">这段里的分次记录</div><div id="rd-entries"></div>';
    html += '<div style="margin-top:14px"><button class="btn sm" data-add>+ 往里补一条记录</button></div>';
    html += '<div style="margin-top:10px"><button class="btn sm ghost" data-del>删除这一整段</button></div>';

    var cat = rec.categoryId, tags = (rec.tagIds || []).slice();

    UI.sheet({
      title: '编辑这一段',
      bodyHTML: html,
      footHTML: '<button class="btn ghost" data-cancel>取消</button>' +
        '<button class="btn primary" data-save>保存</button>',
      onMount: function (el, close) {
        var listEl = el.querySelector('#rd-entries');
        var ens = (rec.entries || []).slice().sort(function (a, b) { return (a.atTs || 0) - (b.atTs || 0); });
        listEl.innerHTML = ens.length ? ens.map(function (en, i) {
          return '<div class="entry"><div class="eh">' + U.esc(en.at) +
            ' <button class="chip mini" data-delentry="' + i + '" style="float:right;margin-top:-2px">删</button></div>' +
            '<div class="eb">' + (en.text ? U.esc(en.text) : '（无文字）') +
            (en.images && en.images.length ? '<div class="hint">图：' + en.images.map(function (x) { return U.esc(x.name); }).join('、') + '</div>' : '') +
            '</div></div>';
        }).join('') : '<div class="hint">暂无</div>';

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
        el.querySelectorAll('[data-delentry]').forEach(function (b) {
          b.onclick = function () {
            ens.splice(+b.dataset.delentry, 1);
            close(); openRecordSheetAfterEdit(rec.id);
          };
        });
        el.querySelector('[data-add]').onclick = function () {
          close();
          var r2 = S.records().filter(function (x) { return x.id === rec.id; })[0];
          if (r2) {
            r2.entries = ens;
            var all = S.records();
            for (var i = 0; i < all.length; i++) if (all[i].id === r2.id) { all[i] = r2; break; }
            S.saveRecords(all);
            A.sync.markMonthOf(r2);
          }
          openEntrySheet(rec.id);
        };
        el.querySelector('[data-del]').onclick = function () {
          close();
          UI.confirm('删除「' + rec.title + '」这一段？删掉后仍可从历史里找回旧版本。', '删除').then(function (ok) {
            if (!ok) return;
            var all = S.records().map(function (r) {
              if (r.id === rec.id) { r.deleted = true; r.updatedAt = new Date().toISOString(); }
              return r;
            });
            S.saveRecords(all);
            A.sync.markMonthOf(rec);
            A.sync.scheduleAuto(800);
            A.views.timeline.render();
            UI.toast('已删除');
          });
        };
        el.querySelector('[data-cancel]').onclick = close;
        el.querySelector('[data-save]').onclick = function () {
          var title = String(el.querySelector('#rd-title').value || '').trim();
          var st = el.querySelector('#rd-start').value;
          var en = el.querySelector('#rd-end').value;
          var draft = A.model.clone(rec);
          draft.title = title; draft.start = st; draft.end = en;
          draft.categoryId = cat; draft.tagIds = tags;
          draft.entries = ens;
          var sm = U.parseHm(st), em = U.parseHm(en);
          var v = A.model.validateRecord(draft);
          if (!v.ok) { UI.toast(v.errors[0]); return; }
          draft.startTs = tsOfDate(draft.date, sm);
          draft.endTs = tsOfDate(draft.date, em);
          draft.minutes = em - sm;
          close();
          var res = saveRecord(draft);
          if (res.overlap) {
            /* 用户是主动改这一段，重叠也照样保存，并且如实说明 */
            forceSave(draft);
            UI.toast('已保存（这段和其他记录有重叠）');
          } else {
            UI.toast('已保存');
          }
          A.views.timeline.render();
        };
      },
      onClose: function () { A.views.timeline.render(); }
    });
  }

  function openRecordSheetAfterEdit(id) {
    setTimeout(function () { openRecordSheet(id); }, 260);
  }

  function tsOfDate(dateStr, minutes) {
    if (minutes == null) return 0;
    var p = String(dateStr).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2], Math.floor(minutes / 60), minutes % 60, 0, 0).getTime();
  }

  /* ---------------- 渲染 ---------------- */
  function render(el) {
    var main = el || document.getElementById('main');
    var day = A.state.tlDay || U.dateStr();
    var recs = S.records().filter(function (r) { return !r.deleted && r.date === day; })
      .sort(function (a, b) { return (a.startTs || 0) - (b.startTs || 0); });
    var running = getRunning();
    var liveRec = isRunning(running) && running.date === day;

    A.state.tlDay = day;
    var totalMin = recs.reduce(function (s, r) { return s + (r.minutes || 0); }, 0);
    if (liveRec) totalMin += U.minutesBetween(running.startTs, Date.now());
    document.getElementById('tb-sub').textContent = U.dur(totalMin);

    var html = '';
    html += '<div class="tl-pane"><div class="tl-datebar">' +
      '<button class="btn sm ghost" data-day="-1">◀</button>' +
      '<span style="font-size:13px;color:var(--ink2)">' + U.esc(day) + ' 周' + U.weekday(day) +
      (day === U.dateStr() ? '（今天）' : '') + '</span>' +
      '<button class="btn sm ghost" data-day="1">▶</button></div></div>';

    var H = 24 * PXH;
    html += '<div class="tl-pane"><div class="tl-scroller" id="tl-scroller" style="height:' + H + 'px">';
    html += '<div class="tl-axis"></div>';
    for (var h = 0; h < 24; h++) {
      html += '<div class="tl-hour" style="top:' + (h * PXH) + 'px"></div>';
      html += '<div class="tl-hourlbl" style="top:' + (h * PXH) + 'px">' + U.pad(h) + ':00</div>';
    }

    function blockHTML(r) {
      var s = new Date(r.startTs), e = new Date(r.endTs);
      var top = (s.getHours() * 60 + s.getMinutes()) / 60 * PXH;
      var height = Math.max(26, (r.minutes || 0) / 60 * PXH);
      var color = A.meta.subjColor(r.categoryId);
      var t2 = r.start + '–' + r.end + ' · ' + U.dur(r.minutes);
      var t3 = [A.meta.catName(r.categoryId)].concat(A.meta.tagNames(r.tagIds)).filter(Boolean).join(' · ');
      return '<div class="tl-block" data-rec="' + r.id + '" style="top:' + top + 'px;height:' + height +
        'px;border-left-color:' + color + '">' +
        '<div class="t1">' + U.esc(r.title || '（未命名）') + '</div>' +
        '<div class="t2">' + U.esc(t2) + '</div>' +
        (height >= 52 && t3 ? '<div class="t3">' + U.esc(t3) + '</div>' : '') +
        ((r.entries && r.entries.length) ? '<div class="t3">· ' + r.entries.length + ' 条记录</div>' : '') +
        '</div>';
    }

    recs.forEach(function (r) { html += blockHTML(r); });

    if (liveRec) {
      var s2 = new Date(running.startTs);
      var top2 = (s2.getHours() * 60 + s2.getMinutes()) / 60 * PXH;
      html += '<div class="tl-block running" id="tl-live" style="top:' + top2 + 'px;height:26px;border-left-color:' +
        A.meta.subjColor(running.categoryId) + '">' +
        '<div class="t1">' + U.esc(running.title || '（未命名）') + '</div>' +
        '<div class="t2" id="tl-live-t">' + U.hhmm(running.startTs) + '– 进行中</div></div>';
    }

    var nowMin = (new Date().getHours() * 60 + new Date().getMinutes());
    if (day === U.dateStr()) {
      html += '<div class="tl-now" style="top:' + (nowMin / 60 * PXH) + 'px"></div>';
    }
    html += '</div></div>';

    html += '<div class="actionbar">' +
      '<button class="btn start" data-act="next">' + (liveRec ? '开始新任务' : '开始计时') + '</button>' +
      '<button class="btn note" data-act="note">记录一下</button>' +
      '</div>';

    main.innerHTML = '<div class="view">' + html + '</div>';

    /* 付带今日小结 */
    renderSummary(main, day, recs, liveRec, running);

    /* 自动滚到当前时间 */
    var scroller = document.getElementById('tl-scroller');
    var mainEl = document.getElementById('main');
    if (mainEl) {
      var target = Math.max(0, (nowMin / 60 * PXH) - 260);
      if (liveRec || day === U.dateStr()) mainEl.scrollTop = target;
    }
    void scroller;

    startTicking();
  }

  function renderSummary(main, day, recs, liveRec, running) {
    var wrap = main.querySelector('.view');
    if (!wrap) return;
    var byCat = {};
    recs.forEach(function (r) {
      var k = A.meta.catName(r.categoryId) || '未分类';
      byCat[k] = (byCat[k] || 0) + (r.minutes || 0);
    });
    if (liveRec) {
      var k2 = A.meta.catName(running.categoryId) || '未分类';
      byCat[k2] = (byCat[k2] || 0) + U.minutesBetween(running.startTs, Date.now());
    }
    var keys = Object.keys(byCat);
    var div = document.createElement('div');
    if (!keys.length && !liveRec) {
      div.className = 'empty';
      div.innerHTML = '这天还没有记录<br>点下面「开始计时」就开始吧';
      wrap.appendChild(div);
      return;
    }
    div.className = 'sec-title';
    div.textContent = '这天各段都做了什么';
    wrap.appendChild(div);
    var card = document.createElement('div');
    card.className = 'card tight';
    card.innerHTML = keys.map(function (k) {
      return '<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:13px">' +
        '<span>' + U.esc(k) + '</span><span style="color:var(--ink2);font-variant-numeric:tabular-nums">' +
        U.dur(byCat[k]) + '</span></div>';
    }).join('');
    wrap.appendChild(card);
  }

  function startTicking() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(function () {
      var r = getRunning();
      var el = document.getElementById('tl-live');
      var t = document.getElementById('tl-live-t');
      if (!r || !el) return;
      var mins = U.minutesBetween(r.startTs, Date.now());
      var top = (new Date(r.startTs).getHours() * 60 + new Date(r.startTs).getMinutes()) / 60 * PXH;
      el.style.top = top + 'px';
      el.style.height = Math.max(26, mins / 60 * PXH) + 'px';
      if (t) t.textContent = U.hhmm(r.startTs) + '– 进行中 · 已 ' + U.dur(mins);
      var sub = document.getElementById('tb-sub');
      if (sub) {
        var total = S.records().filter(function (x) { return !x.deleted && x.date === r.date; })
          .reduce(function (s, x) { return s + (x.minutes || 0); }, 0) + mins;
        sub.textContent = U.dur(total);
      }
    }, 1000);
  }

  function bind(rootEl) {
    rootEl.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-act],[data-rec],[data-day]') : null;
      if (!t) return;
      if (t.hasAttribute('data-day')) {
        var d = new Date(A.state.tlDay + 'T00:00:00');
        d.setDate(d.getDate() + (+t.getAttribute('data-day')));
        A.state.tlDay = U.dateStr(d);
        render(rootEl);
        return;
      }
      if (t.hasAttribute('data-rec')) { openRecordSheet(t.getAttribute('data-rec')); return; }
      var act = t.getAttribute('data-act');
      if (act === 'next') openNextSheet();
      if (act === 'note') openEntrySheet(null);
    });
  }

  A.views.timeline = {
    title: '时间轴',
    render: render,
    bind: bind,
    openEntrySheet: openEntrySheet,
    openNextSheet: openNextSheet,
    /* 供 app.js 在结算时取用暂存的"进行中条目" */
    takeLiveEntries: function (startTs) {
      var m = S.meta();
      var arr = (m.liveEntries && m.liveEntries[startTs]) || [];
      if (m.liveEntries) delete m.liveEntries[startTs];
      S.saveMeta(m);
      return arr;
    },
    settle: settle,
    settleAndSave: settleAndSave,
    isRunning: function () { return isRunning(getRunning()); }
  };
})(window);
