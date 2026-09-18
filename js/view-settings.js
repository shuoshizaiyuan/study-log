/* view-settings.js — 设置：同步 / 分类 / 标签 / 时间块 / 导出 / 数据管理 */
(function (root) {
  'use strict';
  var A = root.App = root.App || {};
  var U = A.util, S = A.store, UI = A.ui;
  A.views = A.views || {};

  function sizeText(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function render() {
    var main = document.getElementById('main');
    var s = S.settings();
    var cfg = S.syncCfg();
    var q = S.queue();
    var recs = S.records().filter(function (r) { return !r.deleted; });
    var draft = A.state.exportRange || { mode: 'today' };

    var html = '<div class="view">';

    /* ---- 同步 ---- */
    html += '<div class="sec-title">数据仓库（同步）</div>';
    html += '<div class="card"><h3>你的记录会存到这里</h3>';
    html += '<label class="label" style="margin-top:0">账号</label>' +
      '<input class="input" id="s-owner" value="' + U.esc(cfg.owner) + '" placeholder="例如 shuoshizaiyuan" autocapitalize="off" autocorrect="off">';
    html += '<label class="label">数据仓库名</label>' +
      '<input class="input" id="s-repo" value="' + U.esc(cfg.repo) + '" placeholder="例如 study-log-data" autocapitalize="off" autocorrect="off">';
    html += '<label class="label">分支</label>' +
      '<input class="input" id="s-branch" value="' + U.esc(cfg.branch || 'main') + '" placeholder="main" autocapitalize="off" autocorrect="off">';
    html += '<label class="label">细粒度密钥（只授权这一个仓库）</label>' +
      '<input class="input" id="s-token" type="password" value="' + U.esc(cfg.token) + '" placeholder="github_pat_..." autocapitalize="off" autocorrect="off">' +
      '<div class="hint">密钥只保存在这台设备本机，不会写进网页代码、也不会同步到别处。每台设备各填一次。</div>';
    html += '<label class="label">开关</label><div class="row wrap">' +
      '<button class="chip' + (cfg.enabled ? ' on' : '') + '" id="s-enable">' + (cfg.enabled ? '已开启同步' : '同步已关闭') + '</button></div>';
    html += '<div class="row" style="margin-top:14px;gap:8px">' +
      '<button class="btn sm" id="s-test">测试连接</button>' +
      '<button class="btn sm" id="s-save">保存设置</button>' +
      '<button class="btn sm primary" id="s-sync">立即同步</button></div>';
    if (q.length) {
      html += '<div class="hint" style="color:#854F0B">有 ' + q.length + ' 张图片还在等待上传，联网后会自动补传。</div>';
    }
    html += '</div>';

    /* ---- 导出 ---- */
    html += '<div class="sec-title">导出（给电脑上的 AI 看）</div>';
    html += '<div class="card"><h3>选范围</h3>';
    html += '<div class="row wrap" id="ex-modes">' +
      [['today', '今日'], ['yesterday', '昨日'], ['day', '指定某天'], ['range', '几号到几号'], ['all', '全部']]
        .map(function (m) {
          return '<button class="chip' + (draft.mode === m[0] ? ' on' : '') + '" data-mode="' + m[0] + '">' + m[1] + '</button>';
        }).join('') + '</div>';
    if (draft.mode === 'day') {
      html += '<label class="label">哪一天</label><input class="input" type="date" id="ex-day" value="' +
        U.esc(draft.day || U.dateStr()) + '">';
    }
    if (draft.mode === 'range') {
      html += '<div class="row" style="margin-top:12px">' +
        '<div style="flex:1"><label class="label" style="margin-top:0">从</label>' +
        '<input class="input" type="date" id="ex-from" value="' + U.esc(draft.from || U.dateStr()) + '"></div>' +
        '<div style="flex:1"><label class="label" style="margin-top:0">到</label>' +
        '<input class="input" type="date" id="ex-to" value="' + U.esc(draft.to || U.dateStr()) + '"></div></div>';
    }
    html += '<div class="hint">共 ' + recs.length + ' 条记录（未删除）。导出只含文字与元数据，不含图片本体。</div>';
    html += '<div class="row wrap" style="margin-top:12px;gap:8px">' +
      '<button class="btn sm primary" data-ex="node">资料一 · 节点视图</button>' +
      '<button class="btn sm primary" data-ex="natural">资料二 · 自然视图</button>' +
      '<button class="btn sm" data-ex="json">JSON（给 AI 批量分析）</button>' +
      '<button class="btn sm ghost" data-ex="both">两份一起</button></div>';
    html += '</div>';

    /* ---- 分类 ---- */
    html += '<div class="sec-title">分类（每条任务选一个）</div>';
    html += '<div class="card tight">';
    html += s.categories.map(function (c) {
      return '<div class="list-row" style="padding:10px 0" data-cat="' + c.id + '">' +
        '<span>' + U.esc(c.name) + '</span>' +
        '<span><button class="chip mini" data-renamecat="' + c.id + '">改名</button> ' +
        '<button class="chip mini" data-delcat="' + c.id + '">删</button></span></div>';
    }).join('');
    html += '<div style="margin-top:10px"><button class="btn sm" id="s-addcat">+ 新建分类</button></div></div>';

    /* ---- 标签 ---- */
    html += '<div class="sec-title">标签（可多选）</div>';
    html += '<div class="card tight">';
    if (!s.tags.length) html += '<div class="hint">还没有标签。标签比分类更细，比如「第2轮」「导图」「卡壳点」。</div>';
    html += '<div class="row wrap">' + s.tags.map(function (t) {
      return '<span class="chip mini on">' + U.esc(t.name) + '<span class="x" data-deltag="' + t.id + '">×</span></span>';
    }).join('') + '</div>';
    html += '<div style="margin-top:12px"><button class="btn sm" id="s-addtag">+ 新建标签</button></div></div>';

    /* ---- 时间块预设 ---- */
    html += '<div class="sec-title">时间块预设</div>';
    html += '<div class="card tight"><div class="hint" style="margin:0 0 10px">只是给你提示用的预设值，实际计时是自由的正计时。</div>';
    html += '<div class="row wrap">' + s.presets.map(function (m, i) {
      return '<span class="chip mini on">' + m + ' 分钟<span class="x" data-delpreset="' + i + '">×</span></span>';
    }).join('') + '</div>';
    html += '<div style="margin-top:12px"><button class="btn sm" id="s-addpreset">+ 加一个</button></div></div>';

    /* ---- 数据管理 ---- */
    html += '<div class="sec-title">数据管理</div>';
    html += '<div class="card tight">';
    html += '<div class="list-row" style="padding:10px 0;cursor:pointer" id="s-backup">' +
      '<div><div class="lr-t">一键全量备份</div><div class="lr-s">导出全部数据为一个文件，可存到网盘</div></div><span style="color:var(--ink3)">›</span></div>';
    html += '<div class="list-row" style="padding:10px 0;cursor:pointer" id="s-restore">' +
      '<div><div class="lr-t">从备份文件恢复</div><div class="lr-s">选择之前导出的备份文件</div></div><span style="color:var(--ink3)">›</span></div>';
    html += '<div class="list-row" style="padding:10px 0;cursor:pointer" id="s-integrity">' +
      '<div><div class="lr-t">数据完整性检查</div><div class="lr-s">检查并修复缺字段的记录</div></div><span style="color:var(--ink3)">›</span></div>';
    html += '<div class="list-row" style="padding:10px 0;cursor:pointer" id="s-wipe">' +
      '<div><div class="lr-t" style="color:var(--red)">清空本机数据</div><div class="lr-s">危险：请先做好备份</div></div><span style="color:var(--ink3)">›</span></div>';
    html += '<div class="hint" id="s-usage">本机占用：计算中…</div>';
    html += '</div>';

    html += '<p class="mini-note" style="padding-bottom:24px">学习记录 · 只做记录、存储、导出。分析在电脑上做。</p>';
    html += '</div>';
    main.innerHTML = html;

    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (est) {
        var el = document.getElementById('s-usage');
        if (el) el.textContent = '本机占用：' + sizeText(est.usage) + '（已用 / 可用 ' + sizeText(est.quota) + '）';
      }).catch(function () { });
    }
  }

  function currentRangeFromUI() {
    var d = A.state.exportRange || { mode: 'today' };
    if (d.mode === 'day') {
      var el = document.getElementById('ex-day');
      if (el) d.day = el.value || U.dateStr();
    }
    if (d.mode === 'range') {
      var f = document.getElementById('ex-from'), t = document.getElementById('ex-to');
      if (f) d.from = f.value || U.dateStr();
      if (t) d.to = t.value || U.dateStr();
    }
    A.state.exportRange = d;
    return d;
  }

  function previewSheet(title, text, filename) {
    UI.sheet({
      title: title,
      bodyHTML: '<pre class="dump" style="margin:8px 0 0">' + U.esc(text.slice(0, 6000)) +
        (text.length > 6000 ? '\n\n……（预览截断，下载后是完整内容）' : '') + '</pre>',
      footHTML: '<button class="btn ghost" data-close2>关闭</button>' +
        '<button class="btn primary" data-dl>下载文件</button>',
      onMount: function (el, close) {
        el.querySelector('[data-close2]').onclick = close;
        el.querySelector('[data-dl]').onclick = function () {
          U.download(filename, text, 'text/plain');
          UI.toast('已导出 ' + filename);
        };
      }
    });
  }

  function doExport(kind) {
    var range = A.exporter.resolveRange(currentRangeFromUI());
    var recs = S.records();
    var base = A.exporter.fileBase(range);
    if (kind === 'node') {
      previewSheet('资料一 · 节点视图', A.exporter.nodeDump(recs, range), '节点视图-' + base + '.md');
    } else if (kind === 'natural') {
      previewSheet('资料二 · 自然视图', A.exporter.naturalDump(recs, range), '自然视图-' + base + '.md');
    } else if (kind === 'json') {
      previewSheet('JSON', A.exporter.jsonDump(recs, range), 'records-' + base + '.json');
    } else if (kind === 'both') {
      var n = A.exporter.nodeDump(recs, range);
      var t = A.exporter.naturalDump(recs, range);
      U.download('资料一_节点视图-' + base + '.md', n, 'text/plain');
      setTimeout(function () { U.download('资料二_自然视图-' + base + '.md', t, 'text/plain'); }, 500);
      UI.toast('两份资料已导出');
    }
  }

  function bind() {
    var main = document.getElementById('main');
    main.addEventListener('click', function (e) {
      var el = e.target;
      var t = el.closest ? el.closest('[data-mode],[data-ex],[data-cat],[data-renamecat],[data-delcat],[data-deltag],[data-delpreset]') : null;

      /* 同步设置 */
      if (el.id === 's-save' || el.id === 's-test' || el.id === 's-sync' || el.id === 's-enable') {
        var cfg = {
          owner: (document.getElementById('s-owner').value || '').trim(),
          repo: (document.getElementById('s-repo').value || '').trim(),
          branch: (document.getElementById('s-branch').value || 'main').trim() || 'main',
          token: (document.getElementById('s-token').value || '').trim(),
          enabled: S.syncCfg().enabled
        };
        if (el.id === 's-enable') {
          cfg.enabled = !cfg.enabled;
          if (cfg.enabled && !(cfg.owner && cfg.repo && cfg.token)) {
            UI.toast('先把账号、仓库和密钥都填上');
            return;
          }
        }
        S.saveSyncCfg(cfg);
        if (el.id === 's-enable') { render(); UI.toast(cfg.enabled ? '同步已开启' : '同步已关闭'); return; }
        if (el.id === 's-save') { UI.toast('已保存'); render(); return; }
        if (el.id === 's-test') {
          S.saveSyncCfg(Object.assign({}, cfg, { enabled: true }));
          UI.toast('正在测试…');
          A.gh.ping().then(function (d) {
            UI.toast('连接成功：' + d.repo + (d.private ? '（私有）' : '（公开，注意隐私）'));
          }).catch(function (err) {
            UI.toast('连接失败：' + err.message);
          });
          return;
        }
        if (el.id === 's-sync') {
          S.saveSyncCfg(Object.assign({}, cfg, { enabled: true }));
          UI.toast('正在同步…');
          A.sync.fullSync().then(function (r) {
            UI.toast('同步完成，本月处理 ' + ((r && r.months) || []).length + ' 个文件');
            render();
          }).catch(function (err) { UI.toast('同步失败：' + err.message); });
          return;
        }
      }

      /* 导出范围 */
      if (t && t.hasAttribute('data-mode')) {
        var d = currentRangeFromUI();
        d.mode = t.getAttribute('data-mode');
        A.state.exportRange = d;
        render();
        return;
      }
      if (t && t.hasAttribute('data-ex')) { doExport(t.getAttribute('data-ex')); return; }

      /* 分类 */
      if (el.id === 's-addcat') {
        var name = prompt('新分类名称'); if (!name) return;
        A.meta.ensureCategory(name);
        A.sync.markDirty('settings', 'settings'); A.sync.scheduleAuto(800);
        render(); return;
      }
      if (t && t.hasAttribute('data-renamecat')) {
        var id = t.getAttribute('data-renamecat');
        var s = S.settings();
        var c = s.categories.filter(function (x) { return x.id === id; })[0];
        var nn = prompt('改成什么名字', c ? c.name : '');
        if (!nn) return;
        s.categories.forEach(function (x) { if (x.id === id) x.name = nn; });
        S.saveSettings(s); A.sync.markDirty('settings', 'settings'); A.sync.scheduleAuto(800);
        render(); return;
      }
      if (t && t.hasAttribute('data-delcat')) {
        var did = t.getAttribute('data-delcat');
        UI.confirm('删除这个分类？已记录的内容不受影响，只是不再显示分类名。', '删除').then(function (ok) {
          if (!ok) return;
          var s2 = S.settings();
          s2.categories = s2.categories.filter(function (x) { return x.id !== did; });
          S.saveSettings(s2); A.sync.markDirty('settings', 'settings'); A.sync.scheduleAuto(800);
          render();
        });
        return;
      }

      /* 标签 */
      if (el.id === 's-addtag') {
        var tn = prompt('新标签名称'); if (!tn) return;
        A.meta.ensureTag(tn);
        A.sync.markDirty('settings', 'settings'); A.sync.scheduleAuto(800);
        render(); return;
      }
      if (t && t.hasAttribute('data-deltag')) {
        var tid = t.getAttribute('data-deltag');
        UI.confirm('删除这个标签？', '删除').then(function (ok) {
          if (!ok) return;
          var s3 = S.settings();
          s3.tags = s3.tags.filter(function (x) { return x.id !== tid; });
          S.saveSettings(s3); A.sync.markDirty('settings', 'settings'); A.sync.scheduleAuto(800);
          render();
        });
        return;
      }

      /* 预设 */
      if (el.id === 's-addpreset') {
        var v = prompt('加多少分钟？', '120');
        var n2 = parseInt(v, 10);
        if (isNaN(n2) || n2 <= 0) return;
        var s4 = S.settings();
        if (s4.presets.indexOf(n2) < 0) s4.presets.push(n2);
        s4.presets.sort(function (a, b) { return a - b; });
        S.saveSettings(s4); A.sync.markDirty('settings', 'settings'); A.sync.scheduleAuto(800);
        render(); return;
      }
      if (t && t.hasAttribute('data-delpreset')) {
        var s5 = S.settings();
        s5.presets.splice(+t.getAttribute('data-delpreset'), 1);
        S.saveSettings(s5); A.sync.markDirty('settings', 'settings'); A.sync.scheduleAuto(800);
        render(); return;
      }

      /* 数据管理 */
      if (el.id === 's-backup') {
        var data = S.exportAll();
        U.download('学习记录备份-' + U.dateStr() + '.json', JSON.stringify(data, null, 1), 'application/json');
        UI.toast('备份已导出，记得存到网盘一份');
        return;
      }
      if (el.id === 's-restore') {
        var inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.json,application/json';
        inp.onchange = function () {
          var f = inp.files && inp.files[0]; if (!f) return;
          var fr = new FileReader();
          fr.onload = function () {
            try {
              S.importAll(JSON.parse(fr.result));
              (S.records() || []).forEach(function (r) { A.sync.markMonthOf(r); });
              A.sync.markDirty('tasks', 'tasks');
              A.sync.markDirty('settings', 'settings');
              A.sync.scheduleAuto(600);
              UI.toast('已恢复'); render();
            } catch (err) { UI.toast('恢复失败：' + err.message); }
          };
          fr.readAsText(f);
        };
        inp.click();
        return;
      }
      if (el.id === 's-integrity') {
        var bad = 0, fixed = 0;
        var out = [];
        (S.records() || []).forEach(function (r) {
          var x = A.model.repairRecord(r);
          if (!x) { bad++; return; }
          if (JSON.stringify(x) !== JSON.stringify(r)) fixed++;
          out.push(x);
        });
        S.saveRecords(out);
        out.forEach(function (r) { A.sync.markMonthOf(r); });
        A.sync.scheduleAuto(800);
        UI.toast('检查完成：修复 ' + fixed + ' 条，丢弃无法识别的 ' + bad + ' 条');
        render(); return;
      }
      if (el.id === 's-wipe') {
        UI.confirm('清空本机所有记录、任务和设置？这个动作不可撤销，请先导出备份。', '我确定清空').then(function (ok) {
          if (!ok) return;
          UI.confirm('再确认一次：真的清空？', '清空').then(function (ok2) {
            if (!ok2) return;
            S.wipe();
            UI.toast('已清空');
            A.go('timeline');
          });
        });
        return;
      }
    });
  }

  A.views.settings = { title: '设置', render: render, bind: bind };
})(window);
