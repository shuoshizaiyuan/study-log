/* github.js — GitHub 仓库当数据层：读写 / 目录列举 / 记录级合并 */
(function (root) {
  'use strict';
  var A = root.App = root.App || {};
  var U = A.util;

  var API = 'https://api.github.com';

  /* ---------------- base64（UTF-8 安全，分块防爆栈） ---------------- */
  function utf8ToB64(str) {
    var bytes = new TextEncoder().encode(str);
    var chunk = 0x8000, out = '';
    for (var i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(out);
  }
  function b64ToUtf8(b64) {
    var bin = atob(String(b64 || '').replace(/\s+/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function cfg() {
    var c = A.store.syncCfg();
    return {
      owner: c.owner, repo: c.repo, token: c.token, branch: c.branch || 'main',
      ready: !!(c.owner && c.repo && c.token && c.enabled)
    };
  }

  function req(path, opt) {
    opt = opt || {};
    var c = cfg();
    if (!c.token) return Promise.reject(new Error('未填写密钥'));
    var url = /^https?:/.test(path) ? path : (API + path);
    var headers = {
      'Authorization': 'Bearer ' + c.token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (opt.body) headers['Content-Type'] = 'application/json';
    return fetch(url, {
      method: opt.method || 'GET',
      headers: headers,
      body: opt.body ? JSON.stringify(opt.body) : undefined,
      cache: 'no-store'
    }).then(function (res) {
      return res.text().then(function (t) {
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var err = new Error((data && (data.message || data.error)) || ('HTTP ' + res.status));
          err.status = res.status; err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function filePath(name) { return '/repos/' + cfg().owner + '/' + cfg().repo + '/contents/' + name; }

  /* 读文件 → {text, sha} 或 null（不存在） */
  function readFile(name) {
    var c = cfg();
    return req(filePath(name) + '?ref=' + encodeURIComponent(c.branch)).then(function (d) {
      if (!d) return null;
      if (Array.isArray(d)) return null;
      return { text: b64ToUtf8(d.content || ''), sha: d.sha };
    }).catch(function (e) {
      if (e.status === 404) return null;
      throw e;
    });
  }

  /* 写文件（新文件不带 sha；已有文件必须带 sha） */
  function writeFile(name, text, sha, message) {
    var c = cfg();
    var body = {
      message: message || ('update ' + name),
      content: utf8ToB64(text),
      branch: c.branch
    };
    if (sha) body.sha = sha;
    return req(filePath(name), { method: 'PUT', body: body });
  }

  /* 列目录 → [{name, path, sha, type, size}] */
  function listDir(name) {
    var c = cfg();
    return req('/repos/' + c.owner + '/' + c.repo + '/contents/' + name + '?ref=' + encodeURIComponent(c.branch))
      .then(function (d) { return Array.isArray(d) ? d : []; })
      .catch(function (e) { if (e.status === 404) return []; throw e; });
  }

  /* ---------------- 记录级合并 ---------------- */
  function mergeList(localArr, remoteArr) {
    var byId = {}, order = [], conflicts = [];
    function put(r, src) {
      if (!byId[r.id]) { byId[r.id] = { rec: r, src: src }; order.push(r.id); return; }
      var cur = byId[r.id];
      var a = cur.rec.updatedAt || '', b = r.updatedAt || '';
      if (b > a) {
        if (a) conflicts.push({ id: r.id, title: r.title, keptFrom: src, discarded: cur.rec });
        cur.rec = r; cur.src = src;
      } else if (a > b) {
        conflicts.push({ id: r.id, title: cur.rec.title, keptFrom: cur.src, discarded: r });
      }
    }
    (remoteArr || []).forEach(function (r) { var x = A.model.repairRecord(r); if (x) put(x, 'remote'); });
    (localArr || []).forEach(function (r) { var x = A.model.repairRecord(r); if (x) put(x, 'local'); });
    var merged = order.map(function (id) { return byId[id].rec; });
    merged.sort(function (a, b) { return (a.startTs || 0) - (b.startTs || 0); });
    return { records: merged, conflicts: conflicts };
  }

  function mergeTasks(localArr, remoteArr) {
    var byId = {};
    (remoteArr || []).forEach(function (t) { if (t && t.id) byId[t.id] = t; });
    (localArr || []).forEach(function (t) {
      if (!t || !t.id) return;
      var cur = byId[t.id];
      if (!cur || String(t.updatedAt || '') > String(cur.updatedAt || '')) byId[t.id] = t;
    });
    return Object.keys(byId).map(function (k) { return byId[k]; });
  }

  function mergeSettings(local, remote) {
    if (!remote) return local;
    if (!local) return remote;
    function union(a, b) {
      var seen = {}, out = [];
      [].concat(b || [], a || []).forEach(function (x) {
        if (!x || !x.id || seen[x.id]) return;
        seen[x.id] = 1; out.push(x);
      });
      return out;
    }
    /* 合并「删除墓碑」：分类/标签的新增是并集，但删除必须能表达出来，
       否则一台设备删掉的分类会被另一台的旧数据合并回来（删了过会儿又冒出来）。 */
    var removed = { categories: {}, tags: {} };
    [local.removed, remote.removed].forEach(function (m) {
      if (!m) return;
      ['categories', 'tags'].forEach(function (k) {
        var o = m[k] || {};
        Object.keys(o).forEach(function (id) {
          var t = String(o[id] || '');
          if (!removed[k][id] || t > removed[k][id]) removed[k][id] = t;
        });
      });
    });
    function keep(x) {
      return !!x && !!x.id && !removed.categories[x.id] && !removed.tags[x.id];
    }
    var newer = String(local.updatedAt || '') > String(remote.updatedAt || '') ? local : remote;
    return {
      categories: union(local.categories, remote.categories).filter(keep),
      tags: union(local.tags, remote.tags).filter(keep),
      presets: (newer.presets && newer.presets.length) ? newer.presets : [45, 60, 90],
      /* 打卡显示哪些分类是「显示偏好」，不做并集（否则取消勾选会被另一台复活），取较新的那份。
         null 是合法值（= 显示全部），所以只能判 undefined，不能用 truthy */
      cardCats: (newer.cardCats === undefined) ? null : newer.cardCats,
      removed: removed,
      updatedAt: newer.updatedAt || ''
    };
  }

  A.gh = {
    cfg: cfg,
    readFile: readFile,
    writeFile: writeFile,
    listDir: listDir,
    mergeList: mergeList,
    mergeTasks: mergeTasks,
    mergeSettings: mergeSettings,
    utf8ToB64: utf8ToB64,
    b64ToUtf8: b64ToUtf8,
    /* 连通性自检 */
    ping: function () {
      var c = cfg();
      if (!c.ready) return Promise.reject(new Error('同步未配置完整'));
      return req('/repos/' + c.owner + '/' + c.repo).then(function (d) {
        return { repo: d.full_name, private: !!d.private, default_branch: d.default_branch };
      });
    }
  };
})(window);
