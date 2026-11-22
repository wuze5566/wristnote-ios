/* 数据层：全部状态存 data/db.json，对话按会话分文件存 data/chats/<id>.json */
window.Store = (function () {
  const DB_FILE = 'data/db.json';
  const CHAT_DIR = 'data/chats';

  const TEXT_COLORS = ['', '#E5484D', '#F08C00', '#2FA36B', '#2E7CF6', '#8B5CF6', '#D6336C'];
  const TEXT_COLOR_NAMES = ['默认', '红', '橙', '绿', '蓝', '紫', '玫红'];
  const HIGHLIGHT_COLORS = ['', '#FFF3B0', '#D8F5DC', '#D8E9FF', '#EBDCFF', '#FFE2CC', '#EDEDED'];
  const HIGHLIGHT_NAMES = ['无', '明黄', '薄荷', '天蓝', '淡紫', '蜜橙', '浅灰'];
  const CATEGORY_COLORS = ['#FFD980', '#A9E5C3', '#A8D3FF', '#D6C2FF', '#FFC4CF', '#FFCFA8', '#B9E4DE'];

  let db = null;
  let saveTimer = 0;
  let saving = false;
  let dirty = false;
  const chatCache = new Map();

  function defaults() {
    return {
      version: 3,
      seq: 100,
      settings: {
        sort: 0,
        theme: 0,
        hexColor: false,
        noteBgType: 0,
        noteBgColor: '#F5F5F6',
        noteBgImage: '',
        autoKeyboard: false,
        hideCursor: false,
        saveMode: 0,
        voiceChunk: 5,
        apiKey: '',
        apiBase: 'https://api.deepseek.com',
        apiModel: 'deepseek-flash',
        chatModel: 'deepseek-flash',
        chatEffort: 'high',
        chatMode: 0,
        modelInfo: '',
        lastBalance: '',
        diagnostics: true,
        editorFontPx: 0
      },
      categories: [],
      notes: [],
      voices: [],
      voiceFolders: [],
      chats: [],
      activeChat: ''
    };
  }

  function normalize() {
    const d = defaults();
    if (!db || typeof db !== 'object') db = d;
    ['categories', 'notes', 'voices', 'voiceFolders', 'chats'].forEach(function (k) {
      if (!Array.isArray(db[k])) db[k] = [];
    });
    if (!db.settings) db.settings = d.settings;
    Object.keys(d.settings).forEach(function (k) {
      if (db.settings[k] === undefined) db.settings[k] = d.settings[k];
    });
    if (!db.seq) db.seq = 100 + db.notes.length;
    if (!db.version) db.version = 3;
    db.notes.forEach(function (n) {
      if (!n.tags) n.tags = [];
      if (typeof n.tags === 'string') n.tags = n.tags.split(',').filter(Boolean);
      if (n.deleted === undefined) n.deleted = false;
      if (!n.body) n.body = '';
      if (n.plain === undefined) n.plain = U.htmlToText(n.body);
    });
    if (!db.categories.length) {
      const t = Date.now();
      db.categories = [
        { id: nextId(), name: '生活', color: CATEGORY_COLORS[0], sort: 10, created: t },
        { id: nextId(), name: '工作', color: CATEGORY_COLORS[2], sort: 20, created: t }
      ];
    }
  }

  function nextId() {
    db.seq = (db.seq || 100) + 1;
    return db.seq;
  }

  /* ------------------------------- 持久化 ------------------------------- */

  async function init() {
    try {
      const r = await Native.call('fs', { op: 'read', path: DB_FILE });
      db = JSON.parse(r.text);
    } catch (e) {
      db = defaults();
      if (window.__errs) window.__errs.push('db 读取失败，使用新库');
    }
    normalize();
    if (location.search.indexOf('demo=1') >= 0 && !db.notes.length) seedDemo();
    return db;
  }

  function save() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 350);
  }

  async function flush() {
    if (saving) { save(); return; }
    if (!dirty || !db) return;
    saving = true;
    dirty = false;
    try {
      await Native.call('fs', { op: 'write', path: DB_FILE, text: JSON.stringify(db) });
    } catch (e) {
      dirty = true;
      if (window.__errs) window.__errs.push('db 写入失败 ' + (e.message || e));
      log('db 写入失败：' + (e.message || e));
    }
    saving = false;
  }

  function settings() { return db.settings; }

  function setSetting(key, value) {
    db.settings[key] = value;
    save();
  }

  function log(text) {
    if (!db || !db.settings || db.settings.diagnostics === false) return;
    const d = new Date();
    const ts = U.pad(d.getHours()) + ':' + U.pad(d.getMinutes()) + ':' + U.pad(d.getSeconds());
    Native.log('[' + ts + '] ' + text);
  }

  /* ------------------------------- 分类 ------------------------------- */

  function categories() {
    return db.categories.slice().sort(function (a, b) {
      return (a.sort || 0) - (b.sort || 0) || a.id - b.id;
    });
  }

  function categoryById(id) {
    for (let i = 0; i < db.categories.length; i++) if (db.categories[i].id === id) return db.categories[i];
    return null;
  }

  function categoryNameExists(name, excludeId) {
    const q = String(name || '').trim().toLowerCase();
    return db.categories.some(function (c) {
      return c.id !== excludeId && c.name.trim().toLowerCase() === q;
    });
  }

  function addCategory(name) {
    const c = {
      id: nextId(), name: name, color: CATEGORY_COLORS[db.categories.length % CATEGORY_COLORS.length],
      sort: (db.categories.length + 1) * 10, created: Date.now()
    };
    db.categories.push(c);
    save();
    return c;
  }

  function renameCategory(id, name) {
    const c = categoryById(id);
    if (c) { c.name = name; save(); }
  }

  function removeCategory(id) {
    db.categories = db.categories.filter(function (c) { return c.id !== id; });
    db.notes.forEach(function (n) { if (n.catId === id) n.catId = 0; });
    save();
  }

  /* ------------------------------- 备忘 ------------------------------- */

  function alive() {
    return db.notes.filter(function (n) { return !n.deleted; });
  }

  function trashed() {
    return db.notes.filter(function (n) { return !!n.deleted; }).sort(function (a, b) {
      return (b.deletedAt || 0) - (a.deletedAt || 0);
    });
  }

  function noteTitle(n) {
    const t = (n.title || '').trim();
    if (t) return t;
    const p = (n.plain || '').trim();
    if (p) return U.clampText(p.split('\n')[0], 24);
    if (/<img/i.test(n.body || '')) return '图片备忘';
    return '空白备忘';
  }

  /**
   * @param {{catId?:number, q?:string, tag?:string, starredOnly?:boolean, sort?:number}} opts
   */
  function notes(opts) {
    opts = opts || {};
    let list = alive();
    if (opts.catId) list = list.filter(function (n) { return n.catId === opts.catId; });
    if (opts.starredOnly) list = list.filter(function (n) { return !!n.starred; });
    if (opts.tag) list = list.filter(function (n) { return (n.tags || []).indexOf(opts.tag) >= 0; });
    const q = (opts.q || '').trim().toLowerCase();
    if (q) {
      list = list.filter(function (n) {
        return (n.title || '').toLowerCase().indexOf(q) >= 0 ||
          (n.plain || '').toLowerCase().indexOf(q) >= 0 ||
          (n.tags || []).join(',').toLowerCase().indexOf(q) >= 0;
      });
    }
    const sort = opts.sort === undefined ? (db.settings.sort || 0) : opts.sort;
    list.sort(function (a, b) {
      if (sort === 2) return String(a.title || '').localeCompare(String(b.title || ''), 'zh') || b.id - a.id;
      if (sort === 1) return (b.created || 0) - (a.created || 0) || b.id - a.id;
      return (b.updated || 0) - (a.updated || 0) || b.id - a.id;
    });
    return list;
  }

  function noteById(id) {
    for (let i = 0; i < db.notes.length; i++) if (db.notes[i].id === id) return db.notes[i];
    return null;
  }

  function createNote(catId) {
    const now = Date.now();
    const n = {
      id: nextId(), catId: catId || 0, title: '', body: '', plain: '', tags: [],
      starred: false, created: now, updated: now, deleted: false, deletedAt: 0
    };
    db.notes.unshift(n);
    save();
    return n;
  }

  function updateNote(id, patch) {
    const n = noteById(id);
    if (!n) return null;
    Object.keys(patch).forEach(function (k) { n[k] = patch[k]; });
    if (patch.body !== undefined) n.plain = U.htmlToText(patch.body);
    n.updated = Date.now();
    save();
    return n;
  }

  function toggleStar(id) {
    const n = noteById(id);
    if (!n) return false;
    n.starred = !n.starred;
    n.updated = Date.now();
    save();
    return n.starred;
  }

  function setTags(id, tags) {
    const n = noteById(id);
    if (!n) return;
    n.tags = tags;
    save();
  }

  function setCategory(id, catId) {
    const n = noteById(id);
    if (!n) return;
    n.catId = catId;
    save();
  }

  function trashNote(id) {
    const n = noteById(id);
    if (!n) return;
    n.deleted = true;
    n.deletedAt = Date.now();
    save();
  }

  function restoreNote(id) {
    const n = noteById(id);
    if (!n) return;
    n.deleted = false;
    n.deletedAt = 0;
    n.updated = Date.now();
    save();
  }

  function purgeNote(id) {
    db.notes = db.notes.filter(function (n) { return n.id !== id; });
    save();
  }

  function emptyTrash() {
    db.notes = db.notes.filter(function (n) { return !n.deleted; });
    save();
  }

  function trashCount() { return trashed().length; }

  function allTags() {
    const map = new Map();
    alive().forEach(function (n) {
      (n.tags || []).forEach(function (t) {
        if (!t) return;
        map.set(t, (map.get(t) || 0) + 1);
      });
    });
    return Array.from(map.entries()).map(function (e) { return { tag: e[0], count: e[1] }; })
      .sort(function (a, b) { return b.count - a.count || a.tag.localeCompare(b.tag, 'zh'); });
  }

  function allTagNames() {
    const set = new Set();
    db.notes.forEach(function (n) { (n.tags || []).forEach(function (t) { if (t) set.add(t); }); });
    return Array.from(set).sort(function (a, b) { return a.localeCompare(b, 'zh'); });
  }

  function exportText() {
    return notes({}).map(function (n) {
      return '【' + noteTitle(n) + '】\n' + (n.plain || '') + '\n';
    }).join('\n');
  }

  /* ------------------------------- 语音 ------------------------------- */

  function voiceFolders() {
    return db.voiceFolders.slice().sort(function (a, b) {
      return (a.sort || 0) - (b.sort || 0) || a.id - b.id;
    });
  }

  function voiceFolderName(id) {
    for (let i = 0; i < db.voiceFolders.length; i++) {
      if (db.voiceFolders[i].id === id) return db.voiceFolders[i].name;
    }
    return '未分类';
  }

  function folderNameExists(name, excludeId) {
    const q = String(name || '').trim().toLowerCase();
    return db.voiceFolders.some(function (f) {
      return f.id !== excludeId && f.name.trim().toLowerCase() === q;
    });
  }

  function addVoiceFolder(name) {
    const f = { id: nextId(), name: name, sort: (db.voiceFolders.length + 1) * 10, created: Date.now() };
    db.voiceFolders.push(f);
    save();
    return f;
  }

  function renameVoiceFolder(id, name) {
    db.voiceFolders.forEach(function (f) { if (f.id === id) f.name = name; });
    save();
  }

  function removeVoiceFolder(id) {
    db.voiceFolders = db.voiceFolders.filter(function (f) { return f.id !== id; });
    db.voices.forEach(function (v) { if (v.folderId === id) v.folderId = 0; });
    save();
  }

  function voices(folderId) {
    let list = db.voices.slice();
    if (folderId) list = list.filter(function (v) { return v.folderId === folderId; });
    list.sort(function (a, b) { return (b.created || 0) - (a.created || 0); });
    return list;
  }

  function voiceById(id) {
    for (let i = 0; i < db.voices.length; i++) if (db.voices[i].id === id) return db.voices[i];
    return null;
  }

  function addVoice(v) {
    const item = {
      id: nextId(), name: v.name || ('语音 ' + new Date().toLocaleString('zh-CN', { hour12: false })),
      path: v.path, dur: v.dur || 0, folderId: v.folderId || 0, created: Date.now(),
      speed: v.speed || 1
    };
    db.voices.unshift(item);
    save();
    return item;
  }

  function updateVoice(id, patch) {
    const v = voiceById(id);
    if (!v) return;
    Object.keys(patch).forEach(function (k) { v[k] = patch[k]; });
    save();
  }

  function removeVoice(id) {
    const v = voiceById(id);
    if (!v) return;
    db.voices = db.voices.filter(function (x) { return x.id !== id; });
    save();
    return v;
  }

  function voiceFiles(path) {
    return String(path || '').split('|').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /* ------------------------------- 对话 ------------------------------- */

  function chatMetas() {
    return db.chats.slice().sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return (b.updated || 0) - (a.updated || 0);
    });
  }

  function chatMeta(id) {
    for (let i = 0; i < db.chats.length; i++) if (db.chats[i].id === id) return db.chats[i];
    return null;
  }

  async function loadChat(id) {
    if (!id) return null;
    if (chatCache.has(id)) return chatCache.get(id);
    let chat = null;
    try {
      const r = await Native.call('fs', { op: 'read', path: CHAT_DIR + '/' + id + '.json' });
      chat = JSON.parse(r.text);
    } catch (e) {
      const meta = chatMeta(id);
      chat = { id: id, title: meta ? meta.title : '新对话', created: meta ? meta.created : Date.now(), messages: [] };
    }
    if (!Array.isArray(chat.messages)) chat.messages = [];
    chatCache.set(id, chat);
    return chat;
  }

  async function saveChat(chat) {
    if (!chat || !chat.id) return;
    chat.updated = Date.now();
    chatCache.set(chat.id, chat);
    let meta = chatMeta(chat.id);
    const firstUser = chat.messages.filter(function (m) { return m.role === 'user'; })[0];
    const autoTitle = firstUser ? U.clampText(firstUser.text || '语音消息', 18) : '新对话';
    if (!meta) {
      meta = {
        id: chat.id, title: chat.title || autoTitle, created: chat.created || Date.now(),
        updated: chat.updated, pinned: false, archived: false, count: chat.messages.length
      };
      db.chats.push(meta);
    } else {
      if (!chat.title && !meta.customTitle) meta.title = autoTitle;
      meta.updated = chat.updated;
      meta.count = chat.messages.length;
    }
    if (chat.title) meta.title = chat.title;
    save();
    try {
      await Native.call('fs', { op: 'write', path: CHAT_DIR + '/' + chat.id + '.json', text: JSON.stringify(chat) });
    } catch (e) {
      log('对话保存失败：' + (e.message || e));
    }
  }

  function newChat() {
    const id = 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
    const chat = { id: id, title: '', created: Date.now(), updated: Date.now(), messages: [] };
    chatCache.set(id, chat);
    db.chats.push({
      id: id, title: '新对话', created: chat.created, updated: chat.updated,
      pinned: false, archived: false, count: 0
    });
    db.activeChat = id;
    save();
    return chat;
  }

  async function deleteChat(id) {
    chatCache.delete(id);
    db.chats = db.chats.filter(function (c) { return c.id !== id; });
    if (db.activeChat === id) db.activeChat = '';
    save();
    try { await Native.call('fs', { op: 'delete', path: CHAT_DIR + '/' + id + '.json' }); } catch (e) { /* ignore */ }
    try { await Native.call('fs', { op: 'delete', path: 'chat_att/' + id }); } catch (e) { /* ignore */ }
  }

  function updateChatMeta(id, patch) {
    const m = chatMeta(id);
    if (!m) return;
    Object.keys(patch).forEach(function (k) { m[k] = patch[k]; });
    if (patch.title) {
      const c = chatCache.get(id);
      if (c) c.title = patch.title;
    }
    save();
  }

  function setActiveChat(id) {
    db.activeChat = id || '';
    save();
  }

  /* ------------------------------- 示例数据 ------------------------------- */

  function seedDemo() {
    const now = Date.now();
    const h = 3600000;
    const cat1 = db.categories[0] ? db.categories[0].id : 0;
    const cat2 = db.categories[1] ? db.categories[1].id : 0;
    const a = createNote(cat1);
    updateNote(a.id, {
      title: '买牛奶和鸡蛋',
      body: '<div>□ 牛奶 2 盒</div><div>□ 鸡蛋 10 个</div><div>■ 面包（已买）</div>',
      starred: true, created: now - 2 * h, updated: now - 2 * h
    });
    const b = createNote(cat2);
    updateNote(b.id, {
      title: '周会要点',
      body: '<div>下周把 <b>缓存</b> 那一块补完</div><div><span style="color:#E5484D">风险：</span>接口还没对齐</div>',
      tags: ['工作'], created: now - 26 * h, updated: now - 26 * h
    });
    const c = createNote(cat1);
    updateNote(c.id, {
      title: '想法',
      body: '<div>备忘可以按<span style="background-color:#FFF3B0">颜色</span>分类，找起来快。</div>',
      created: now - 50 * h, updated: now - 50 * h
    });
    const d = createNote(0);
    updateNote(d.id, {
      title: '已删掉的旧条目',
      body: '<div>这条在回收站里</div>',
      created: now - 90 * h, updated: now - 90 * h
    });
    d.deleted = true;
    d.deletedAt = now - 20 * h;
    save();
  }

  /* ------------------------------- 媒体路径 ------------------------------- */

  function mediaURL(path) {
    if (!path) return '';
    if (/^(data:|wnmedia:|stickers\/|https?:)/.test(path)) return path;
    if (Native.hasNative) {
      return 'wnmedia://' + String(path).split('/').map(encodeURIComponent).join('/');
    }
    return Native.dataUrl(path) || '';
  }

  function stickerURL(name) {
    return 'stickers/' + name;
  }

  /* ------------------------------- 富文本清洗 ------------------------------- */

  const ALLOW = {
    B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, STRIKE: 1, SPAN: 1, DIV: 1, P: 1, BR: 1,
    IMG: 1, FONT: 1, H1: 1, H2: 1, H3: 1, UL: 1, OL: 1, LI: 1
  };

  function sanitize(html) {
    if (!html) return '';
    const tpl = document.createElement('div');
    tpl.innerHTML = String(html);
    (function walk(root) {
      Array.prototype.slice.call(root.childNodes).forEach(function (node) {
        if (node.nodeType === 3) return;
        if (node.nodeType !== 1) { root.removeChild(node); return; }
        const tag = node.tagName;
        if (!ALLOW[tag]) {
          const frag = document.createDocumentFragment();
          while (node.firstChild) frag.appendChild(node.firstChild);
          root.replaceChild(frag, node);
          walk(root);
          return;
        }
        const isAudio = tag === 'SPAN' && node.classList.contains('vn-audio');
        Array.prototype.slice.call(node.attributes).forEach(function (at) {
          const n = at.name.toLowerCase();
          if (n === 'style') {
            const v = at.value || '';
            const keep = v.split(';').map(function (s) { return s.trim(); }).filter(function (s) {
              return /^(color|background-color|font-weight|font-style|text-decoration)\s*:/i.test(s) &&
                !/expression|url\s*\(/i.test(s);
            }).join('; ');
            if (keep) node.setAttribute('style', keep);
            else node.removeAttribute('style');
            return;
          }
          if (tag === 'IMG' && (n === 'src' || n === 'data-path' || n === 'data-asset')) return;
          if (tag === 'FONT' && n === 'color') return;
          if (isAudio && (n === 'data-path' || n === 'data-dur' || n === 'class' || n === 'contenteditable')) return;
          node.removeAttribute(at.name);
        });
        if (isAudio) {
          node.setAttribute('class', 'vn-audio');
          node.setAttribute('contenteditable', 'false');
        }
        if (tag === 'IMG') {
          const src = node.getAttribute('src') || '';
          if (!/^(wnmedia:|data:|stickers\/)/.test(src)) node.removeAttribute('src');
          if (!node.getAttribute('data-path') && !node.getAttribute('data-asset') && !/^(data:|stickers\/)/.test(src)) {
            const parent = node.parentNode;
            if (parent) parent.removeChild(node);
            return;
          }
        }
        walk(node);
      });
    })(tpl);
    let out = tpl.innerHTML;
    if (out === '<br>') out = '';
    return out;
  }

  return {
    init: init, flush: flush, save: save,
    db: function () { return db; },
    settings: settings, setSetting: setSetting, log: log,
    nextId: nextId,
    categories: categories, categoryById: categoryById, categoryNameExists: categoryNameExists,
    addCategory: addCategory, renameCategory: renameCategory, removeCategory: removeCategory,
    notes: notes, noteById: noteById, noteTitle: noteTitle, createNote: createNote,
    updateNote: updateNote, toggleStar: toggleStar, setTags: setTags, setCategory: setCategory,
    trashNote: trashNote, restoreNote: restoreNote, purgeNote: purgeNote, emptyTrash: emptyTrash,
    trashed: trashed, trashCount: trashCount,
    allTags: allTags, allTagNames: allTagNames, exportText: exportText,
    voiceFolders: voiceFolders, voiceFolderName: voiceFolderName, folderNameExists: folderNameExists,
    addVoiceFolder: addVoiceFolder, renameVoiceFolder: renameVoiceFolder, removeVoiceFolder: removeVoiceFolder,
    voices: voices, voiceById: voiceById, addVoice: addVoice, updateVoice: updateVoice,
    removeVoice: removeVoice, voiceFiles: voiceFiles,
    chatMetas: chatMetas, chatMeta: chatMeta, loadChat: loadChat, saveChat: saveChat,
    newChat: newChat, deleteChat: deleteChat, updateChatMeta: updateChatMeta, setActiveChat: setActiveChat,
    mediaURL: mediaURL, stickerURL: stickerURL, sanitize: sanitize,
    TEXT_COLORS: TEXT_COLORS, TEXT_COLOR_NAMES: TEXT_COLOR_NAMES,
    HIGHLIGHT_COLORS: HIGHLIGHT_COLORS, HIGHLIGHT_NAMES: HIGHLIGHT_NAMES,
    CATEGORY_COLORS: CATEGORY_COLORS,
    activeChat: function () { return db.activeChat; }
  };
})();
