/* 数据层：设置 + 对话（每段对话一个 JSON 文件，索引在 data/db.json） */
window.Store = (function () {
  const DB_FILE = 'data/db.json';
  const CHAT_DIR = 'data/chats';

  let db = null;
  let saveTimer = 0;
  let saving = false;
  let dirty = false;
  const chatCache = new Map();

  function defaults() {
    return {
      version: 4,
      seq: 100,
      settings: {
        theme: 0,
        apiKey: '',
        apiBase: 'https://api.deepseek.com',
        apiModel: 'deepseek-flash',
        chatModel: 'deepseek-flash',
        chatEffort: 'high',
        chatMode: 0,
        modelInfo: '',
        lastBalance: '',
        diagnostics: true
      },
      chats: [],
      activeChat: ''
    };
  }

  function normalize() {
    const d = defaults();
    if (!db || typeof db !== 'object') db = d;
    if (!Array.isArray(db.chats)) db.chats = [];
    if (!db.settings) db.settings = d.settings;
    Object.keys(d.settings).forEach(function (k) {
      if (db.settings[k] === undefined) db.settings[k] = d.settings[k];
    });
    if (!db.seq) db.seq = 100;
    db.version = 4;
  }

  function nextId() {
    db.seq = (db.seq || 100) + 1;
    return db.seq;
  }

  async function init() {
    try {
      const r = await Native.call('fs', { op: 'read', path: DB_FILE });
      db = JSON.parse(r.text);
    } catch (e) {
      db = defaults();
    }
    normalize();
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
      chat = { id: id, title: meta ? meta.title : '', created: meta ? meta.created : Date.now(), messages: [] };
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
    const autoTitle = firstUser ? U.clampText(firstUser.text || '语音消息', 18) : '';
    if (!meta) {
      meta = {
        id: chat.id, title: chat.title || autoTitle || '新对话', created: chat.created || Date.now(),
        updated: chat.updated, pinned: false, archived: false, count: chat.messages.length
      };
      db.chats.push(meta);
    } else {
      if (!chat.title && !meta.customTitle) meta.title = autoTitle || meta.title || '新对话';
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

  function mediaURL(path) {
    if (!path) return '';
    if (/^(data:|wnmedia:|https?:)/.test(path)) return path;
    if (Native.hasNative) {
      return 'wnmedia://' + String(path).split('/').map(encodeURIComponent).join('/');
    }
    return Native.dataUrl(path) || '';
  }

  return {
    init: init, flush: flush, save: save,
    settings: settings, setSetting: setSetting, log: log,
    chatMetas: chatMetas, chatMeta: chatMeta, loadChat: loadChat, saveChat: saveChat,
    newChat: newChat, deleteChat: deleteChat, updateChatMeta: updateChatMeta,
    setActiveChat: setActiveChat,
    activeChat: function () { return db.activeChat; },
    mediaURL: mediaURL,
    nextId: nextId
  };
})();
