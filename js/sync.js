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
  var autoTimer = null;
  function scheduleAuto(delay) {
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = setTimeout(function () {
      autoTimer = null;
      pull().then(push).catch(function () { /* 静默：状态点已提示 */ });
    }, delay == null ? 1500 : delay);
  }

  function fullSync() {
    return pull().then(function (r) { return push().then(function () { return r; }); });
  }

  A.sync = {
    pull: pull, push: push, fullSync: fullSync,
    noteResult: noteResult,
    scheduleAuto: scheduleAuto,
    markDirty: markDirty,
    dirtyOf: dirtyOf,
    clearDirty: clearDirty,
    setStatus: setStatus,
    getStatus: function () { return status; },
    enqueueImage: enqueueImage,
    pushPendingImages: pushPendingImages,
    monthOf: monthOf,
    recordsFilePath: recordsFilePath,
    markMonthOf: function (record) { markDirty('month', monthOf(record)); }
  };
})(window);
