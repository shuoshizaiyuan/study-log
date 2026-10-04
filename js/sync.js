/* sync.js — 图片本地仓(IndexedDB) + 待传队列 + 与远端同步编排 */
(function (root) {
  'use strict';
  var A = root.App = root.App || {};
  var U = A.util, S = A.store;

  /* ================= 图片本地仓（IndexedDB，避免撑爆 localStorage） ================= */
  var DB = null;
  function openDB() {
    if (DB) return Promise.resolve(DB);
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) return reject(new Error('本机不支持图片存储'));
      var rq = indexedDB.open('study-log', 1);
      rq.onupgradeneeded = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains('imgs')) db.createObjectStore('imgs', { keyPath: 'id' });
      };
      rq.onsuccess = function () { DB = rq.result; resolve(DB); };
      rq.onerror = function () { reject(rq.error || new Error('图片库打开失败')); };
    });
  }
  function tx(mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction('imgs', mode);
        var st = t.objectStore('imgs');
        var rq = fn(st);
        t.oncomplete = function () { resolve(rq ? rq.result : undefined); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  var imgStore = A.imgStore = {
    put: function (rec) { return tx('readwrite', function (st) { st.put(rec); }); },
    get: function (id) { return tx('readonly', function (st) { return st.get(id); }); },
    del: function (id) { return tx('readwrite', function (st) { st.delete(id); }); },
    all: function () { return tx('readonly', function (st) { return st.getAll(); }); },
    /* 取得可显示的地址：优先本地，其次远端（私有仓库走 API 带鉴权） */
    src: function (meta) {
      if (!meta) return Promise.resolve('');
      return imgStore.get(meta.id).then(function (row) {
        if (row && row.dataUrl) return row.dataUrl;
        if (!meta.path) return '';
        var c = A.gh.cfg();
        if (!c.ready) return '';
        var url = 'https://api.github.com/repos/' + c.owner + '/' + c.repo +
          '/contents/' + meta.path + '?ref=' + encodeURIComponent(c.branch);
        return fetch(url, {
          headers: {
            'Authorization': 'Bearer ' + c.token,
            'Accept': 'application/vnd.github.raw',
            'X-GitHub-Api-Version': '2022-11-28'
          },
          cache: 'force-cache'
        }).then(function (r) {
          if (!r.ok) throw new Error('取图失败 ' + r.status);
          return r.blob();
        }).then(function (b) {
          return new Promise(function (res) {
            var fr = new FileReader();
            fr.onload = function () { res(fr.result); };
            fr.onerror = function () { res(''); };
            fr.readAsDataURL(b);
          });
        }).then(function (dataUrl) {
          if (dataUrl) {
            return imgStore.put({ id: meta.id, dataUrl: dataUrl, cachedAt: Date.now() })
              .then(function () { return dataUrl; });
          }
          return '';
        }).catch(function () { return ''; });
      });
    },
    stage: function (entry) { return imgStore.put(entry); }
  };

  /* ================= 变更标记 ================= */
  function metaGet() { return S.meta(); }
  function markDirty(kind, key) {
    var m = metaGet();
    m.dirty = m.dirty || {};
    m.dirty[kind] = m.dirty[kind] || {};
    m.dirty[kind][key] = 1;
    S.saveMeta(m);
  }
  function clearDirty(kind, keys) {
    var m = metaGet();
    if (m.dirty && m.dirty[kind]) {
      keys.forEach(function (k) { delete m.dirty[kind][k]; });
      S.saveMeta(m);
    }
  }
  function dirtyOf(kind) {
    var m = metaGet();
    return Object.keys((m.dirty && m.dirty[kind]) || {});
  }

  /* ================= 状态 ================= */
  var status = 'idle';
  function setStatus(s) {
    status = s;
    var dot = document.getElementById('sync-dot');
    if (dot) {
      dot.className = 'sync-dot ' + (s === 'ok' ? 'ok' : s === 'busy' ? 'busy' : s === 'err' ? 'err' : '');
      dot.title = s === 'ok' ? '已同步' : s === 'busy' ? '同步中' : s === 'err' ? '同步失败' : '未开同步';
    }
  }

  function monthOf(record) { return (record.date || '').slice(0, 7) || U.monthStr(); }
  function recordsFilePath(month) { return 'records/' + month + '.json'; }

  /* ================= 设备标识 + 进行中时段 =================
     计时本身完全在本地跑；这里只把"正在进行的那一段"的起点推上去，
     别的设备拿到起点后自己接着算，不需要持续上传。
     合并原则：本机的计时永远以本机为准；云端那份只用于在别的设备上显示（只读），
     绝不把云端的 running 直接搬成本机的 running —— 否则两台设备会互相把对方的计时清掉。 */
  var RUNNING_FILE = 'running.json';
  var DEV = '';

  function deviceId() {
    if (DEV) return DEV;
    try {
      var m = S.meta();
      if (!m.deviceId) { m.deviceId = U.uid(); S.saveMeta(m); }
      DEV = m.deviceId;
    } catch (e) { DEV = DEV || 'dev-unknown'; }
    return DEV;
  }

  /* 本机 running → 上传用的载荷（结束计时时 running 为 null，用来让别的设备也停下） */
  function localRunningPayload() {
    var r = S.running();
    var out = (r && r.startTs) ? {
      startTs: r.startTs,
      date: r.date || U.dateStr(),
      title: r.title || '',
      taskId: r.taskId || null,
      categoryId: r.categoryId || null,
      tagIds: r.tagIds || [],
      deviceId: deviceId(),
      /* 如果本机这段是"接手"了另一台设备的，要带上，让那台设备知道停表 */
      adoptedFrom: r.adoptedFrom || null
    } : null;
    return { running: out, deviceId: deviceId(), updatedAt: new Date().toISOString() };
  }

  /* 开始 / 结束计时时调用。
     注意：这里**不等常规节流**（那会把上传推迟最多 8 秒，手机一切走就永远传不上去），
     而是立刻单独把 running.json 推上去（只有 2 个请求）。 */
  var runPushing = false, runPending = false, runKick = false, lastRunPush = null;

  /* ================= 交叉收账（同一时刻全世界只允许一段计时在跑） =================
     规则：起跑晚的是「现任」。本机一旦发现云端有【别的设备、且起跑比本机晚】的活跃会话，
     就把本机这段自动结算成一条记录（终点 = 对方的起点），然后停表；
     **不回推 running**（云端那份是现任推的，不能盖掉）。
     检查点有两处：① pull 时看到（对方已推上来）② 推 running 前读到（本机之前没传上去）。
     两台设备无论谁先谁后推上去，最终都收敛成：先开始的记到后开始的起点为止 —— 不重叠、不丢时间。 */
  function concedeLocal(remote) {
    var cur = S.running();
    if (!cur || !cur.startTs) return false;
    if (!remote || !remote.startTs) return false;
    if (remote.deviceId && remote.deviceId === deviceId()) return false;
    if (remote.adoptedFrom && remote.adoptedFrom === deviceId()) return false;  /* 被接手走 takeover，不收账 */
    if (remote.startTs <= cur.startTs) return false;                            /* 对方起跑更早 → 本机是现任，不动 */
    var endTs = remote.startTs;
    var m0 = S.meta();
    var stashed = [];
    if (m0.liveEntries && m0.liveEntries[cur.startTs]) {
      stashed = m0.liveEntries[cur.startTs];
      delete m0.liveEntries[cur.startTs];
      S.saveMeta(m0);
    }
    if (endTs - cur.startTs < 60000 && !stashed.length) {
      /* 不足 1 分钟且什么都没记：与手动结算同口径，当作误触，不产生记录 */
    } else {
      if (endTs - cur.startTs < 60000) endTs = cur.startTs + 60000;   /* 太短但有内容：补足 1 分钟 */
      var rec = A.model.newRecord({
        date: cur.date || U.dateStr(new Date(cur.startTs)),
        start: U.hhmm(cur.startTs), end: U.hhmm(endTs),
        startTs: cur.startTs, endTs: endTs,
        minutes: U.minutesBetween(cur.startTs, endTs),
        title: cur.title || '', taskId: cur.taskId || null,
        categoryId: cur.categoryId || null, tagIds: cur.tagIds || [],
        entries: stashed
      });
      var all = S.records(); all.push(rec); S.saveRecords(all);
      A.sync.markMonthOf(rec);
    }
    S.setRunning(null);
    clearDirty('running', ['running']);
    runPending = false;   /* 取消排队中的 running 推送，防止把 null 推上去盖掉现任 */
    var m = S.meta();
    m.concede = { at: new Date().toISOString(), title: cur.title || '', startTs: cur.startTs, endTs: endTs, byDevice: remote.deviceId || '' };
    S.saveMeta(m);
    return true;
  }

  /* ================= 记录层兜底收账（并行到底的两段，落成记录后也要理顺） =================
     场景：两台设备互不知情地并行计时到各自结束（期间零同步），会落成两条时间重叠的记录。
     法则与事中收账同一条：起跑晚的是现任，先开始的段自动截断到现任的起点。
     - 软删记录不参与；端点相接（一段的结束 == 另一段的开始）不算重叠。
     - 截后不足 1 分钟：无 entries 按误触口径软删；有 entries 保留（打卡事实不丢）。
     - 被改的记录更新 updatedAt（LWW 能同步出去）并标记所在月 dirty。
     - 规则是确定性函数：两台设备对同一组记录算出的结果一致，收敛无拉锯。 */
  function reconcileOverlaps() {
    var fixed = 0, removed = 0;
    function aliveNow() {
      return S.records().filter(function (r) {
        return r && !r.deleted && r.startTs > 0 && r.endTs > r.startTs;
      });
    }
    for (;;) {
      var alive = aliveNow(), hit = null;
      for (var i = 0; i < alive.length && !hit; i++) {
        for (var j = i + 1; j < alive.length; j++) {
          var a = alive[i], b = alive[j];
          var loser, winner;
          if (a.startTs !== b.startTs) {
            loser = a.startTs < b.startTs ? a : b;          /* 起跑早的让位 */
          } else if (String(a.updatedAt || '') !== String(b.updatedAt || '')) {
            loser = String(a.updatedAt || '') < String(b.updatedAt || '') ? a : b;
          } else {
            loser = String(a.id) > String(b.id) ? a : b;    /* 兜底 tie-break，保证确定 */
          }
          winner = loser === a ? b : a;
          if (loser.endTs > winner.startTs) { hit = { l: loser, w: winner }; break; }
        }
      }
      if (!hit) break;
      var L = hit.l, W = hit.w;
      var newEnd = W.startTs;
      var dur = newEnd - L.startTs;
      var hasContent = !!(L.entries && L.entries.length);
      var all = S.records();
      var at = new Date().toISOString();
      for (var k = 0; k < all.length; k++) {
        if (all[k].id !== L.id) continue;
        if (dur <= 0 || (dur < 60000 && !hasContent)) {
          /* 不足 1 分钟且无内容 → 软删（deleted 会同步过去；硬删会被对方合并回来） */
          all[k].deleted = true;
          removed++;
        } else {
          all[k].endTs = newEnd;
          all[k].end = U.hhmm(newEnd);
          all[k].minutes = U.minutesBetween(L.startTs, newEnd);
          fixed++;
        }
        all[k].updatedAt = at;
        markDirty('month', monthOf(all[k]));
        break;
      }
      S.saveRecords(all);
    }
    return { fixed: fixed, removed: removed };
  }

  /* 推 running.json：先读云端，若「现任」已换成起跑更晚的别家设备 → 本机改为收账、不推。
     请求量与原 putWithRetry 相同（读 1 次 + 写 1 次）。 */
  function pushRunningFile(tries) {
    tries = (tries == null) ? 2 : tries;
    return A.gh.readFile(RUNNING_FILE).then(function (f) {
      var data = null;
      try { data = f ? JSON.parse(f.text) : null; } catch (e) { data = null; }
      var rem = (data && data.running) ? data.running : null;
      if (rem && concedeLocal(rem)) return { conceded: true };
      var payload = localRunningPayload();
      if (!payload.running && rem && rem.deviceId && rem.deviceId !== deviceId()) {
        /* 本机已停表，但云端是别的设备的活跃会话 → 绝不推 null 去盖掉它（现任要自己收） */
        return { skipped: true };
      }
      return A.gh.writeFile(RUNNING_FILE, JSON.stringify(payload, null, 2),
        f ? f.sha : null, 'running: ' + (payload.running ? payload.running.title : 'idle'))
        .catch(function (e) {
          if ((e.status === 409 || e.status === 422) && tries > 0) {
            return new Promise(function (r) { setTimeout(r, 350); })
              .then(function () { return pushRunningFile(tries - 1); });
          }
          throw e;
        });
    });
  }

  function effectRunPush() {
    return pushRunningFile()
      .then(function (res) {
        clearDirty('running', ['running']);
        var nowRun = S.running();
        lastRunPush = { ok: true, at: Date.now(), running: !!(nowRun && nowRun.startTs), title: (nowRun && nowRun.title) || '', conceded: !!(res && res.conceded) };
      })
      .catch(function (e) {
        /* 失败不吞掉：保留待传标记，下一次常规同步会补上 */
        lastRunPush = { ok: false, at: Date.now(), msg: (e && e.message) || String(e) };
      });
  }

  function pushRunningNow() {
    runPending = true;
    if (runPushing || runKick) return;      /* 同一个同步块内的多次调用会合并成一次 */
    runKick = true;
    Promise.resolve().then(function () {     /* 微任务：等本轮同步代码全部跑完再推最终状态 */
      runKick = false;
      if (!runPending || runPushing) return;
      var c = A.gh.cfg();
      if (!c.ready) { runPending = false; lastRunPush = { ok: false, at: Date.now(), msg: '同步未开启' }; return; }
      runPushing = true;
      (function step() {
        if (!runPending) { runPushing = false; return; }
        runPending = false;
        effectRunPush().then(function () { if (runPending) step(); else runPushing = false; });
      })();
    });
  }

  function markRunning() {
    markDirty('running', 'running');
    pushRunningNow();
  }

  /* 上一次"进行中时段"上传的结果（设置页显示用） */
  function runPushState() { return lastRunPush; }

  /* 云端那份"进行中时段"，且不是本机推的 —— 用来在别的设备上显示 */
  function remoteRunning() {
    var r = S.meta().remoteRunning;
    if (!r || !r.startTs) return null;
    if (r.deviceId && r.deviceId === deviceId()) return null;
    return r;
  }

  /* 记录最近一次同步结果，供设置页显示与排查 */
  function noteResult(ok, msg) {
    try {
      var m = S.meta();
      m.lastSync = { ok: !!ok, msg: String(msg || ''), at: new Date().toISOString() };
      S.saveMeta(m);
    } catch (e) { /* 记录失败不影响同步本身 */ }
  }

  /* ================= 拉取 + 合并 ================= */
  function pull() {
    var c = A.gh.cfg();
    if (!c.ready) return Promise.resolve({ skipped: true });
    setStatus('busy');
    var summary = { settings: false, tasks: false, months: [], conflicts: [] };

    return A.gh.readFile('settings.json').then(function (f) {
      var remote = null;
      try { remote = f ? JSON.parse(f.text) : null; } catch (e) { remote = null; }
      S.saveSettings(A.gh.mergeSettings(S.settings(), remote));
      summary.settings = true;
      return A.gh.readFile('tasks.json');
    }).then(function (f) {
      var remote = [];
      try { remote = (f ? JSON.parse(f.text) : {}).tasks || []; } catch (e) { remote = []; }
      S.saveTasks(A.gh.mergeTasks(S.tasks(), remote));
      summary.tasks = true;
      return A.gh.readFile(RUNNING_FILE);
    }).then(function (f) {
      var data = null;
      try { data = f ? JSON.parse(f.text) : null; } catch (e) { data = null; }
      var prev = S.meta().remoteRunning;
      var next = (data && data.running && data.running.startTs) ? data.running : null;
      var changed = String((prev && prev.startTs) || '') !== String((next && next.startTs) || '') ||
        String((prev && prev.deviceId) || '') !== String((next && next.deviceId) || '');
      var me = deviceId();

      /* 本机这段被另一台设备"接手"了 → 本机立刻停表，且**不产生记录**（避免同一时段记成两条）。
         这里故意不回推 null：云端那份是接手方推的，应该让它继续存在。 */
      var adoptedMe = !!(next && next.adoptedFrom && next.adoptedFrom === me && next.deviceId !== me);
      if (adoptedMe) {
        var cur = S.running();
        if (cur && cur.startTs) {
          var mT = S.meta();
          if (mT.liveEntries && mT.liveEntries[cur.startTs]) delete mT.liveEntries[cur.startTs];
          S.saveMeta(mT);
          summary.tookOver = true;
        }
      } else if (next && next.deviceId && next.deviceId !== me) {
        /* 交叉收账：对方起跑比本机晚 → 本机让位（截断成记录、停表、不回推 running） */
        if (concedeLocal(next)) summary.conceded = true;
      }

      var mm0 = S.meta();
      if (adoptedMe) mm0.takeover = { at: new Date().toISOString(), title: next.title || '', startTs: next.startTs };
      mm0.remoteRunning = next;
      mm0.remoteRunningAt = (data && data.updatedAt) || '';
      S.saveMeta(mm0);
      if (summary.tookOver) S.setRunning(null);
      summary.running = true;
      summary.runningChanged = changed;
      return A.gh.listDir('records');
    }).then(function (list) {
      var months = [];
      (list || []).forEach(function (it) {
        var m = /^(\d{4}-\d{2})\.json$/.exec(it.name || '');
        if (m && months.indexOf(m[1]) < 0) months.push(m[1]);
      });
      S.records().forEach(function (r) {
        var mo = monthOf(r);
        if (months.indexOf(mo) < 0) months.push(mo);
      });
      /* 兜底：目录列举失败（或不巧是空的）时，最近两个月一定要读一遍，
         否则新设备第一次同步可能什么都取不到 */
      if (!(list || []).length) {
        var dnow = new Date();
        [U.monthStr(dnow), U.monthStr(new Date(dnow.getFullYear(), dnow.getMonth() - 1, 1))].forEach(function (mo) {
          if (months.indexOf(mo) < 0) months.push(mo);
        });
      }
      return months.reduce(function (p, mo) {
        return p.then(function () {
          return A.gh.readFile(recordsFilePath(mo)).then(function (f) {
            var remote = [];
            try { remote = (f ? JSON.parse(f.text) : {}).records || []; } catch (e) { remote = []; }
            var local = S.records().filter(function (r) { return monthOf(r) === mo; });
            var res = A.gh.mergeList(local, remote);
            var others = S.records().filter(function (r) { return monthOf(r) !== mo; });
            S.saveRecords(others.concat(res.records));
            if (res.conflicts.length) {
              res.conflicts.forEach(function (cf) {
                cf.month = mo;
                summary.conflicts.push(cf);
                markDirty('month', mo);
              });
              var mm = S.meta();
              mm.history = (mm.history || []).concat(summary.conflicts.slice(-20));
              if (mm.history.length > 200) mm.history = mm.history.slice(-200);
              S.saveMeta(mm);
            }
            if (summary.months.indexOf(mo) < 0) summary.months.push(mo);
          });
        });
      }, Promise.resolve());
    }).then(function () {
      /* 记录层兜底收账：把并行到底产生的重叠记录理顺（先开始的让位） */
      var fix = reconcileOverlaps();
      if (fix.fixed) summary.overlapFixed = fix.fixed;
      if (fix.removed) summary.overlapRemoved = fix.removed;
      setStatus('ok');
      noteResult(true, '');
      return summary;
    }).catch(function (e) {
      setStatus('err');
      noteResult(false, e.message || String(e));
      throw e;
    });
  }

  /* ================= 推送 ================= */
  function putWithRetry(name, text, message, tries) {
    tries = (tries == null) ? 3 : tries;
    return A.gh.readFile(name).then(function (f) {
      return A.gh.writeFile(name, text, f ? f.sha : null, message);
    }).catch(function (e) {
      if ((e.status === 409 || e.status === 422) && tries > 0) {
        return new Promise(function (r) { setTimeout(r, 350); })
          .then(function () { return putWithRetry(name, text, message, tries - 1); });
      }
      throw e;
    });
  }

  function push() {
    var c = A.gh.cfg();
    if (!c.ready) return Promise.resolve({ skipped: true });
    setStatus('busy');
    var chain = Promise.resolve();

    if (dirtyOf('settings').length) {
      chain = chain.then(function () {
        var s = S.settings(); s.updatedAt = new Date().toISOString();
        return putWithRetry('settings.json', JSON.stringify(s, null, 2), 'settings: update')
          .then(function () { clearDirty('settings', ['settings']); });
      });
    }
    if (dirtyOf('tasks').length) {
      chain = chain.then(function () {
        return putWithRetry('tasks.json', JSON.stringify({ tasks: S.tasks() }, null, 2), 'tasks: update')
          .then(function () { clearDirty('tasks', ['tasks']); });
      });
    }
    dirtyOf('month').forEach(function (mo) {
      chain = chain.then(function () {
        var arr = S.records().filter(function (r) { return monthOf(r) === mo; });
        var payload = JSON.stringify({ month: mo, records: arr }, null, 1);
        return putWithRetry(recordsFilePath(mo), payload, 'records: ' + mo + ' (' + arr.length + ')')
          .then(function () { clearDirty('month', [mo]); });
      });
    });
    /* 进行中时段：只推"起点"，别的设备拿到后自己接着算。
       推前会先读云端做收账检查（对方起跑更晚 → 本机让位，不推）。 */
    if (dirtyOf('running').length) {
      chain = chain.then(function () {
        return pushRunningFile()
          .then(function () { clearDirty('running', ['running']); });
      });
    }
    return chain.then(pushPendingImages).then(function () {
      setStatus('ok');
      noteResult(true, '');
      return { ok: true };
    }).catch(function (e) {
      setStatus('err');
      noteResult(false, e.message || String(e));
      throw e;
    });
  }

  /* ================= 图片上传 ================= */
  function pushPendingImages() {
    return S.queue().reduce(function (p, item) {
      return p.then(function (stop) {
        if (stop) return stop;
        if (item.kind !== 'image') return false;
        var path = 'evidence/' + item.month + '/' + item.name;
        return A.gh.writeFile(path, item.base64, null, 'evidence: ' + item.name)
          .then(function () {
            S.saveQueue(S.queue().filter(function (x) { return x.id !== item.id; }));
            return false;
          })
          .catch(function (e) {
            if (e.status === 422) {
              S.saveQueue(S.queue().filter(function (x) { return x.id !== item.id; }));
              return false;
            }
            return true;
          });
      });
    }, Promise.resolve(false)).then(function () { return true; });
  }

  function enqueueImage(compressed, name) {
    var item = {
      id: U.uid(),
      kind: 'image',
      name: name,
      month: U.monthStr(),
      base64: compressed.base64,
      w: compressed.w, h: compressed.h,
      at: Date.now()
    };
    var q = S.queue(); q.push(item); S.saveQueue(q);
    return item.id;
  }

  /* ================= 对外接口 ================= */
  /* 自动同步：节流 + 串行。
     - 两次同步之间至少隔 MIN_GAP，短时间内的多次触发会被合并成一次
     - 同步进行中再来的请求，只排一次队，不并发 */
  var MIN_GAP = 8000;
  var autoTimer = null, syncing = false, pendingAgain = false, lastAt = 0;

  function refreshTimeline() {
    try {
      if (A.state && A.state.view === 'timeline' && A.views && A.views.timeline) A.views.timeline.render();
    } catch (e) { /* 刷新失败不影响同步 */ }
  }

  function runNow() {
    if (syncing) { pendingAgain = true; return Promise.resolve({ queued: true }); }
    syncing = true;
    lastAt = Date.now();
    return fullSync().then(function (r) {
      if (r && r.tookOver) {
        refreshTimeline();
        A.ui.toast('这段已被另一台设备接手，本机已停止计时（不会重复记一条）', 5000);
      } else if (r && r.conceded) {
        refreshTimeline();
        var cd = S.meta().concede;
        A.ui.toast('另一台设备开始了新任务，本机这段已自动收账（记到 ' + U.hhmm((cd && cd.endTs) || Date.now()) + ' 为止，不重叠）', 5000);
      } else if (r && (r.overlapFixed || r.overlapRemoved)) {
        refreshTimeline();
        A.ui.toast('发现并行时段的重叠记录，已按「先开始的让位」自动理顺', 5000);
      } else if (r && r.runningChanged) {
        refreshTimeline();
      }
      return r;
    }).catch(function (e) {
      /* 静默：状态点已提示，设置页也能看到详情 */
      return { error: (e && e.message) || String(e) };
    }).then(function (r) {
      syncing = false;
      if (pendingAgain) { pendingAgain = false; return runNow(); }
      return r;
    });
  }

  function scheduleAuto(delay) {
    var d = (delay == null) ? 1500 : delay;
    var since = Date.now() - lastAt;
    if (since < MIN_GAP) d = Math.max(d, MIN_GAP - since);
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = setTimeout(function () { autoTimer = null; runNow(); }, d);
  }

  function fullSync() {
    return pull().then(function (r) { return push().then(function () { return r; }); });
  }

  A.sync = {
    pull: pull, push: push, fullSync: fullSync,
    noteResult: noteResult,
    scheduleAuto: scheduleAuto,
    runNow: runNow,
    markRunning: markRunning,
    pushRunningNow: pushRunningNow,
    runPushState: runPushState,
    remoteRunning: remoteRunning,
    localRunningPayload: localRunningPayload,
    deviceId: deviceId,
    RUNNING_FILE: RUNNING_FILE,
    markDirty: markDirty,
    dirtyOf: dirtyOf,
    clearDirty: clearDirty,
    setStatus: setStatus,
    getStatus: function () { return status; },
    enqueueImage: enqueueImage,
    pushPendingImages: pushPendingImages,
    monthOf: monthOf,
    recordsFilePath: recordsFilePath,
    markMonthOf: function (record) { markDirty('month', monthOf(record)); },
    concede: concedeLocal,
    pushRunningFile: pushRunningFile,
    reconcileOverlaps: reconcileOverlaps
  };
})(window);
