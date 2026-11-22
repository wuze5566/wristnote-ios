/* 数据层：全部数据存成一个 JSON 文件，异步落盘（消抖 400ms） */
window.Store = (function () {
  const FILE = 'data/db.json';
  let db = null;
  let saveTimer = 0;
  let saving = false;
  let dirty = false;

  function defaults() {
    const now = Date.now();
    return {
      version: 1,
      seq: 100,
      categories: [
        { id: 1, name: '生活', color: '#2E7CF6' },
        { id: 2, name: '工作', color: '#12A150' }
      ],
      notes: [],
      voices: [],
      settings: {
        apiKey: '',
        apiBase: 'https://api.deepseek.com',
        model: 'deepseek-flash',
        effort: 'off',
        theme: 'light',
        noteFontPx: 16,
        paper: '',
        chatModel: 'deepseek-flash',
        chatMode: 'assistant',
        asrEnabled: true
      },
      _t: now
    };
  }

  function normalize() {
    if (!db || typeof db !== 'object') db = defaults();
    if (!Array.isArray(db.notes)) db.notes = [];
    if (!Array.isArray(db.categories)) db.categories = defaults().categories;
    if (!Array.isArray(db.voices)) db.voices = [];
    if (!db.settings) db.settings = defaults().settings;
    const d = defaults().settings;
    for (const k in d) if (db.settings[k] === undefined) db.settings[k] = d[k];
    if (!db.seq) db.seq = 100 + db.notes.length;
  }

  function nextId() {
    db.seq = (db.seq || 100) + 1;
    return db.seq;
  }

  async function load() {
    try {
      const r = await Native.call('fs', { op: 'read', path: FILE });
      db = JSON.parse(r.text);
    } catch (e) {
      db = defaults();
    }
    normalize();
    seedDemo();
    return db;
  }

  /* 本地预览用：地址栏带 ?demo=1 且库为空时塞几条示例 */
  function seedDemo() {
    if (location.search.indexOf('demo=1') < 0) return;
    if (db.notes.length) return;
    const now = Date.now();
    const h = 3600 * 1000;
    db.notes = [
      {
        id: nextId(), catId: 1, title: '买牛奶和鸡蛋',
        body: '<div>□ 牛奶 2 盒</div><div>□ 鸡蛋 10 个</div><div>■ 面包（已买）</div>',
        created: now - 2 * h, updated: now - 2 * h, starred: true, deleted: false
      },
      {
        id: nextId(), catId: 2, title: '周会要点',
        body: '<div>下周把 <b>缓存</b> 那一块补完</div><div><span style="color:#E5484D">风险：</span>接口还没对齐</div>',
        created: now - 26 * h, updated: now - 26 * h, starred: false, deleted: false
      },
      {
        id: nextId(), catId: 1, title: '想法',
        body: '<div>备忘可以按<span style="background-color:#FFF3C4">颜色</span>分类，找起来快。</div>',
        created: now - 50 * h, updated: now - 50 * h, starred: false, deleted: false
      },
      {
        id: nextId(), catId: 2, title: '已删掉的旧条目',
        body: '<div>这条在回收站里</div>',
        created: now - 90 * h, updated: now - 90 * h, starred: false, deleted: true, deletedAt: now - 20 * h
      }
    ];
    scheduleSave();
  }

  function scheduleSave() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
  }

  async function flush() {
    if (saving) { scheduleSave(); return; }
    if (!dirty) return;
    saving = true;
    dirty = false;
    try {
      await Native.call('fs', { op: 'write', path: FILE, text: JSON.stringify(db) });
    } catch (e) {
      console.error(e);
    }
    saving = false;
  }

  function data() { return db; }
  function settings() { return db.settings; }
  function setSetting(k, v) { db.settings[k] = v; scheduleSave(); }

  function categories() { return db.categories.slice(); }

  function categoryById(id) {
    return db.categories.filter(function (c) { return c.id === id; })[0] || null;
  }

  function addCategory(name) {
    const c = { id: nextId(), name: name, color: '#2E7CF6' };
    db.categories.push(c);
    scheduleSave();
    return c;
  }

  function renameCategory(id, name) {
    const c = categoryById(id);
    if (c) { c.name = name; scheduleSave(); }
  }

  function removeCategory(id) {
    db.categories = db.categories.filter(function (c) { return c.id !== id; });
    db.notes.forEach(function (n) { if (n.catId === id) n.catId = 0; });
    scheduleSave();
  }

  function alive() { return db.notes.filter(function (n) { return !n.deleted; }); }
  function trashed() { return db.notes.filter(function (n) { return !!n.deleted; }); }

  function notes(catId, query) {
    let list = alive();
    if (catId) list = list.filter(function (n) { return n.catId === catId; });
    if (query) {
      const q = query.trim().toLowerCase();
      if (q) {
        list = list.filter(function (n) {
          return (n.title || '').toLowerCase().indexOf(q) >= 0 ||
            plain(n.body || '').toLowerCase().indexOf(q) >= 0;
        });
      }
    }
    list.sort(function (a, b) {
      if (!!b.starred !== !!a.starred) return b.starred ? 1 : -1;
      return (b.updated || 0) - (a.updated || 0);
    });
    return list;
  }

  function noteById(id) {
    return db.notes.filter(function (n) { return n.id === id; })[0] || null;
  }

  function createNote(catId) {
    const now = Date.now();
    const n = {
      id: nextId(), catId: catId || 0, title: '', body: '',
      created: now, updated: now, starred: false, deleted: false
    };
    db.notes.unshift(n);
    scheduleSave();
    return n;
  }

  function updateNote(id, patch) {
    const n = noteById(id);
    if (!n) return null;
    for (const k in patch) n[k] = patch[k];
    n.updated = Date.now();
    scheduleSave();
    return n;
  }

  function trashNote(id) {
    const n = noteById(id);
    if (!n) return;
    n.deleted = true;
    n.deletedAt = Date.now();
    scheduleSave();
  }

  function restoreNote(id) {
    const n = noteById(id);
    if (!n) return;
    n.deleted = false;
    n.deletedAt = 0;
    scheduleSave();
  }

  function purgeNote(id) {
    db.notes = db.notes.filter(function (n) { return n.id !== id; });
    scheduleSave();
  }

  function emptyTrash() {
    db.notes = db.notes.filter(function (n) { return !n.deleted; });
    scheduleSave();
  }

  /* 富文本 -> 纯文本（预览/搜索用） */
  function plain(html) {
    const d = document.createElement('div');
    d.innerHTML = sanitize(html).replace(/<\/(div|p|h\d|li)>/gi, ' ').replace(/<br\s*\/?>/gi, ' ');
    d.querySelectorAll('img').forEach(function (im) { im.replaceWith(document.createTextNode(' [图片] ')); });
    d.querySelectorAll('audio').forEach(function (a) {
      a.replaceWith(document.createTextNode(' [语音 ' + Math.round((parseInt(a.getAttribute('data-dur') || '0', 10)) / 1000) + 's] '));
    });
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /* 只允许我们自己的标签，挡掉脚本 */
  const ALLOW = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, SPAN: 1, DIV: 1, P: 1, BR: 1, IMG: 1, AUDIO: 1, FONT: 1 };
  function sanitize(html) {
    if (!html) return '';
    const tpl = document.createElement('div');
    tpl.innerHTML = html;
    (function walk(node) {
      const kids = Array.prototype.slice.call(node.childNodes);
      kids.forEach(function (el) {
        if (el.nodeType === 3) return;
        if (el.nodeType !== 1) { el.remove(); return; }
        if (!ALLOW[el.tagName]) {
          const frag = document.createDocumentFragment();
          while (el.firstChild) frag.appendChild(el.firstChild);
          el.replaceWith(frag);
          walk(node);
          return;
        }
        Array.prototype.slice.call(el.attributes).forEach(function (at) {
          const n = at.name.toLowerCase();
          const ok = (el.tagName === 'IMG' && (n === 'src' || n === 'data-path'))
            || (el.tagName === 'AUDIO' && (n === 'src' || n === 'data-path' || n === 'data-dur'))
            || (n === 'style' && /^(color|background-color)\s*:/i.test(at.value.trim()))
            || (n === 'color' && el.tagName === 'FONT');
          if (!ok) el.removeAttribute(at.name);
        });
        if (el.tagName === 'IMG' && el.getAttribute('src') && /^https?:/i.test(el.getAttribute('src'))) {
          el.setAttribute('data-path', el.getAttribute('src'));
          el.removeAttribute('src');
        }
        if (el.tagName === 'AUDIO') { el.removeAttribute('controls'); el.setAttribute('controls', ''); }
        walk(el);
      });
    })(tpl);
    return tpl.innerHTML;
  }

  function exportText() {
    return alive().map(function (n) {
      return '【' + (n.title || '无标题') + '】\n' + plain(n.body || '') + '\n';
    }).join('\n');
  }

  return {
    load: load, data: data, save: scheduleSave, flush: flush,
    settings: settings, setSetting: setSetting,
    categories: categories, categoryById: categoryById, addCategory: addCategory,
    renameCategory: renameCategory, removeCategory: removeCategory,
    notes: notes, noteById: noteById, createNote: createNote, updateNote: updateNote,
    trashNote: trashNote, restoreNote: restoreNote, purgeNote: purgeNote, emptyTrash: emptyTrash,
    trashed: trashed, plain: plain, sanitize: sanitize, exportText: exportText, nextId: nextId
  };
})();
