/* 语音备忘：录音（分段自动保存/崩溃恢复）、播放进度与倍速、文件夹、转文字 */
window.Voice = (function () {
  const $ = U.$;

  const state = { folderId: 0 };
  const player = {
    voiceId: 0, segs: [], index: 0, base: 0, dur: 0,
    playing: false, speed: 1, lastMs: 0
  };
  let recorder = null;

  function init() {
    $('#voBack').addEventListener('click', function () { App.back('home'); });
    $('#voRecord').addEventListener('click', function () { openRecorder(); });
    $('#voNewFolder').addEventListener('click', function () { newFolder(); });
    Native.onAudio(onAudioEvent);
  }

  function render() {
    renderFolders();
    renderList();
  }

  function renderFolders() {
    const box = $('#voFolders');
    let html = '<button class="chip' + (state.folderId === 0 ? ' on' : '') + '" data-f="0">全部</button>';
    Store.voiceFolders().forEach(function (f) {
      html += '<button class="chip' + (state.folderId === f.id ? ' on' : '') +
        '" data-f="' + f.id + '" data-name="' + U.esc(f.name) + '">' + U.esc(f.name) + '</button>';
    });
    html += '<button class="chip add" id="voAddFolder">＋</button>';
    box.innerHTML = html;
    U.$$('.chip[data-f]', box).forEach(function (chip) {
      const id = parseInt(chip.getAttribute('data-f'), 10) || 0;
      chip.addEventListener('click', function () {
        state.folderId = id;
        render();
      });
      if (id) {
        U.longPress(chip, function () { folderSheet(id); });
      }
    });
    const add = $('#voAddFolder', box);
    if (add) add.addEventListener('click', newFolder);
  }

  function renderList() {
    const list = Store.voices(state.folderId);
    const box = $('#voList');
    if (!list.length) {
      box.innerHTML = '<div class="empty">' + U.icon('mic') +
        '<div class="empty-title">还没有语音备忘</div>' +
        '<div class="empty-sub">点右下角录音</div></div>';
      return;
    }
    box.innerHTML = list.map(function (v) {
      const folder = v.folderId ? Store.voiceFolderName(v.folderId) : '未分类';
      const playing = player.playing && player.voiceId === v.id;
      return '<article class="voice-card' + (playing ? ' active' : '') + '" data-id="' + v.id + '">' +
        '<div class="voice-top">' +
        '<button class="voice-play' + (playing ? ' playing' : '') + '" data-play="' + v.id + '">' +
        U.icon(playing ? 'pause' : 'play') + '</button>' +
        '<div class="voice-info">' +
        '<div class="voice-name">' + U.esc(v.name) + '</div>' +
        '<div class="voice-meta"><span class="voice-time" data-time="' + v.id + '">' + U.fmtDur(v.dur) + '</span>' +
        '<span>' + U.esc(folder) + '</span><span>' + U.esc(U.dayLabel(v.created)) + '</span></div>' +
        '</div>' +
        '<div class="voice-tools">' +
        '<button class="speed-chip" data-speed="' + v.id + '">' + speedText(v.speed || 1) + '</button>' +
        '<button class="voice-more" data-more="' + v.id + '">' + U.icon('more') + '</button>' +
        '</div></div>' +
        '<div class="voice-seek" data-seek="' + v.id + '"><div class="voice-seek-fill" data-fill="' + v.id + '"></div></div>' +
        '</article>';
    }).join('');

    U.$$('.voice-play', box).forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = parseInt(btn.getAttribute('data-play'), 10);
        togglePlay(id);
      });
    });
    U.$$('.speed-chip', box).forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const id = parseInt(btn.getAttribute('data-speed'), 10);
        const v = Store.voiceById(id);
        if (!v) return;
        const next = (v.speed || 1) >= 2 ? 1 : ((v.speed || 1) >= 1.5 ? 2 : 1.5);
        Store.updateVoice(id, { speed: next });
        Store.flush();
        btn.textContent = speedText(next);
        if (player.voiceId === id) {
          player.speed = next;
          if (player.playing) {
            const at = player.base + player.lastMs;
            playFrom(at, true);
          }
        }
      });
    });
    U.$$('.voice-more', box).forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        showVoiceSheet(parseInt(btn.getAttribute('data-more'), 10));
      });
    });
    U.$$('.voice-card', box).forEach(function (card) {
      const id = parseInt(card.getAttribute('data-id'), 10);
      U.longPress(card, function () { showVoiceSheet(id); });
      const seek = card.querySelector('.voice-seek');
      seek.addEventListener('click', function (e) {
        const v = Store.voiceById(id);
        if (!v) return;
        if (player.voiceId !== id) startPlay(id);
        const rect = seek.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        playFrom(ratio * (v.dur || 0), player.playing);
      });
    });
    restorePlayerUI();
  }

  function speedText(s) {
    return (s === 1 ? '1' : String(s)) + '×';
  }

  /* ------------------------------- 播放 ------------------------------- */

  function togglePlay(id) {
    if (player.playing && player.voiceId === id) {
      pause();
      return;
    }
    if (player.voiceId === id && player.base + player.lastMs > 0 && player.base + player.lastMs < player.dur - 200) {
      resume();
      return;
    }
    startPlay(id);
  }

  function startPlay(id) {
    const v = Store.voiceById(id);
    if (!v) return;
    const segs = Store.voiceFiles(v.path);
    if (!segs.length) { U.toast('语音文件丢失'); return; }
    player.voiceId = id;
    player.segs = segs;
    player.index = 0;
    player.base = 0;
    player.dur = v.dur || 0;
    player.speed = v.speed || 1;
    player.lastMs = 0;
    player.playing = true;
    renderList();
    playSegment(0, 0);
  }

  function playSegment(index, offsetMs) {
    if (!player.segs.length) return;
    player.index = index;
    player.base = offsetMs ? segmentBase(index) : segmentBase(index);
    player.lastMs = 0;
    Native.call('audio.play', {
      path: player.segs[index], ms: offsetMs || 0, speed: player.speed
    }).catch(function (e) {
      U.toast('播放失败：' + (e.message || ''));
      resetPlayer();
    });
    updateCard();
  }

  function segmentBase(index) {
    // 多段时用「前几段总时长」做基准；单段为 0
    if (!player.segs.length) return 0;
    const id = player.voiceId;
    const v = Store.voiceById(id);
    if (!v) return 0;
    const per = (v.dur || 0) / player.segs.length;
    return Math.round(per * index);
  }

  function playFrom(globalMs, autoPlay) {
    const id = player.voiceId;
    const v = Store.voiceById(id);
    if (!v) return;
    const segCount = player.segs.length;
    const per = (v.dur || 0) / Math.max(1, segCount);
    let idx = Math.min(segCount - 1, Math.floor(globalMs / Math.max(1, per)));
    const offset = Math.max(0, globalMs - idx * per);
    player.base = globalMs - offset;
    player.lastMs = 0;
    Native.call('audio.play', { path: player.segs[idx], ms: offset, speed: player.speed }).then(function () {
      if (!autoPlay) Native.call('audio.pause', {});
    }).catch(function () {});
    player.index = idx;
    player.playing = !!autoPlay;
    updateCard();
  }

  function pause() {
    player.playing = false;
    Native.call('audio.pause', {}).catch(function () {});
    updateCard();
  }

  function resume() {
    player.playing = true;
    Native.call('audio.resume', {}).catch(function () {});
    updateCard();
  }

  function stop() {
    Native.call('audio.stop', {}).catch(function () {});
    resetPlayer();
  }

  function resetPlayer() {
    player.voiceId = 0;
    player.segs = [];
    player.index = 0;
    player.base = 0;
    player.lastMs = 0;
    player.playing = false;
    renderList();
  }

  function onAudioEvent(ev) {
    if (!ev || !player.voiceId) return;
    if (ev.state === 'playing' || ev.state === 'paused') {
      if (typeof ev.ms === 'number') player.lastMs = ev.ms;
      updateCard();
    } else if (ev.state === 'ended') {
      if (player.index + 1 < player.segs.length) {
        const next = player.index + 1;
        playSegment(next, 0);
      } else {
        resetPlayer();
      }
    } else if (ev.state === 'stopped') {
      // 手动停止
    }
  }

  function updateCard() {
    if (!player.voiceId) return;
    const card = document.querySelector('.voice-card[data-id="' + player.voiceId + '"]');
    if (!card) return;
    card.classList.toggle('active', true);
    const fill = document.querySelector('[data-fill="' + player.voiceId + '"]');
    const time = document.querySelector('[data-time="' + player.voiceId + '"]');
    const btn = card.querySelector('.voice-play');
    const v = Store.voiceById(player.voiceId);
    const total = (v && v.dur) || player.dur || 1;
    const cur = Math.min(total, player.base + player.lastMs);
    if (fill) fill.style.width = Math.max(0, Math.min(100, (cur / total) * 100)) + '%';
    if (time) time.textContent = player.playing ? (U.fmtDur(cur) + ' / ' + U.fmtDur(total)) : U.fmtDur(total);
    if (btn) {
      btn.classList.toggle('playing', player.playing);
      btn.innerHTML = U.icon(player.playing ? 'pause' : 'play');
    }
  }

  function restorePlayerUI() {
    if (player.voiceId) {
      const card = document.querySelector('.voice-card[data-id="' + player.voiceId + '"]');
      if (card) card.classList.add('active');
    }
  }

  function onHide() {
    // 离开界面时停止播放（录音不中断，由用户操作结束）
    if (player.playing) {
      stop();
    }
  }

  /* ------------------------------- 录音 ------------------------------- */

  function openRecorder() {
    if (recorder) return;
    const chunk = Math.max(1, Store.settings().voiceChunk || 5);
    const wrap = document.createElement('div');
    wrap.className = 'rec-wrap';
    wrap.innerHTML =
      '<div class="rec-timer" id="recTimer">0:00</div>' +
      '<div class="rec-hint" id="recHint">正在准备麦克风…</div>' +
      '<div class="rec-wave" id="recWave">' + new Array(24).fill('<i></i>').join('') + '</div>' +
      '<div class="rec-actions">' +
      '<button class="rec-side" id="recCancel">放弃</button>' +
      '<button class="rec-btn" id="recBtn">' + U.icon('stop') + '</button>' +
      '<button class="rec-side accent" id="recDone">保存</button>' +
      '</div>';
    U.sheet({ body: wrap, cancel: false });

    const rec = {
      active: false, segments: [], startedAt: Date.now(), base: 'audio/voice-' + Date.now(),
      timer: 0, meter: 0, autoTimer: 0, chunk: chunk, closing: false
    };
    recorder = rec;

    const timerEl = document.getElementById('recTimer');
    const hintEl = document.getElementById('recHint');
    const wave = document.getElementById('recWave');
    const btn = document.getElementById('recBtn');

    const tick = function () {
      timerEl.textContent = U.fmtDur(Date.now() - rec.startedAt);
    };
    rec.timer = setInterval(tick, 200);

    rec.meter = setInterval(async function () {
      try {
        const r = await Native.call('audio.level', {});
        const lv = Math.max(-60, Math.min(0, r.level || -60));
        Array.prototype.slice.call(wave.children).forEach(function (bar) {
          const h = 4 + ((lv + 60) / 60) * 34 * (0.55 + Math.random() * 0.45);
          bar.style.height = Math.max(3, Math.round(h)) + 'px';
        });
      } catch (e) { /* ignore */ }
    }, 120);
    wave.classList.add('on');

    async function startSegment() {
      const path = rec.base + '-s' + rec.segments.length + '.wav';
      await Native.call('audio.start', { path: path });
      rec.currentPath = path;
      rec.active = true;
      markPartial();
      rec.autoTimer = setInterval(function () { cutSegment(); }, rec.chunk * 1000);
    }

    async function cutSegment() {
      if (!rec.active) return;
      rec.active = false;
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
          text: JSON.stringify({ started: rec.startedAt, segments: rec.segments, chunk: rec.chunk, kind: 'voice' })
        });
      } catch (e) { /* ignore */ }
    }

    async function toggle() {
      if (!rec.active) {
        try {
          await startSegment();
          hintEl.textContent = '录音中 · 每 ' + rec.chunk + ' 秒自动保存';
          btn.innerHTML = U.icon('stop');
        } catch (e) {
          U.toast(e.message || '录音失败，请检查麦克风');
          hintEl.textContent = '麦克风不可用';
        }
      } else {
        await cutSegment();
        hintEl.textContent = '已暂停，点圆点继续';
        btn.innerHTML = U.icon('mic');
      }
    }

    btn.addEventListener('click', toggle);

    document.getElementById('recCancel').addEventListener('click', async function () {
      rec.closing = true;
      clearInterval(rec.timer); clearInterval(rec.meter); clearInterval(rec.autoTimer);
      if (rec.active) { try { await Native.call('audio.cancel', {}); } catch (e) { /* ignore */ } }
      for (const s of rec.segments) { try { await Native.call('fs', { op: 'delete', path: s.path }); } catch (e) { /* ignore */ } }
      try { await Native.call('fs', { op: 'delete', path: 'audio/recording.part' }); } catch (e) { /* ignore */ }
      recorder = null;
      U.closeSheet();
      U.toast('已放弃这段录音');
    });

    document.getElementById('recDone').addEventListener('click', function () {
      saveRecording(true);
    });

    // 点遮罩 / 手势关闭 = 自动保存（和安卓一致）
    const mask = document.getElementById('mask');
    mask.addEventListener('click', function () {
      if (!recorder || recorder.closing) return;
      saveRecording(false);
    }, { once: true });

    startSegment().then(function () {
      hintEl.textContent = '录音中 · 每 ' + rec.chunk + ' 秒自动保存';
      btn.innerHTML = U.icon('stop');
    }).catch(function (e) {
      U.toast(e.message || '录音失败，请检查麦克风');
      hintEl.textContent = '麦克风不可用';
    });
  }

  async function saveRecording(closeSheet) {
    const rec = recorder;
    if (!rec) return;
    rec.closing = true;
    recorder = null;
    clearInterval(rec.timer); clearInterval(rec.meter); clearInterval(rec.autoTimer);
    if (rec.active) {
      rec.active = false;
      try {
        const r = await Native.call('audio.stop', {});
        if (r && r.path) rec.segments.push({ path: r.path, ms: r.ms || 0 });
      } catch (e) { /* ignore */ }
    }
    try { await Native.call('fs', { op: 'delete', path: 'audio/recording.part' }); } catch (e) { /* ignore */ }
    if (closeSheet) U.closeSheet();

    const segs = rec.segments.filter(function (s) { return s.ms >= 250; });
    if (!segs.length) {
      for (const s of rec.segments) { try { await Native.call('fs', { op: 'delete', path: s.path }); } catch (e) { /* ignore */ } }
      U.toast('录音太短了，再来一次');
      return;
    }
    const dur = Date.now() - rec.startedAt;
    const v = Store.addVoice({
      name: '语音 ' + U.fmtDateTime(Date.now()).replace('月', '-').replace('日', ''),
      path: segs.map(function (s) { return s.path; }).join('|'),
      dur: dur,
      folderId: state.folderId || 0
    });
    Store.flush();
    Store.log('语音保存 ' + v.name + ' ' + U.fmtDur(dur) + ' 段=' + segs.length);
    render();
    U.toast('已保存到语音备忘');
  }

  /* ------------------------------- 恢复 ------------------------------- */

  async function checkRecovery() {
    try {
      const r = await Native.call('fs', { op: 'read', path: 'audio/recording.part' });
      const info = JSON.parse(r.text);
      const segs = (info.segments || []).filter(function (s) { return s && s.path; });
      if (segs.length) {
        const dur = Date.now() - (info.started || Date.now());
        Store.addVoice({
          name: '恢复的录音 ' + U.dayLabel(info.started || Date.now()),
          path: segs.map(function (s) { return s.path; }).join('|'),
          dur: Math.max(1000, dur),
          folderId: 0
        });
        Store.flush();
        U.toast('发现上次没保存的录音，已帮你保存');
      }
      await Native.call('fs', { op: 'delete', path: 'audio/recording.part' });
    } catch (e) {
      // 没有标记文件是正常情况
    }
  }

  /* ------------------------------- 操作 ------------------------------- */

  function showVoiceSheet(id) {
    const v = Store.voiceById(id);
    if (!v) return;
    U.sheet({
      title: U.clampText(v.name, 16),
      items: [
        {
          icon: 'mic', label: '转文字', onTap: function () { transcribe(id); }
        },
        {
          icon: 'edit', label: '重命名', onTap: function () {
            U.prompt({
              title: '语音名称', value: v.name, maxlength: 30, okText: '保存'
            }).then(function (name) {
              if (!name) return;
              Store.updateVoice(id, { name: name });
              Store.flush();
              renderList();
              U.toast('已重命名');
            });
          }
        },
        {
          icon: 'folder', label: '移动到文件夹', onTap: function () { moveToFolder(id); }
        },
        {
          icon: 'trash', label: '删除语音', danger: true, onTap: function () {
            U.confirm({
              title: '删除语音', message: '删除这条语音？文件也会一起删掉。', okText: '删除', danger: true
            }).then(async function (ok) {
              if (!ok) return;
              if (player.voiceId === id) stop();
              const segs = Store.voiceFiles(v.path);
              for (const s of segs) { try { await Native.call('fs', { op: 'delete', path: s }); } catch (e) { /* ignore */ } }
              Store.removeVoice(id);
              Store.flush();
              render();
              U.toast('已删除');
            });
          }
        }
      ]
    });
  }

  function newFolder() {
    U.prompt({
      title: '新建文件夹', placeholder: '文件夹名称', maxlength: 10
    }).then(function (name) {
      if (!name) return;
      if (Store.folderNameExists(name, -1)) { U.toast('已有同名文件夹'); return; }
      Store.addVoiceFolder(name);
      Store.flush();
      render();
      U.toast('已新建文件夹');
    });
  }

  function folderSheet(id) {
    const f = Store.voiceFolders().filter(function (x) { return x.id === id; })[0];
    if (!f) return;
    U.sheet({
      title: f.name,
      items: [
        {
          icon: 'edit', label: '重命名', onTap: function () {
            U.prompt({ title: '重命名文件夹', value: f.name, maxlength: 10, okText: '保存' })
              .then(function (name) {
                if (!name) return;
                if (Store.folderNameExists(name, f.id)) { U.toast('已有同名文件夹'); return; }
                Store.renameVoiceFolder(f.id, name);
                Store.flush();
                render();
              });
          }
        },
        {
          icon: 'trash', label: '删除文件夹', danger: true, onTap: function () {
            U.confirm({
              title: '删除文件夹', message: '删除这个文件夹？里面的语音会变成未分类。',
              okText: '删除', danger: true
            }).then(function (ok) {
              if (!ok) return;
              Store.removeVoiceFolder(f.id);
              if (state.folderId === f.id) state.folderId = 0;
              Store.flush();
              render();
            });
          }
        }
      ]
    });
  }

  function moveToFolder(id) {
    const v = Store.voiceById(id);
    if (!v) return;
    const items = [{
      icon: 'folder', label: '未分类', check: !v.folderId, onTap: function () {
        Store.updateVoice(id, { folderId: 0 });
        Store.flush();
        render();
      }
    }];
    Store.voiceFolders().forEach(function (f) {
      items.push({
        icon: 'folder', label: f.name, check: v.folderId === f.id, onTap: function () {
          Store.updateVoice(id, { folderId: f.id });
          Store.flush();
          render();
        }
      });
    });
    items.push({
      icon: 'plus', label: '新建文件夹', onTap: function () {
        U.prompt({ title: '新建文件夹', placeholder: '文件夹名称', maxlength: 10 })
          .then(function (name) {
            if (!name) return;
            const f = Store.addVoiceFolder(name);
            Store.updateVoice(id, { folderId: f.id });
            Store.flush();
            render();
          });
      }
    });
    U.sheet({ title: '移动到文件夹', items: items });
  }

  /* ------------------------------- 转文字 ------------------------------- */

  async function transcribe(id) {
    const v = Store.voiceById(id);
    if (!v) return;
    if (!Api.hasKey()) { U.toast('还没填 API Key（设置 → 语音与识别）'); return; }
    const segs = Store.voiceFiles(v.path);
    if (!segs.length) { U.toast('语音文件丢失'); return; }

    U.toast('正在识别…');
    const miss = new Promise(function (r) { setTimeout(r, 120); });
    await miss;
    try {
      let wavPath = segs[0];
      if (segs.length > 1) {
        const merged = await Native.call('audio.merge', {
          paths: segs, out: 'audio/asr-' + Date.now() + '.wav', maxMs: 120000
        });
        wavPath = merged.path;
      }
      const text = await Api.asr(wavPath);
      Store.log('ASR 成功：' + text.slice(0, 40));
      showAsrResult(id, text);
    } catch (e) {
      Store.log('ASR 失败：' + (e.message || e));
      U.toast('识别失败：' + (e.message || ''));
    }
  }

  function showAsrResult(id, text) {
    const v = Store.voiceById(id);
    const body = document.createElement('div');
    body.innerHTML = '<div class="log-box" id="asrText" style="max-height:38vh;font-family:inherit;font-size:15px;line-height:1.6">' +
      U.esc(text) + '</div>' +
      '<div class="log-actions">' +
      '<button class="btn-line" id="asrCopy">复制</button>' +
      '<button class="btn-line primary" id="asrSave">存为备忘</button>' +
      '</div>';
    U.sheet({ title: '识别结果', body: body, cancel: true });
    document.getElementById('asrCopy').onclick = function () {
      U.copy(text).then(function () { U.toast('已复制'); });
    };
    document.getElementById('asrSave').onclick = function () {
      const n = Store.createNote(0);
      const firstLine = text.split(/[。！？\n]/)[0] || text;
      Store.updateNote(n.id, {
        title: U.clampText(firstLine, 24),
        body: '<div>' + U.esc(text).replace(/\n/g, '</div><div>') + '</div>'
      });
      Store.flush();
      U.closeSheet();
      U.toast('已存为备忘');
      if (window.Home) Home.render();
    };
  }

  return {
    init: init, render: render, onHide: onHide, checkRecovery: checkRecovery,
    openRecorder: openRecorder,
    isRecording: function () { return !!recorder; }
  };
})();
