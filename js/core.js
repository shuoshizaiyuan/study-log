/* core.js — 基础工具 / 数据模型 / 本地存储 / 通用 UI */
(function (root) {
  'use strict';
  var A = root.App = root.App || {};

  /* ---------------- 工具 ---------------- */
  var U = A.util = {
    pad: function (n) { return (n < 10 ? '0' : '') + n; },
    uid: function () {
      return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
    },
    esc: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },
    dateStr: function (d) {
      d = d || new Date();
      return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate());
    },
    monthStr: function (d) {
      d = d || new Date();
      return d.getFullYear() + '-' + U.pad(d.getMonth() + 1);
    },
    hhmm: function (d) {
      d = (d === undefined || d === null) ? new Date() : (d instanceof Date ? d : new Date(d));
      return U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
    },
    hhmmss: function (d) {
      d = (d === undefined || d === null) ? new Date() : (d instanceof Date ? d : new Date(d));
      return U.hhmm(d) + ':' + U.pad(d.getSeconds());
    },
    parseHm: function (s) {
      var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
      if (!m) return null;
      var h = +m[1], mi = +m[2];
      if (h > 23 || mi > 59) return null;
      return h * 60 + mi;
    },
    minutesBetween: function (tsA, tsB) { return Math.max(0, Math.round((tsB - tsA) / 60000)); },
    dur: function (min) {
      min = Math.max(0, Math.round(min || 0));
      var h = Math.floor(min / 60), m = min % 60;
      if (h && m) return h + 'h' + m + 'm';
      if (h) return h + 'h';
      return m + 'min';
    },
    clock: function (sec) {
      sec = Math.max(0, Math.floor(sec || 0));
      var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
      return U.pad(h) + ':' + U.pad(m) + ':' + U.pad(s);
    },
    nowTs: function () { return Date.now(); },
    clone: function (o) { return JSON.parse(JSON.stringify(o)); },
    weekday: function (ds) {
      var p = ds.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2]);
      return '日一二三四五六'[d.getDay()];
    },
    cmpUpdated: function (a, b) {
      return String(a && a.updatedAt || '').localeCompare(String(b && b.updatedAt || ''));
    },
    download: function (filename, text, mime) {
      var blob = new Blob(['\ufeff' + text], { type: (mime || 'text/plain') + ';charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 400);
    },
    /* 图片压缩：长边 1600，jpeg 质量 0.8 */
    compressImage: function (file, maxSide, quality) {
      maxSide = maxSide || 1600; quality = quality || 0.8;
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onerror = function () { reject(new Error('读取图片失败')); };
        fr.onload = function () {
          var img = new Image();
          img.onerror = function () { reject(new Error('图片解析失败')); };
          img.onload = function () {
            var w = img.naturalWidth, h = img.naturalHeight;
            var scale = Math.min(1, maxSide / Math.max(w, h));
            var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
            var c = document.createElement('canvas');
            c.width = cw; c.height = ch;
            c.getContext('2d').drawImage(img, 0, 0, cw, ch);
            var dataUrl = c.toDataURL('image/jpeg', quality);
            resolve({ dataUrl: dataUrl, base64: dataUrl.split(',')[1], w: cw, h: ch });
          };
          img.src = fr.result;
        };
        fr.readAsDataURL(file);
      });
    }
  };

  /* ---------------- 本地存储 ---------------- */
  var KEYS = {
    settings: 'sl.settings',
    tasks: 'sl.tasks',
    records: 'sl.records',      // 全量记录缓存（含远端合并结果）
    queue: 'sl.queue',          // 待上传队列
    running: 'sl.running',      // 正在进行的时段
    sync: 'sl.synccfg',         // owner/repo(token) —— 仅本机
    meta: 'sl.meta'
  };

  function readJSON(k, def) {
    try {
      var raw = localStorage.getItem(k);
      if (!raw) return def;
      var v = JSON.parse(raw);
      return v == null ? def : v;
    } catch (e) { return def; }
  }
  function writeJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { A.ui.toast('本机存储写入失败：' + e.message); return false; }
  }

  var DEFAULT_SETTINGS = {
    categories: [
      { id: 'c-study', name: '日常学习' },
      { id: 'c-recite', name: '背诵' },
      { id: 'c-paper', name: '真题演练' },
      { id: 'c-review', name: '整理复习' }
    ],
    tags: [],
    presets: [45, 60, 90],
    updatedAt: ''
  };

  var Store = A.store = {
    KEYS: KEYS,
    settings: function () {
      var s = readJSON(KEYS.settings, null);
      if (!s) return U.clone(DEFAULT_SETTINGS);
      s.categories = s.categories || [];
      s.tags = s.tags || [];
      s.presets = (s.presets && s.presets.length) ? s.presets : [45, 60, 90];
      return s;
    },
    saveSettings: function (s) {
      s.updatedAt = new Date().toISOString();
      return writeJSON(KEYS.settings, s);
    },
    tasks: function () { return readJSON(KEYS.tasks, { tasks: [] }).tasks || []; },
    saveTasks: function (arr) { return writeJSON(KEYS.tasks, { tasks: arr }); },
    records: function () { return readJSON(KEYS.records, { records: [] }).records || []; },
    saveRecords: function (arr) { return writeJSON(KEYS.records, { records: arr }); },
    queue: function () { return readJSON(KEYS.queue, []); },
    saveQueue: function (q) { return writeJSON(KEYS.queue, q); },
    running: function () { return readJSON(KEYS.running, null); },
    setRunning: function (r) {
      if (!r) { localStorage.removeItem(KEYS.running); return; }
      writeJSON(KEYS.running, r);
    },
    syncCfg: function () {
      var c = readJSON(KEYS.sync, { owner: '', repo: '', token: '', branch: 'main', enabled: false });
      c.owner = c.owner || ''; c.repo = c.repo || ''; c.token = c.token || '';
      c.branch = c.branch || 'main';
      return c;
    },
    saveSyncCfg: function (c) { return writeJSON(KEYS.sync, c); },
    meta: function () { return readJSON(KEYS.meta, {}); },
    saveMeta: function (m) { return writeJSON(KEYS.meta, m); },
    exportAll: function () {
      return {
        exportedAt: new Date().toISOString(),
        settings: Store.settings(),
        tasks: Store.tasks(),
        records: Store.records()
      };
    },
    importAll: function (data) {
      if (!data || typeof data !== 'object') throw new Error('文件格式不对');
      if (data.settings) Store.saveSettings(data.settings);
      if (Array.isArray(data.tasks)) Store.saveTasks(data.tasks);
      if (Array.isArray(data.records)) Store.saveRecords(data.records);
    },
    wipe: function () {
      Object.keys(KEYS).forEach(function (k) {
        if (k === KEYS.sync) return;
        localStorage.removeItem(KEYS[k]);
      });
    }
  };

  /* ---------------- 数据模型 ---------------- */
  var Model = A.model = {
    clone: U.clone,
    newRecord: function (o) {
      o = o || {};
      var now = new Date().toISOString();
      return {
        id: o.id || U.uid(),
        date: o.date || U.dateStr(),
        start: o.start || '',
        end: o.end || '',
        startTs: o.startTs || 0,
        endTs: o.endTs || 0,
        minutes: o.minutes || 0,
        title: o.title || '',
        taskId: o.taskId || null,
        categoryId: o.categoryId || null,
        tagIds: o.tagIds || [],
        entries: o.entries || [],
        createdAt: o.createdAt || now,
        updatedAt: o.updatedAt || now,
        deleted: !!o.deleted
      };
    },
    newEntry: function (o) {
      o = o || {};
      var now = new Date().toISOString();
      return {
        id: o.id || U.uid(),
        at: o.at || U.hhmm(),
        atTs: o.atTs || U.nowTs(),
        text: o.text || '',
        images: o.images || [],   // [{name, path, w, h}]
        createdAt: o.createdAt || now,
        updatedAt: o.updatedAt || now
      };
    },
    newTask: function (o) {
      o = o || {};
      var now = new Date().toISOString();
      return {
        id: o.id || U.uid(),
        title: o.title || '',
        categoryId: o.categoryId || null,
        tagIds: o.tagIds || [],
        quadrant: o.quadrant || 'q1',
        dueDate: o.dueDate || null,
        presetMinutes: o.presetMinutes || null,
        archived: !!o.archived,
        lastUsedAt: o.lastUsedAt || null,
        createdAt: o.createdAt || now,
        updatedAt: o.updatedAt || now
      };
    },
    /* 完整性校验：缺字段补默认值，不抛错 */
    repairRecord: function (r) {
      if (!r || typeof r !== 'object' || !r.id) return null;
      var base = Model.newRecord({
        id: r.id, date: r.date, start: r.start, end: r.end,
        startTs: r.startTs, endTs: r.endTs, minutes: r.minutes,
        title: r.title, taskId: r.taskId, categoryId: r.categoryId,
        tagIds: Array.isArray(r.tagIds) ? r.tagIds : [],
        entries: [], createdAt: r.createdAt, updatedAt: r.updatedAt,
        deleted: r.deleted
      });
      base.entries = (Array.isArray(r.entries) ? r.entries : []).map(function (e) {
        if (!e || !e.id) return null;
        return {
          id: e.id,
          at: e.at || (e.atTs ? U.hhmm(e.atTs) : ''),
          atTs: e.atTs || 0,
          text: e.text || '',
          images: Array.isArray(e.images) ? e.images.filter(function (im) { return im && im.name; }) : [],
          createdAt: e.createdAt || base.createdAt,
          updatedAt: e.updatedAt || base.updatedAt
        };
      }).filter(Boolean);
      if (!base.minutes && base.startTs && base.endTs) base.minutes = U.minutesBetween(base.startTs, base.endTs);
      return base;
    },
    validateRecord: function (r) {
      var errs = [];
      if (!r.title) errs.push('任务名不能为空');
      var sm = U.parseHm(r.start), em = U.parseHm(r.end);
      if (sm == null) errs.push('开始时间格式不对');
      if (em == null) errs.push('结束时间格式不对');
      if (sm != null && em != null && em <= sm) errs.push('结束时间必须晚于开始时间');
      var durMin = (sm != null && em != null) ? (em - sm) : 0;
      if (durMin > 12 * 60) errs.push('这段时间超过 12 小时，请确认是否填错');
      return { ok: errs.length === 0, errors: errs };
    },
    validateTask: function (t) {
      var errs = [];
      if (!t.title) errs.push('任务名不能为空');
      return { ok: errs.length === 0, errors: errs };
    }
  };

  /* ---------------- 通用 UI：toast / sheet / 确认 ---------------- */
  var UI = A.ui = {
    toast: function (msg, ms) {
      var rootEl = document.getElementById('toast-root');
      if (!rootEl) return;
      var el = document.createElement('div');
      el.className = 'toast'; el.textContent = msg;
      rootEl.appendChild(el);
      setTimeout(function () { el.remove(); }, ms || 2200);
    },
    /* sheet({title, bodyHTML, footHTML, onMount, onClose}) */
    sheet: function (opt) {
      var rootEl = document.getElementById('sheet-root');
      rootEl.innerHTML = '';
      rootEl.classList.add('on');
      var mask = document.createElement('div'); mask.className = 'sheet-mask';
      var sh = document.createElement('div'); sh.className = 'sheet';
      sh.innerHTML =
        '<div class="sheet-head"><b>' + U.esc(opt.title || '') + '</b>' +
        '<button class="close" data-close>关闭</button></div>' +
        '<div class="sheet-body">' + (opt.bodyHTML || '') + '</div>' +
        (opt.footHTML ? '<div class="sheet-foot">' + opt.footHTML + '</div>' : '');
      rootEl.appendChild(mask); rootEl.appendChild(sh);

      var closed = false;
      function close() {
        if (closed) return;
        closed = true;
        sh.classList.remove('open'); mask.classList.remove('open');
        /* 立刻放开点击，避免关闭后这两百多毫秒里整页点不动 */
        if (!rootEl.querySelector('.lightbox')) rootEl.classList.remove('on');
        /* 只回收自己这两个节点，绝不整块清空，避免把随后新开的弹层一起抹掉 */
        setTimeout(function () {
          if (sh.parentNode) sh.remove();
          if (mask.parentNode) mask.remove();
        }, 240);
        if (opt.onClose) opt.onClose();
      }
      mask.addEventListener('click', close);
      sh.querySelector('[data-close]').addEventListener('click', close);
      requestAnimationFrame(function () { sh.classList.add('open'); mask.classList.add('open'); });

      A.ui._closeSheet = close;
      if (opt.onMount) opt.onMount(sh, close);
      return { el: sh, close: close };
    },
    closeSheet: function () { if (A.ui._closeSheet) A.ui._closeSheet(); },
    confirm: function (msg, okText) {
      return new Promise(function (resolve) {
        var done = false;
        function finish(v) { if (done) return; done = true; resolve(v); }
        var r = A.ui.sheet({
          title: '请确认',
          bodyHTML: '<p style="font-size:14px;line-height:1.8;margin:8px 0 4px">' + U.esc(msg) + '</p>',
          footHTML: '<button class="btn ghost" data-no>取消</button>' +
            '<button class="btn primary" data-yes>' + U.esc(okText || '确定') + '</button>',
          onMount: function (el, close) {
            el.querySelector('[data-no]').onclick = function () { finish(false); close(); };
            el.querySelector('[data-yes]').onclick = function () { finish(true); close(); };
          },
          onClose: function () { finish(false); }
        });
        void r;
      });
    },
    pickSheet: function (title, items, onPick) {
      var html = '<div class="row wrap" style="padding:6px 0 10px">' +
        items.map(function (it, i) {
          return '<button class="chip" data-i="' + i + '">' + U.esc(it.label) + '</button>';
        }).join('') + '</div>';
      A.ui.sheet({
        title: title, bodyHTML: html,
        onMount: function (el, close) {
          el.querySelectorAll('[data-i]').forEach(function (b) {
            b.onclick = function () { close(); onPick(items[+b.dataset.i]); };
          });
        }
      });
    },
    lightbox: function (url) {
      var rootEl = document.getElementById('sheet-root');
      var wrap = document.createElement('div');
      wrap.className = 'lightbox';
      wrap.innerHTML = '<button class="lbx">关闭</button><img src="' + url + '" alt="">';
      function shut() {
        if (!wrap.parentNode) return;
        wrap.remove();
        if (!rootEl.querySelector('.sheet') && !rootEl.querySelector('.lightbox')) {
          rootEl.classList.remove('on');
        }
      }
      wrap.querySelector('.lbx').onclick = shut;
      wrap.onclick = function (e) { if (e.target === wrap) shut(); };
      rootEl.appendChild(wrap);
      rootEl.classList.add('on');
    }
  };

  /* 分类 / 标签 小工具 */
  A.meta = {
    catName: function (id) {
      if (!id) return '';
      var c = Store.settings().categories.filter(function (x) { return x.id === id; })[0];
      return c ? c.name : '';
    },
    tagName: function (id) {
      if (!id) return '';
      var t = Store.settings().tags.filter(function (x) { return x.id === id; })[0];
      return t ? t.name : '';
    },
    tagNames: function (ids) {
      return (ids || []).map(A.meta.tagName).filter(Boolean);
    },
    ensureTag: function (name) {
      name = String(name || '').trim();
      if (!name) return null;
      var s = Store.settings();
      var hit = s.tags.filter(function (t) { return t.name === name; })[0];
      if (hit) return hit.id;
      var t = { id: 't-' + U.uid(), name: name };
      s.tags.push(t); Store.saveSettings(s);
      return t.id;
    },
    ensureCategory: function (name) {
      name = String(name || '').trim();
      if (!name) return null;
      var s = Store.settings();
      var hit = s.categories.filter(function (t) { return t.name === name; })[0];
      if (hit) return hit.id;
      var c = { id: 'c-' + U.uid(), name: name };
      s.categories.push(c); Store.saveSettings(s);
      return c.id;
    },
    subjColor: function (categoryId) {
      var palette = ['#185FA5', '#0F6E56', '#993C1D', '#534AB7', '#854F0B', '#A32D2D'];
      if (!categoryId) return '#185FA5';
      var cats = Store.settings().categories;
      for (var i = 0; i < cats.length; i++) if (cats[i].id === categoryId) return palette[i % palette.length];
      return '#185FA5';
    },
    /* 没设分类时按任务名自动配色 —— 不同任务自然不同色 */
    autoColor: function (key) {
      var palette = ['#185FA5', '#0F6E56', '#993C1D', '#534AB7', '#854F0B', '#A32D2D'];
      var s = String(key == null ? '' : key), h = 0;
      for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000;
      return palette[h % palette.length];
    },
    /* 一条记录（或正在进行的一段）该用什么色：有分类按分类，没分类按任务名 */
    recColor: function (r) {
      if (r && r.categoryId) return A.meta.subjColor(r.categoryId);
      return A.meta.autoColor((r && r.title) || '');
    }
  };
})(window);
