/* 界面与交互 */
(function () {
  const $ = function (s) { return document.querySelector(s); };
  const $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  const state = { catId: 0, query: '', editId: null, imgCache: {}, recording: false };

  /* ---------- 小工具 ---------- */
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('on'); }, 1600);
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtTime(ts) {
    const d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function dayLabel(ts) {
    const d = new Date(ts);
    const now = new Date();
    const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = Math.round((d0 - t) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function highlight(text, q) {
    if (!q) return esc(text);
    const t = String(text || '');
    const i = t.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(t);
    return esc(t.slice(0, i)) + '<span class="hit">' + esc(t.slice(i, i + q.length)) + '</span>' + esc(t.slice(i + q.length));
  }

  /* 面板 */
  function sheet(title, items) {
    const mask = $('#mask');
    const sh = $('#sheet');
    sh.innerHTML = '<h3>' + esc(title) + '</h3>' +
      items.map(function (it, i) {
        return '<div class="opt' + (it.danger ? ' danger' : '') + '" data-i="' + i + '">' + esc(it.label) + '</div>';
      }).join('');
    sh.querySelectorAll('.opt').forEach(function (el) {
      el.onclick = function () {
        closeSheet();
        const it = items[parseInt(el.getAttribute('data-i'), 10)];
        if (it && it.onTap) setTimeout(it.onTap, 10);
      };
    });
    mask.classList.add('on');
    sh.classList.add('on');
  }

  function closeSheet() {
    $('#mask').classList.remove('on');
    $('#sheet').classList.remove('on');
  }

  /* ---------- 视图切换 ---------- */
  function show(name) {
    $$('.view').forEach(function (v) { v.classList.remove('on'); });
    $('#view-' + name).classList.add('on');
    if (name === 'home') renderList();
    if (name === 'trash') renderTrash();
    if (name === 'settings') renderSettings();
  }

  /* ---------- 首页 ---------- */
  function renderChips() {
    const cats = Store.categories();
    const el = $('#chips');
    let html = '<div class="chip' + (state.catId === 0 ? ' on' : '') + '" data-id="0">全部</div>';
    cats.forEach(function (c) {
      html += '<div class="chip' + (state.catId === c.id ? ' on' : '') + '" data-id="' + c.id + '">' + esc(c.name) + '</div>';
    });
    html += '<div class="chip" data-id="add">＋</div>';
    el.innerHTML = html;
    el.querySelectorAll('.chip').forEach(function (c) {
      c.onclick = function () {
        const id = c.getAttribute('data-id');
        if (id === 'add') { promptCategory(); return; }
        state.catId = parseInt(id, 10) || 0;
        renderChips();
        renderList();
      };
    });
  }

  function promptCategory() {
    const name = window.prompt('新分类名称');
    if (name && name.trim()) {
      Store.addCategory(name.trim());
      renderChips();
    }
  }

  function renderList() {
    const q = state.query;
    const list = Store.notes(state.catId, q);
    const box = $('#list');
    if (!list.length) {
      box.innerHTML = '<div class="empty">' + (q ? '没找到「' + esc(q) + '」' : '还没有备忘，点右下角 ＋ 写一条') + '</div>';
      return;
    }
    let html = '';
    let lastDay = '';
    list.forEach(function (n) {
      const day = dayLabel(n.updated);
      if (day !== lastDay) { html += '<div class="date-hd">' + day + '</div>'; lastDay = day; }
      const cat = Store.categoryById(n.catId);
      const preview = Store.plain(n.body || '');
      html += '<div class="note" data-id="' + n.id + '">' +
        '<h3>' + (n.starred ? '★ ' : '') + highlight(n.title || '无标题', q) + '</h3>' +
        (preview ? '<p>' + highlight(preview, q) + '</p>' : '') +
        '<div class="meta">' +
        (cat ? '<span class="dot" style="background:' + esc(cat.color) + '"></span><span>' + esc(cat.name) + '</span>' : '') +
        '<span>' + fmtTime(n.updated) + '</span></div>' +
        '</div>';
    });
    box.innerHTML = html;
    box.querySelectorAll('.note').forEach(function (el) {
      const id = parseInt(el.getAttribute('data-id'), 10);
      el.onclick = function () { openEditor(id); };
      bindLongPress(el, function () {
        const n = Store.noteById(id);
        if (!n) return;
        sheet(n.title || '无标题', [
          { label: n.starred ? '取消星标' : '星标', onTap: function () { Store.updateNote(id, { starred: !n.starred }); renderList(); } },
          { label: '复制正文', onTap: function () { Native.call('share', { text: Store.plain(n.body || '') }); } },
          { label: '删除', danger: true, onTap: function () { Store.trashNote(id); renderList(); toast('已移入回收站'); } }
        ]);
      });
    });
  }

  function bindLongPress(el, fn) {
    let timer = 0;
    el.addEventListener('touchstart', function () {
      timer = setTimeout(function () { fn(); }, 480);
    }, { passive: true });
    ['touchend', 'touchmove', 'touchcancel'].forEach(function (ev) {
      el.addEventListener(ev, function () { clearTimeout(timer); }, { passive: true });
    });
  }

  /* ---------- 编辑器 ---------- */
  function openEditor(id) {
    const n = Store.noteById(id);
    if (!n) return;
    state.editId = id;
    $('#edTitle').value = n.title || '';
    const body = $('#edBody');
    body.innerHTML = Store.sanitize(n.body || '');
    resolveMedia(body);
    show('editor');
    $('#edStatus').textContent = '已保存';
    setTimeout(function () { body.focus(); }, 50);
  }

  function currentNote() { return Store.noteById(state.editId); }

  function editorChanged() {
    const n = currentNote();
    if (!n) return;
    const body = $('#edBody');
    Store.updateNote(state.editId, {
      title: $('#edTitle').value,
      body: Store.sanitize(body.innerHTML)
    });
    $('#edStatus').textContent = '保存中…';
    clearTimeout(editorChanged._t);
    editorChanged._t = setTimeout(function () {
      Store.flush();
      $('#edStatus').textContent = '已保存';
    }, 500);
  }

  /* 把 data-path 的资源换成 data URL */
  function resolveMedia(root) {
    const targets = Array.prototype.slice.call(root.querySelectorAll('img[data-path], audio[data-path]'));
    targets.forEach(function (el) {
      const p = el.getAttribute('data-path');
      if (!p) return;
      if (state.imgCache[p]) { el.setAttribute('src', state.imgCache[p]); return; }
      Native.call('fs', { op: 'bytes', path: p }).then(function (r) {
        const url = 'data:' + (el.tagName === 'AUDIO' ? 'audio/wav' : 'image/jpeg') + ';base64,' + r.base64;
        state.imgCache[p] = url;
        el.setAttribute('src', url);
      }).catch(function () { /* 资源丢失就留空 */ });
    });
  }

  function wrapSelection(prop, value) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) { toast('先选中要修改的文字'); return; }
    const span = document.createElement('span');
    span.style[prop] = value;
    try {
      range.surroundContents(span);
    } catch (e) {
      const frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
    }
    sel.removeAllRanges();
    const r2 = document.createRange();
    r2.selectNodeContents(span);
    sel.addRange(r2);
    editorChanged();
  }

  function insertAtCursor(node) {
    const body = $('#edBody');
    body.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) { body.appendChild(node); return; }
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function pickColor(title, prop, presets) {
    const sh = $('#sheet');
    const mask = $('#mask');
    sh.innerHTML = '<h3>' + esc(title) + '</h3><div class="swatches">' +
      presets.map(function (c) { return '<div class="sw" data-c="' + c + '" style="background:' + c + '"></div>'; }).join('') +
      '</div><div class="hexrow"><input id="hexInput" placeholder="#E5484D" maxlength="7"><button class="btn-primary" id="hexOk">用这个</button></div>';
    sh.querySelectorAll('.sw').forEach(function (sw) {
      sw.onclick = function () {
        closeSheet();
        wrapSelection(prop, sw.getAttribute('data-c'));
      };
    });
    sh.querySelector('#hexOk').onclick = function () {
      let v = (sh.querySelector('#hexInput').value || '').trim();
      if (!/^#?[0-9a-fA-F]{6}$/.test(v)) { toast('请输入 6 位颜色，例如 #E5484D'); return; }
      if (v[0] !== '#') v = '#' + v;
      closeSheet();
      wrapSelection(prop, v);
    };
    mask.classList.add('on');
    sh.classList.add('on');
  }

  const TEXT_COLORS = ['#1E1E1E', '#8A8F98', '#E5484D', '#F76B15', '#12A150', '#2E7CF6', '#8E4EC6', '#E93D82'];
  const BG_COLORS = ['#FFF3C4', '#FFE0E0', '#E3F7E8', '#EAF1FE', '#F3E8FF', '#EDEFF2'];

  async function insertImage() {
    try {
      const r = await Native.call('photo.pick', {});
      const img = document.createElement('img');
      img.setAttribute('data-path', r.path);
      img.setAttribute('src', 'data:image/jpeg;base64,' + r.base64);
      insertAtCursor(img);
      editorChanged();
    } catch (e) {
      toast(e.message || '没有选择图片');
    }
  }

  async function toggleRecord() {
    const btn = $('#tRec');
    if (!state.recording) {
      try {
        await Native.call('audio.start', { path: 'audio/rec-' + Date.now() + '.wav' });
        state.recording = true;
        btn.classList.add('on');
        btn.textContent = '■';
        toast('录音中，再按一次结束');
      } catch (e) {
        toast(e.message || '录音失败');
      }
      return;
    }
    state.recording = false;
    btn.classList.remove('on');
    btn.textContent = '🎙';
    try {
      const r = await Native.call('audio.stop', {});
      if (r.ms < 600) { toast('太短了'); return; }
      const a = document.createElement('audio');
      a.setAttribute('controls', '');
      a.setAttribute('data-path', r.path);
      a.setAttribute('data-dur', String(r.ms));
      a.setAttribute('src', 'data:audio/wav;base64,' + r.base64);
      insertAtCursor(a);
      const br = document.createElement('div');
      br.innerHTML = '<br>';
      insertAtCursor(br.firstChild);
      editorChanged();
    } catch (e) {
      toast(e.message || '保存录音失败');
    }
  }

  /* ---------- 设置 ---------- */
  function renderSettings() {
    const s = Store.settings();
    const appr = $('#appVer').textContent;
    const rows = [
      ['基础', [
        ['外观', s.theme === 'dark' ? '深色' : '浅色', function () { pickTheme(); }],
        ['字号', s.noteFontPx + ' px', function () { pickFont(); }],
        ['版本', appr, null]
      ]],
      ['语音与识别', [
        ['API Key', s.apiKey ? '已设置' : '未设置', function () { setApiKey(); }],
        ['接口地址', s.apiBase, function () { setApiBase(); }],
        ['模型', s.model, function () { pickModel(); }]
      ]],
      ['其他', [
        ['分类管理', Store.categories().length + ' 个', function () { manageCategories(); }],
        ['回收站', Store.trashed().length + ' 条', function () { show('trash'); }],
        ['导出全部备忘', '复制到剪贴板', function () {
          Native.call('share', { text: Store.exportText() });
          toast('已调起分享');
        }]
      ]]
    ];
    let html = '';
    rows.forEach(function (sec) {
      html += '<div class="sec"><h2>' + sec[0] + '</h2><div class="rows">';
      sec[1].forEach(function (r) {
        html += '<div class="row" data-k="' + esc(r[0]) + '"><span>' + esc(r[0]) + '</span><span class="v">' + esc(r[1]) + '</span></div>';
      });
      html += '</div></div>';
    });
    $('#settingsPage').innerHTML = html;
    $('#settingsPage').querySelectorAll('.row').forEach(function (el) {
      const k = el.getAttribute('data-k');
      const found = [];
      rows.forEach(function (sec) { sec[1].forEach(function (r) { if (r[0] === k) found.push(r); }); });
      if (found.length && found[0][2]) el.onclick = found[0][2];
    });
  }

  function pickTheme() {
    const s = Store.settings();
    sheet('外观', [
      { label: '浅色', onTap: function () { applyTheme('light'); renderSettings(); } },
      { label: '深色', onTap: function () { applyTheme('dark'); renderSettings(); } }
    ]);
  }

  function applyTheme(t) {
    Store.setSetting('theme', t);
    document.body.classList.toggle('dark', t === 'dark');
    Store.flush();
  }

  function pickFont() {
    const s = Store.settings();
    sheet('正文字号', [14, 16, 18, 20, 22].map(function (px) {
      return {
        label: px + ' px' + (s.noteFontPx === px ? '  ✓' : ''),
        onTap: function () { Store.setSetting('noteFontPx', px); applyFont(); renderSettings(); }
      };
    }));
  }

  function applyFont() {
    $('#edBody').style.fontSize = Store.settings().noteFontPx + 'px';
  }

  function setApiKey() {
    const v = window.prompt('DeepSeek API Key（只存在本机）', Store.settings().apiKey || '');
    if (v === null) return;
    Store.setSetting('apiKey', v.trim());
    Store.flush();
    renderSettings();
  }

  function setApiBase() {
    const v = window.prompt('接口地址', Store.settings().apiBase);
    if (v === null) return;
    Store.setSetting('apiBase', v.trim() || 'https://api.deepseek.com');
    Store.flush();
    renderSettings();
  }

  function pickModel() {
    const models = ['deepseek-flash', 'deepseek-chat', 'deepseek-reasoner'];
    sheet('模型', models.map(function (m) {
      return { label: m, onTap: function () { Store.setSetting('model', m); Store.flush(); renderSettings(); } };
    }));
  }

  function manageCategories() {
    const cats = Store.categories();
    const items = cats.map(function (c) {
      return {
        label: c.name + '（长按那行可改名）',
        onTap: function () {
          const nm = window.prompt('改名', c.name);
          if (nm && nm.trim()) { Store.renameCategory(c.id, nm.trim()); renderChips(); renderSettings(); }
        }
      };
    });
    items.push({ label: '＋ 新建分类', onTap: promptCategory });
    sheet('分类管理', items);
  }

  /* ---------- 回收站 ---------- */
  function renderTrash() {
    const list = Store.trashed();
    const box = $('#trashPage');
    if (!list.length) { box.innerHTML = '<div class="empty">回收站是空的</div>'; return; }
    box.innerHTML = list.map(function (n) {
      return '<div class="note" data-id="' + n.id + '">' +
        '<h3>' + esc(n.title || '无标题') + '</h3>' +
        '<p>' + esc(Store.plain(n.body || '')) + '</p>' +
        '<div class="meta"><span>' + dayLabel(n.deletedAt || n.updated) + ' 删除</span></div></div>';
    }).join('');
    box.querySelectorAll('.note').forEach(function (el) {
      const id = parseInt(el.getAttribute('data-id'), 10);
      el.onclick = function () {
        sheet(Store.noteById(id).title || '无标题', [
          { label: '恢复', onTap: function () { Store.restoreNote(id); renderTrash(); toast('已恢复'); } },
          { label: '彻底删除', danger: true, onTap: function () { Store.purgeNote(id); renderTrash(); } }
        ]);
      };
    });
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    $('#btnSettings').onclick = function () { show('settings'); };
    $('#btnNew').onclick = function () { const n = Store.createNote(state.catId); openEditor(n.id); };
    $('#btnChat').onclick = function () { toast('聊天窗口下一版接入'); };
    $('#btnBack').onclick = function () { Store.flush(); show('home'); renderChips(); };
    $('#edTitle').oninput = editorChanged;
    $('#edBody').oninput = editorChanged;
    $('#edBody').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') setTimeout(editorChanged, 0);
    });

    $('#tBold').onclick = function () {
      $('#edBody').focus();
      document.execCommand('bold');
      editorChanged();
    };
    $('#tColor').onclick = function () { pickColor('文字颜色', 'color', TEXT_COLORS); };
    $('#tHl').onclick = function () { pickColor('高亮背景', 'backgroundColor', BG_COLORS); };
    $('#tTodo').onclick = function () {
      const body = $('#edBody');
      body.focus();
      document.execCommand('insertText', false, '□ ');
      editorChanged();
    };
    $('#tImg').onclick = insertImage;
    $('#tRec').onclick = toggleRecord;
    $('#tDel').onclick = function () {
      if (!state.editId) return;
      sheet('这条备忘', [
        { label: '移到回收站', danger: true, onTap: function () { Store.trashNote(state.editId); Store.flush(); show('home'); renderChips(); } }
      ]);
    };

    $('#search').oninput = function () {
      state.query = this.value;
      renderList();
    };
    $('#mask').onclick = closeSheet;

    $('#settingsBack').onclick = function () { show('home'); };
    $('#trashBack').onclick = function () { show('settings'); };
    $('#trashClear').onclick = function () {
      sheet('清空回收站', [{ label: '全部彻底删除', danger: true, onTap: function () { Store.emptyTrash(); renderTrash(); } }]);
    };

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) Store.flush();
    });
  }

  /* ---------- 启动 ---------- */
  async function boot() {
    await Store.load();
    const s = Store.settings();
    document.body.classList.toggle('dark', s.theme === 'dark');
    applyFont();
    try {
      const info = await Native.call('info', {});
      $('#appVer').textContent = 'v' + info.version + (Native.hasNative ? '' : ' · web');
    } catch (e) {
      $('#appVer').textContent = 'v1.0.0';
    }
    bind();
    renderChips();
    renderList();
    show('home');
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
