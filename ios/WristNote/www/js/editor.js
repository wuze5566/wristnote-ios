/* 编辑器：标题 + 富文本正文、字色/高亮/加粗/待办/图片/语音、自动保存、纸张背景 */
window.Editor = (function () {
  const $ = U.$;

  const state = {
    id: null,
    newNote: false,
    dirty: false,
    saving: false,
    lastSavedAt: 0,
    playingAtom: null,
    record: null
  };

  let saveTimer = 0;
  let scrollTouch = false;

  function init() {
    $('#edBack').addEventListener('click', function () { close(); });
    $('#edDone').addEventListener('click', function () { saveNow(true); close(); });
    $('#edStar').addEventListener('click', toggleStar);
    $('#edMore').addEventListener('click', showMore);
    $('#edCat').addEventListener('click', function () {
      if (state.id) Home.pickCategory(state.id);
    });
    $('#edTitle').addEventListener('input', function () { onEdit(); updateNavTitle(); });
    $('#edBody').addEventListener('input', onEdit);
    $('#edBody').addEventListener('paste', onPaste);
    $('#edBody').addEventListener('click', onBodyClick);

    $('#tColor').addEventListener('click', showColorSheet);
    $('#tBold').addEventListener('click', function () { exec('bold'); });
    $('#tTodo').addEventListener('click', insertTodo);
    $('#tImage').addEventListener('click', showImageSheet);
    $('#tMic').addEventListener('click', openRecorder);
    $('#tMore').addEventListener('click', showMore);

    const scroller = document.querySelector('#v-editor .ed-scroll');
    scroller.addEventListener('touchmove', function () { scrollTouch = true; }, { passive: true });
    scroller.addEventListener('scroll', function () {
      if (!scrollTouch) return;
      scrollTouch = false;
      if (!Store.settings().hideCursor) return;
      const active = document.activeElement;
      if (active && (active.id === 'edBody' || active.id === 'edTitle')) {
        active.blur();
        window.scrollTo(0, 0);
      }
    }, { passive: true });

    Native.onAudio(onAudioEvent);
  }

  /* ------------------------------- 生命周期 ------------------------------- */

  function open(id) {
    const note = Store.noteById(id);
    if (!note) { U.toast('备忘不存在'); return; }
    state.id = id;
    state.newNote = (Date.now() - (note.created || 0) < 4000) && !note.title && !note.plain;
    state.dirty = false;

    const title = $('#edTitle');
    title.value = note.title || '';
    const body = $('#edBody');
    body.innerHTML = Store.sanitize(note.body || '');
    hydrateMedia(body);
    refreshTodos();
    body.classList.toggle('is-empty', !body.textContent.trim() && !body.querySelector('img,.vn-audio'));
    applyFont();
    applyPaper();

    $('#edCat').textContent = categoryLabel(note);
    renderTags();
    fillStar(note.starred);
    updateNavTitle();
    setSaveState('已保存');
    $('#edDone').textContent = Store.settings().saveMode === 1 ? '保存' : '完成';

    App.show('editor');
    setTimeout(function () {
      if (Store.settings().autoKeyboard) body.focus();
    }, 260);
  }

  function onShow() {
    if (state.id && !Store.noteById(state.id)) close();
  }

  function onHide() {
    stopInlineAudio();
    if (state.record) finishRecording(false);
    if (state.dirty) saveNow(false);
  }

  function close() {
    if (Store.settings().saveMode === 1 && state.dirty) {
      U.confirm({
        title: '还没保存', message: '这条备忘还没保存，要保存吗？',
        okText: '保存', cancelText: '放弃'
      }).then(function (ok) {
        if (ok) saveNow(true); else discardNewIfEmpty();
        finishClose();
      });
      return;
    }
    saveNow(true);
    finishClose();
  }

  function finishClose() {
    stopInlineAudio();
    discardNewIfEmpty();
    const id = state.id;
    state.id = null;
    Store.flush();
    App.back('home');
    if (window.Home) Home.render();
    return id;
  }

  function discardNewIfEmpty() {
    if (!state.id || !state.newNote) return;
    const n = Store.noteById(state.id);
    if (!n) return;
    const empty = !(n.title || '').trim() && !(n.plain || '').trim() && !/<(img|audio)/i.test(n.body || '') && !(n.tags || []).length;
    if (empty) Store.purgeNote(state.id);
  }

  /* ------------------------------- 保存 ------------------------------- */

  function onEdit() {
    state.dirty = true;
    setSaveState(Store.settings().saveMode === 1 ? '未保存' : '保存中…');
    const body = $('#edBody');
    body.classList.toggle('is-empty', !body.textContent.trim() && !body.querySelector('img,.vn-audio'));
    refreshTodos();
    if (Store.settings().saveMode === 1) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveNow(false); }, 600);
  }

  function collect() {
    if (!state.id) return null;
    const n = Store.noteById(state.id);
    if (!n) return null;
    const body = $('#edBody').innerHTML;
    return { title: $('#edTitle').value.trim(), body: Store.sanitize(body) };
  }

  function saveNow(force) {
    if (!state.id) return;
    const n = Store.noteById(state.id);
    if (!n) return;
    if (!state.dirty && !force) return;
    const data = collect();
    if (!data) return;
    const changed = n.title !== data.title || n.body !== data.body;
    if (changed || force) {
      Store.updateNote(state.id, data);
      state.dirty = false;
      state.lastSavedAt = Date.now();
      setSaveState('已保存');
      if (force) Store.flush();
    }
  }

  function setSaveState(text) {
    $('#edSaveState').textContent = text;
  }

  function updateNavTitle() {
    $('#edNavTitle').textContent = '备忘';
  }

  function renderMeta() {
    if (!state.id) return;
    const n = Store.noteById(state.id);
    if (!n) return;
    $('#edCat').textContent = categoryLabel(n);
    renderTags();
    fillStar(n.starred);
  }

  function categoryLabel(note) {
    const cat = Store.categoryById(note.catId);
    return cat ? cat.name : '未分类';
  }

  function renderTags() {
    const n = Store.noteById(state.id);
    const box = $('#edTags');
    if (!n) { box.innerHTML = ''; return; }
    let html = (n.tags || []).map(function (t) {
      return '<button class="tag-mini" data-tag="' + U.esc(t) + '">' + U.esc(t) + '</button>';
    }).join('');
    html += '<button class="tag-add" id="edTagAdd" aria-label="添加标签">＋</button>';
    box.innerHTML = html;
    U.$$('.tag-mini', box).forEach(function (chip) {
      chip.addEventListener('click', function () {
        const t = chip.getAttribute('data-tag');
        U.confirm({ title: '移除标签', message: '移除标签「' + t + '」？', okText: '移除' }).then(function (ok) {
          if (!ok) return;
          Store.setTags(state.id, (Store.noteById(state.id).tags || []).filter(function (x) { return x !== t; }));
          Store.flush();
          renderTags();
        });
      });
    });
    const add = $('#edTagAdd', box);
    if (add) add.addEventListener('click', function () { Home.pickTags(state.id); });
  }

  function fillStar(on) {
    const btn = $('#edStar');
    btn.classList.toggle('accent', !!on);
    btn.style.color = on ? 'var(--star)' : '';
    const use = btn.querySelector('use');
    if (use) use.setAttribute('href', on ? '#i-star' : '#i-star');
    btn.querySelector('svg').style.fill = on ? 'currentColor' : 'none';
  }

  function toggleStar() {
    if (!state.id) return;
    const on = Store.toggleStar(state.id);
    fillStar(on);
    Store.flush();
    U.haptic();
    U.toast(on ? '已加星标' : '已取消星标');
  }

  /* ------------------------------- 富文本 ------------------------------- */

  function exec(cmd, value) {
    const body = $('#edBody');
    body.focus();
    try { document.execCommand(cmd, false, value); } catch (e) { /* ignore */ }
    onEdit();
  }

  function selectionInBody() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const body = $('#edBody');
    if (!body.contains(range.commonAncestorContainer)) return null;
    return range;
  }

  function insertNodeAtCaret(node) {
    const body = $('#edBody');
    body.focus();
    let range = selectionInBody();
    if (!range) {
      const r = document.createRange();
      r.selectNodeContents(body);
      r.collapse(false);
      range = r;
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
    range.deleteContents();
    range.insertNode(node);
    const after = document.createRange();
    after.setStartAfter(node);
    after.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(after);
    onEdit();
  }

  function insertBlockNode(node) {
    const body = $('#edBody');
    const wrap = document.createElement('div');
    wrap.appendChild(node);
    insertNodeAtCaret(wrap);
    body.classList.remove('is-empty');
  }

  function onPaste(e) {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
    if (!text) return;
    document.execCommand('insertText', false, text);
  }

  function refreshTodos() {
    const body = $('#edBody');
    Array.prototype.slice.call(body.children).forEach(function (block) {
      if (block.tagName !== 'DIV' && block.tagName !== 'P') return;
      const txt = block.textContent || '';
      const done = txt.indexOf('■') === 0;
      block.classList.toggle('todo-done', done);
    });
  }

  function onBodyClick(e) {
    const atom = e.target.closest ? e.target.closest('.vn-audio') : null;
    if (atom) {
      e.preventDefault();
      toggleInlineAudio(atom);
      return;
    }
    // 点行首的 □ / ■ 切换待办
    const range = selectionInBody();
    if (!range) return;
    let node = range.startContainer;
    if (node.nodeType === 3) node = node.parentNode;
    const block = node.closest ? node.closest('#edBody > div, #edBody > p') : null;
    if (!block) return;
    const txt = block.textContent || '';
    if (txt.charAt(0) !== '□' && txt.charAt(0) !== '■') return;

    const rect = block.getBoundingClientRect();
    const clickX = (e.clientX !== undefined ? e.clientX : (e.changedTouches && e.changedTouches[0].clientX) || 0);
    if (clickX - rect.left > 30) return; // 只有点行首方块才切换，方便正常编辑

    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
    const first = walker.nextNode();
    if (!first || !first.nodeValue) return;
    const ch = first.nodeValue.charAt(0);
    if (ch === '□') first.nodeValue = '■' + first.nodeValue.slice(1);
    else if (ch === '■') first.nodeValue = '□' + first.nodeValue.slice(1);
    else return;
    U.haptic();
    refreshTodos();
    onEdit();
  }

  function insertTodo() {
    const body = $('#edBody');
    body.focus();
    const range = selectionInBody();
    let atLineStart = true;
    if (range) {
      const block = (range.startContainer.nodeType === 3 ? range.startContainer.parentNode : range.startContainer)
        .closest && (range.startContainer.nodeType === 3 ? range.startContainer.parentNode : range.startContainer).closest('#edBody > div, #edBody > p');
      if (block) {
        const before = range.cloneRange();
        before.selectNodeContents(block);
        before.setEnd(range.startContainer, range.startOffset);
        atLineStart = !before.toString().trim();
      }
    }
    const text = (atLineStart ? '' : '\n') + '□ ';
    document.execCommand('insertText', false, text);
    refreshTodos();
    onEdit();
  }

  /* ------------------------------- 字色 ------------------------------- */

  function showColorSheet() {
    const s = Store.settings();
    let mode = 'fg';
    const body = document.createElement('div');
    body.innerHTML =
      '<div class="seg" style="display:flex;gap:8px;padding:0 18px 10px">' +
      '<button class="chip on" data-mode="fg" style="flex:1;justify-content:center">字色</button>' +
      '<button class="chip" data-mode="bg" style="flex:1;justify-content:center">高亮</button>' +
      '</div><div class="swatch-grid" id="swGrid"></div>' +
      (s.hexColor ? '<div class="hex-row"><input id="hexInput" placeholder="#2E7CF6" maxlength="7"><button class="pill" id="hexOk" style="height:42px;border-radius:11px;padding:0 16px">用这个</button></div>' : '');

    U.sheet({ title: '文字颜色', body: body, cancel: true });

    const grid = document.getElementById('swGrid');
    function paint() {
      const colors = mode === 'fg' ? Store.TEXT_COLORS : Store.HIGHLIGHT_COLORS;
      grid.innerHTML = colors.map(function (c, i) {
        const bg = mode === 'fg' ? (c || 'var(--ink)') : (c || 'transparent');
        const label = mode === 'fg' ? Store.TEXT_COLOR_NAMES[i] : Store.HIGHLIGHT_NAMES[i];
        return '<button class="swatch" data-i="' + i + '" title="' + label + '" style="background:' + bg +
          (c ? '' : ';border-style:dashed') + '"></button>';
      }).join('');
      U.$$('.swatch', grid).forEach(function (sw) {
        sw.addEventListener('click', function () {
          const i = parseInt(sw.getAttribute('data-i'), 10);
          U.closeSheet();
          applyColor(mode, i);
        });
      });
    }
    paint();
    U.$$('.chip[data-mode]', body).forEach(function (btn) {
      btn.addEventListener('click', function () {
        mode = btn.getAttribute('data-mode');
        U.$$('.chip[data-mode]', body).forEach(function (b) { b.classList.toggle('on', b === btn); });
        paint();
      });
    });
    const hexOk = document.getElementById('hexOk');
    if (hexOk) {
      hexOk.addEventListener('click', function () {
        let v = (document.getElementById('hexInput').value || '').trim();
        if (!/^#?[0-9a-fA-F]{6}$/.test(v)) { U.toast('颜色格式不对，请输入 #RRGGBB'); return; }
        if (v.charAt(0) !== '#') v = '#' + v;
        U.closeSheet();
        wrapSelection(mode === 'fg' ? 'color' : 'backgroundColor', v);
      });
    }
  }

  function applyColor(mode, index) {
    const colors = mode === 'fg' ? Store.TEXT_COLORS : Store.HIGHLIGHT_COLORS;
    const value = colors[index];
    if (!value) {
      // 默认 / 无：移除对应样式
      unwrapStyle(mode === 'fg' ? 'color' : 'background-color');
      return;
    }
    wrapSelection(mode === 'fg' ? 'color' : 'backgroundColor', value);
  }

  function wrapSelection(prop, value) {
    const range = selectionInBody();
    if (!range) { U.toast('先在正文里选中文字'); return; }
    if (range.collapsed) { U.toast('先选中要修改的文字'); return; }
    const span = document.createElement('span');
    span.style[prop] = value;
    try {
      range.surroundContents(span);
    } catch (e) {
      const frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
    }
    const sel = window.getSelection();
    sel.removeAllRanges();
    const r2 = document.createRange();
    r2.selectNodeContents(span);
    sel.addRange(r2);
    U.haptic();
    onEdit();
  }

  function unwrapStyle(cssProp) {
    const range = selectionInBody();
    if (!range || range.collapsed) { U.toast('先选中要修改的文字'); return; }
    const frag = range.extractContents();
    U.$$('span', frag).forEach(function (sp) {
      sp.style.removeProperty(cssProp);
      if (!sp.getAttribute('style')) {
        const parent = sp.parentNode;
        while (sp.firstChild) parent.insertBefore(sp.firstChild, sp);
        parent.removeChild(sp);
      }
    });
    range.insertNode(frag);
    onEdit();
    U.toast('已恢复默认');
  }

  /* ------------------------------- 图片 ------------------------------- */

  function showImageSheet() {
    U.sheet({
      title: '插入图片',
      items: [
        { icon: 'image', label: '从相册选择', onTap: pickPhoto },
        { icon: 'star', label: '内置贴纸', onTap: showStickers }
      ]
    });
  }

  async function pickPhoto() {
    try {
      U.toast('正在导入图片…');
      const r = await Native.call('photo.pick', {});
      const img = document.createElement('img');
      img.setAttribute('data-path', r.path);
      img.setAttribute('src', Store.mediaURL(r.path));
      insertBlockNode(img);
      Store.log('插入图片 ' + r.path + ' ' + r.w + 'x' + r.h);
    } catch (e) {
      if (String(e.message || '').indexOf('取消') < 0) U.toast('图片读取失败，换一张试试');
    }
  }

  function showStickers() {
    const names = ['star.png', 'heart.png', 'sun.png', 'flower.png', 'cloud.png', 'rainbow.png'];
    const body = document.createElement('div');
    body.innerHTML = '<div class="sticker-grid">' + names.map(function (n) {
      return '<button class="sticker" data-n="' + n + '"><img src="stickers/' + n + '" alt=""></button>';
    }).join('') + '</div>';
    U.sheet({ title: '选一张贴纸', body: body });
    U.$$('.sticker', body).forEach(function (btn) {
      btn.addEventListener('click', function () {
        U.closeSheet();
        const n = btn.getAttribute('data-n');
        const img = document.createElement('img');
        img.setAttribute('data-asset', 'stickers/' + n);
        img.setAttribute('src', 'stickers/' + n);
        insertBlockNode(img);
      });
    });
  }

  /* ------------------------------- 语音 ------------------------------- */

  function openRecorder() {
    if (state.record) return;
    const chunk = Math.max(1, Store.settings().voiceChunk || 5);
    const wrap = document.createElement('div');
    wrap.className = 'rec-wrap';
    wrap.innerHTML =
      '<div class="rec-timer" id="recTimer">0:00</div>' +
      '<div class="rec-hint" id="recHint">点圆点开始录音</div>' +
      '<div class="rec-wave" id="recWave">' + new Array(24).fill('<i></i>').join('') + '</div>' +
      '<div class="rec-actions">' +
      '<button class="rec-side" id="recCancel">放弃</button>' +
      '<button class="rec-btn" id="recBtn">' + U.icon('mic') + '</button>' +
      '<button class="rec-side accent" id="recDone">完成</button>' +
      '</div>';

    U.sheet({ body: wrap, cancel: false });
    // 阻止点遮罩关闭：录音时点外面 = 自动保存
    const mask = $('#mask');
    mask.classList.remove('on');
    mask.classList.add('on');
    const onMask = function () {
      mask.removeEventListener('click', onMask);
      if (state.record) finishRecording(true);
      U.closeSheet();
    };
    setTimeout(function () {
      // 替换掉全局关闭行为
      mask.onclick = null;
      mask.addEventListener('click', onMask);
    }, 10);

    const rec = {
      active: false, segments: [], startedAt: 0, segStartedAt: 0,
      timer: 0, meter: 0, chunk: chunk, base: 'audio/rec-' + Date.now()
    };
    state.record = rec;

    const btn = document.getElementById('recBtn');
    const timerEl = document.getElementById('recTimer');
    const hintEl = document.getElementById('recHint');
    const wave = document.getElementById('recWave');
    const cancelBtn = document.getElementById('recCancel');
    const doneBtn = document.getElementById('recDone');

    function fmt(ms) { return U.fmtDur(ms); }

    function updateTimer() {
      if (!rec.startedAt) return;
      timerEl.textContent = fmt(Date.now() - rec.startedAt);
    }

    async function startSegment() {
      rec.segStartedAt = Date.now();
      const path = rec.base + '-s' + rec.segments.length + '.wav';
      await Native.call('audio.start', { path: path });
      rec.currentPath = path;
      rec.active = true;
      btn.classList.add('recording');
      btn.innerHTML = U.icon('stop');
      hintEl.textContent = '录音中 · 每 ' + rec.chunk + ' 秒自动保存';
      wave.classList.add('on');
      rec.timer = setInterval(updateTimer, 200);
      rec.meter = setInterval(async function () {
        try {
          const r = await Native.call('audio.level', {});
          const lv = Math.max(-60, Math.min(0, r.level || -60));
          const h = Math.round(4 + ((lv + 60) / 60) * 34);
          Array.prototype.slice.call(wave.children).forEach(function (bar, i) {
            const jitter = 0.55 + Math.random() * 0.45;
            bar.style.height = Math.max(3, Math.round(h * jitter)) + 'px';
          });
        } catch (e) { /* ignore */ }
      }, 120);
      rec.autoTimer = setInterval(function () { cutSegment(); }, rec.chunk * 1000);
      markPartial();
    }

    async function cutSegment() {
      if (!rec.active) return;
      rec.active = false;
      clearInterval(rec.timer);
      clearInterval(rec.meter);
      clearInterval(rec.autoTimer);
      try {
        const r = await Native.call('audio.stop', {});
        if (r && r.path) rec.segments.push({ path: r.path, ms: r.ms || 0 });
      } catch (e) { /* ignore */ }
      markPartial();
    }

    async function markPartial() {
      try {
        await Native.call('fs', {
          op: 'write', path: 'audio/recording.part',
          text: JSON.stringify({ started: rec.startedAt || Date.now(), segments: rec.segments, chunk: rec.chunk })
        });
      } catch (e) { /* ignore */ }
    }

    async function toggle() {
      if (!rec.active) {
        try {
          await startSegment();
        } catch (e) {
          U.toast(e.message || '录音失败，请检查麦克风');
          U.closeSheet();
          state.record = null;
        }
        return;
      }
      await cutSegment();
      btn.classList.remove('recording');
      btn.innerHTML = U.icon('mic');
      wave.classList.remove('on');
      Array.prototype.slice.call(wave.children).forEach(function (b) { b.style.height = '4px'; });
      hintEl.textContent = '已暂停，点圆点继续';
    }

    btn.addEventListener('click', toggle);

    cancelBtn.addEventListener('click', async function () {
      clearInterval(rec.timer); clearInterval(rec.meter); clearInterval(rec.autoTimer);
      if (rec.active) { try { await Native.call('audio.cancel', {}); } catch (e) { /* ignore */ } }
      for (const s of rec.segments) {
        try { await Native.call('fs', { op: 'delete', path: s.path }); } catch (e) { /* ignore */ }
      }
      try { await Native.call('fs', { op: 'delete', path: 'audio/recording.part' }); } catch (e) { /* ignore */ }
      state.record = null;
      U.closeSheet();
      U.toast('已放弃这段录音');
    });

    doneBtn.addEventListener('click', function () { finishRecording(true); });

    rec.finish = finishRecording;

    // 自动开始录音
    toggle();
  }

  async function finishRecording(autoSave) {
    const rec = state.record;
    if (!rec) return;
    state.record = null;
    clearInterval(rec.timer); clearInterval(rec.meter); clearInterval(rec.autoTimer);
    if (rec.active) {
      rec.active = false;
      try {
        const r = await Native.call('audio.stop', {});
        if (r && r.path) rec.segments.push({ path: r.path, ms: r.ms || 0 });
      } catch (e) { /* ignore */ }
    }
    try { await Native.call('fs', { op: 'delete', path: 'audio/recording.part' }); } catch (e) { /* ignore */ }
    U.closeSheet();

    const segs = rec.segments.filter(function (s) { return s.ms >= 200; });
    if (!segs.length) {
      for (const s of rec.segments) {
        try { await Native.call('fs', { op: 'delete', path: s.path }); } catch (e) { /* ignore */ }
      }
      U.toast('录音太短了');
      return;
    }
    const total = segs.reduce(function (a, s) { return a + s.ms; }, 0);
    if (!autoSave) return;
    insertAudioAtom(segs.map(function (s) { return s.path; }).join('|'), total);
    U.toast('已插入语音 ' + U.fmtDur(total));
  }

  function insertAudioAtom(path, dur) {
    const span = document.createElement('span');
    span.className = 'vn-audio';
    span.setAttribute('contenteditable', 'false');
    span.setAttribute('data-path', path);
    span.setAttribute('data-dur', String(dur));
    span.innerHTML = '<span class="play-dot">' + U.icon('play') + '</span><span class="dur-label">语音 ' + U.fmtDur(dur) + '</span>';
    insertBlockNode(span);
  }

  /* 语音块播放（多段顺序播放） */
  const inline = { atom: null, segs: [], index: 0, dur: 0, playing: false };

  function toggleInlineAudio(atom) {
    if (inline.playing && inline.atom === atom) {
      inlinePause();
      return;
    }
    if (inline.atom && inline.atom !== atom) inlineReset();
    const path = atom.getAttribute('data-path') || '';
    inline.atom = atom;
    inline.segs = path.split('|').filter(Boolean);
    inline.index = 0;
    inline.dur = parseInt(atom.getAttribute('data-dur') || '0', 10);
    inline.playing = true;
    atom.classList.add('playing');
    atom.querySelector('.play-dot').innerHTML = U.icon('pause');
    playSegment(0);
  }

  async function playSegment(i) {
    if (!inline.atom || i >= inline.segs.length) { inlineReset(); return; }
    inline.index = i;
    try {
      await Native.call('audio.play', { path: inline.segs[i], ms: 0, speed: 1 });
    } catch (e) {
      U.toast('播放失败：' + (e.message || ''));
      inlineReset();
    }
  }

  async function inlinePause() {
    inline.playing = false;
    if (!inline.atom) return;
    inline.atom.classList.remove('playing');
    inline.atom.querySelector('.play-dot').innerHTML = U.icon('play');
    try { await Native.call('audio.pause', {}); } catch (e) { /* ignore */ }
  }

  function inlineReset() {
    inline.playing = false;
    if (inline.atom) {
      inline.atom.classList.remove('playing');
      const dot = inline.atom.querySelector('.play-dot');
      if (dot) dot.innerHTML = U.icon('play');
    }
    inline.atom = null;
    inline.segs = [];
    inline.index = 0;
  }

  function stopInlineAudio() {
    if (inline.atom || inline.playing) {
      try { Native.call('audio.stop', {}); } catch (e) { /* ignore */ }
      inlineReset();
    }
  }

  function onAudioEvent(ev) {
    if (!ev) return;
    if (ev.state === 'ended') {
      if (inline.atom && inline.index + 1 < inline.segs.length) playSegment(inline.index + 1);
      else inlineReset();
    }
  }

  /* ------------------------------- 更多 ------------------------------- */

  function showMore() {
    if (!state.id) return;
    const n = Store.noteById(state.id);
    if (!n) return;
    const chars = (n.plain || '').replace(/\s/g, '').length;
    U.sheet({
      title: '备忘',
      items: [
        {
          icon: 'check', label: '立即保存', onTap: function () {
            state.dirty = true;
            saveNow(true);
            U.toast('已保存');
          }
        },
        {
          label: chars + ' 字 · 更新于 ' + U.fmtDateTime(n.updated), disabled: true
        },
        { icon: 'folder', label: '分类：' + categoryLabel(n), onTap: function () { Home.pickCategory(state.id); } },
        { icon: 'tag', label: '标签', onTap: function () { Home.pickTags(state.id); } },
        {
          icon: 'star', label: n.starred ? '取消星标' : '加星标', onTap: function () {
            const on = Store.toggleStar(state.id);
            fillStar(on);
            Store.flush();
          }
        },
        {
          icon: 'copy', label: '复制全文', onTap: function () {
            const cur = Store.noteById(state.id);
            const title = cur.title || Store.noteTitle(cur);
            U.copy(title + '\n\n' + (cur.plain || '')).then(function (ok) {
              U.toast(ok ? '已复制到剪贴板' : '复制失败');
            });
          }
        },
        {
          icon: 'share', label: '分享', onTap: function () {
            const cur = Store.noteById(state.id);
            const title = cur.title || Store.noteTitle(cur);
            Native.call('share', { text: title + '\n\n' + (cur.plain || ''), subject: title });
          }
        },
        {
          icon: 'trash', label: '删除备忘', danger: true, onTap: function () {
            U.confirm({ title: '删除备忘', message: '删除后可在「回收站」里恢复。', okText: '删除', danger: true })
              .then(function (ok) {
                if (!ok) return;
                Store.trashNote(state.id);
                state.dirty = false;
                state.id = null;
                Store.flush();
                App.back('home');
                Home.render();
                U.toast('已移到回收站');
              });
          }
        }
      ]
    });
  }

  /* ------------------------------- 显示 ------------------------------- */

  function hydrateMedia(root) {
    U.$$('img[data-path]', root).forEach(function (img) {
      const url = Store.mediaURL(img.getAttribute('data-path'));
      if (url) img.setAttribute('src', url);
    });
    U.$$('img[data-asset]', root).forEach(function (img) {
      img.setAttribute('src', img.getAttribute('data-asset'));
    });
  }

  function applyFont() {
    const px = Store.settings().editorFontPx || 17;
    const body = $('#edBody');
    body.style.fontSize = px + 'px';
    const title = $('#edTitle');
    title.style.fontSize = Math.min(30, px + 3) + 'px';
  }

  function applyPaper() {
    const card = $('#edPage');
    if (!card) return;
    const s = Store.settings();
    card.classList.remove('bg-none', 'bg-color', 'bg-image', 'paper-light');
    const type = s.noteBgType || 0;
    if (type === 1 && s.noteBgColor) {
      card.classList.add('bg-color');
      card.style.setProperty('--paper-color', s.noteBgColor);
      const lum = luminance(s.noteBgColor);
      if (lum > 0.62) card.classList.add('paper-light');
      if (lum > 0.62 && U.isDark()) card.classList.add('paper-force-dark-text');
    } else if (type === 2 && s.noteBgImage) {
      card.classList.add('bg-image');
      card.style.backgroundImage = 'url("' + Store.mediaURL(s.noteBgImage) + '")';
    } else {
      card.classList.add('bg-none');
      card.style.backgroundImage = '';
    }
  }

  function luminance(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return 0.5;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  return {
    init: init, open: open, onShow: onShow, onHide: onHide,
    applyPaper: applyPaper, applyFont: applyFont,
    saveNow: saveNow, renderMeta: renderMeta,
    currentNoteId: function () { return state.id; },
    isRecording: function () { return !!state.record; }
  };
})();
