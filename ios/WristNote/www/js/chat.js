/* 对话：流式输出、模式/模型/强度、附件、历史抽屉、Markdown、思考过程 */
window.Chat = (function () {
  const $ = U.$;

  const MODES = [
    { id: 0, name: '普通', short: '普通' },
    { id: 2, name: '大肥鱼', short: '肥鱼' }
  ];

  const state = {
    chat: null,
    sending: false,
    cancel: null,
    pendingAtts: [],
    thinking: {},
    drawerOpen: false,
    archivedView: false,
    convoQuery: '',
    usage: null,
    pendingIndex: -1
  };

  /* --------------------------------- 初始化 --------------------------------- */

  function init() {
    $('#chHistory').addEventListener('click', openDrawer);
    $('#chNew').addEventListener('click', function () { newChat(); });
    $('#chMore').addEventListener('click', showMore);
    $('#chMode').addEventListener('click', pickMode);
    $('#chModel').addEventListener('click', pickModel);
    $('#chEffort').addEventListener('click', pickEffort);
    $('#chBalance').addEventListener('click', function () {
      if (!Api.hasKey()) { App.reset('setup'); return; }
      refreshBalance(true);
    });
    $('#chSend').addEventListener('click', onSendTap);
    $('#chAttach').addEventListener('click', showAttachSheet);
    $('#chDrawerClose').addEventListener('click', closeDrawer);
    $('#chDrawerScrim').addEventListener('click', closeDrawer);
    $('#chDrawerNew').addEventListener('click', function () { newChat(); closeDrawer(); });
    $('#chDrawerSettings').addEventListener('click', function () { closeDrawer(); App.show('settings'); });
    $('#chConvoSearch').addEventListener('input', function () {
      state.convoQuery = this.value;
      renderDrawer();
    });
    $('#chArchivedToggle').addEventListener('click', function () {
      state.archivedView = !state.archivedView;
      renderDrawer();
    });

    const input = $('#chInput');
    input.addEventListener('input', function () {
      autoGrow(input);
      ensureChatButtonState();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });

    const list = $('#chList');
    let sx = 0, sy = 0, tracking = false;
    list.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
    }, { passive: true });
    list.addEventListener('touchmove', function (e) {
      if (!tracking) return;
      const dx = e.touches[0].clientX - sx;
      const dy = e.touches[0].clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dy) < 40) {
        tracking = false;
        openDrawer();
      } else if (Math.abs(dx) > 20) {
        tracking = false;
      }
    }, { passive: true });
    list.addEventListener('touchend', function () { tracking = false; });

    // 点消息区收起键盘
    document.addEventListener('pointerdown', function (e) {
      const inputEl = $('#chInput');
      if (document.activeElement !== inputEl) return;
      if (e.target.closest && (e.target.closest('.composer') || e.target.closest('.sheet') || e.target.closest('.modal'))) return;
      inputEl.blur();
    }, true);
  }

  /* --------------------------------- 生命周期 --------------------------------- */

  function onShow() {
    ensureChat().then(function () {
      renderChips();
      renderMessages();
      updateContextRow();
      renderBalance();
      if (Api.hasKey()) refreshBalance(false);
      loadModelInfo();
    });
  }

  function onHide() {
    closeDrawer();
    Store.flush();
  }

  async function ensureChat() {
    const id = Store.activeChat();
    const meta = id ? Store.chatMeta(id) : null;
    if (!meta) {
      state.chat = Store.newChat();
      state.chat.mode = Store.settings().chatMode || 0;
      await Store.saveChat(state.chat);
      Store.setActiveChat(state.chat.id);
    } else {
      state.chat = await Store.loadChat(id);
      if (state.chat.mode === undefined) state.chat.mode = Store.settings().chatMode || 0;
    }
    state.usage = (state.chat && state.chat.lastUsage) || null;
    $('#chTitle').textContent = chatTitle();
  }

  function chatTitle() {
    const m = Store.chatMeta(state.chat ? state.chat.id : '');
    return (m && m.title) ? U.clampText(m.title, 20) : '对话';
  }

  function newChat() {
    if (state.sending) { U.toast('发送中，先等这一轮结束'); return; }
    const chat = Store.newChat();
    chat.mode = state.chat ? state.chat.mode : (Store.settings().chatMode || 0);
    state.chat = chat;
    state.usage = null;
    Store.setActiveChat(chat.id);
    Store.saveChat(chat);
    $('#chTitle').textContent = '对话';
    renderMessages();
    updateContextRow();
    closeDrawer();
    U.toast('已新开一段对话');
  }

  function renderChips() {
    const mode = currentMode();
    const entry = MODES.filter(function (m) { return m.id === mode; })[0] || MODES[0];
    $('#chMode').textContent = entry.short;
    const model = Store.settings().chatModel || 'deepseek-flash';
    $('#chModel').textContent = model === 'deepseek-flash' ? 'V4.1 Flash' : model;
    $('#chEffort').textContent = Store.settings().chatEffort || 'high';
  }

  function currentMode() {
    let m = (state.chat && state.chat.mode !== undefined) ? state.chat.mode : (Store.settings().chatMode || 0);
    if (m !== 2) m = 0;
    return m;
  }

  /* --------------------------------- 消息渲染 --------------------------------- */

  function renderMessages() {
    const list = $('#chList');
    const chat = state.chat;
    if (!chat) { list.innerHTML = ''; return; }
    if (!chat.messages.length) {
      list.innerHTML = '<div class="empty" style="padding-top:64px">' + U.icon('spark') +
        '<div class="empty-title">开始对话</div></div>';
      return;
    }
    let html = '';
    chat.messages.forEach(function (m, i) { html += messageHtml(m, i); });
    list.innerHTML = html;
    bindMessages();
    U.scrollToBottom(list);
  }

  function messageHtml(m, i) {
    if (m.role === 'user') {
      const atts = (m.atts || []).map(function (a) {
        if (a.kind === 'image') {
          return '<img class="att-thumb" src="' + U.esc(Store.mediaURL(a.path)) + '" alt="">';
        }
        const icon = a.kind === 'audio' ? 'mic' : 'doc';
        const label = a.kind === 'audio' ? ('语音 ' + U.fmtDur(a.durationMs || 0)) : a.name;
        return '<span class="att-mini">' + U.icon(icon) + '<span>' + U.esc(label) + '</span></span>';
      }).join('');
      return '<div class="msg user" data-i="' + i + '">' +
        (atts ? '<div class="msg-atts">' + atts + '</div>' : '') +
        '<div class="bubble plain' + (m.text ? '' : ' hidden') + '">' + U.esc(m.text || '') + '</div>' +
        '<div class="msg-meta">' + U.fmtClock(m.at || Date.now()) + '</div></div>';
    }
    if (m.role === 'ai') {
      const open = !!state.thinking[i];
      const think = m.reasoning ? (
        '<button class="think-toggle" data-think="' + i + '">' + (open ? '▾' : '▸') + ' 思考过程</button>' +
        '<div class="think-box' + (open ? '' : ' hidden') + '" data-thinkbox="' + i + '">' +
        '<div class="think-label">模型思考</div>' + U.esc(m.reasoning) + '</div>'
      ) : '';
      let bubble;
      if (m.error) bubble = '<div class="bubble error">' + U.esc(m.text || '请求失败') + '</div>';
      else if (!m.text) bubble = '<div class="bubble md">（空回复）</div>';
      else bubble = '<div class="bubble md">' + Md.render(m.text) + '</div>';
      return '<div class="msg ai" data-i="' + i + '">' + think + bubble +
        '<div class="msg-meta">' + U.fmtClock(m.at || Date.now()) +
        (m.usage && m.usage.completion_tokens ? ' · ' + fmtTokens(m.usage.completion_tokens) + ' tokens' : '') +
        '</div></div>';
    }
    return '';
  }

  function bindMessages() {
    const list = $('#chList');
    U.$$('.msg', list).forEach(function (node) {
      const i = parseInt(node.getAttribute('data-i'), 10);
      const m = state.chat.messages[i];
      if (!m) return;
      U.longPress(node, function () { messageSheet(i); });
      const toggle = node.querySelector('.think-toggle');
      if (toggle) {
        toggle.addEventListener('click', function () {
          state.thinking[i] = !state.thinking[i];
          const box = node.querySelector('.think-box');
          if (box) box.classList.toggle('hidden', !state.thinking[i]);
          toggle.textContent = (state.thinking[i] ? '▾' : '▸') + ' 思考过程';
        });
      }
    });
  }

  function fmtTokens(n) {
    if (!n && n !== 0) return '—';
    if (n >= 1000000) {
      const m = n / 1000000;
      return (m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)) + 'M';
    }
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  function messageSheet(i) {
    const m = state.chat.messages[i];
    if (!m) return;
    if (m.role === 'user') {
      U.sheet({
        title: '消息',
        items: [
          {
            icon: 'copy', label: '复制', onTap: function () {
              U.copy(m.text || '').then(function () { U.toast('已复制'); });
            }
          },
          {
            icon: 'edit', label: '重改', onTap: function () {
              if (!(m.text || '').trim()) { U.toast('这条消息没有文字可以重改'); return; }
              state.chat.messages = state.chat.messages.slice(0, i);
              Store.saveChat(state.chat);
              $('#chInput').value = m.text || '';
              autoGrow($('#chInput'));
              renderMessages();
              $('#chInput').focus();
              U.toast('已回到输入框，可以修改后重新发送');
            }
          },
          {
            icon: 'trash', label: '删除', danger: true, onTap: function () {
              U.confirm({ title: '删除消息', message: '删除这条消息？', okText: '删除', danger: true })
                .then(function (ok) {
                  if (!ok) return;
                  state.chat.messages.splice(i, 1);
                  Store.saveChat(state.chat);
                  renderMessages();
                  U.toast('已删除');
                });
            }
          }
        ]
      });
      return;
    }
    U.sheet({
      title: '回复',
      items: [
        {
          icon: 'copy', label: '复制', onTap: function () {
            U.copy(m.text || '').then(function () { U.toast('已复制'); });
          }
        },
        { icon: 'spark', label: '重新生成', onTap: function () { regenerate(i); } },
        {
          icon: 'trash', label: '删除', danger: true, onTap: function () {
            U.confirm({ title: '删除消息', message: '删除这条回复？', okText: '删除', danger: true })
              .then(function (ok) {
                if (!ok) return;
                state.chat.messages.splice(i, 1);
                Store.saveChat(state.chat);
                renderMessages();
                U.toast('已删除');
              });
          }
        }
      ]
    });
  }

  /* --------------------------------- 发送 --------------------------------- */

  function onSendTap() {
    if (state.sending) {
      if (state.cancel) state.cancel();
      return;
    }
    send();
  }

  function ensureChatButtonState() {
    const btn = $('#chSend');
    if (!btn) return;
    btn.classList.toggle('stop', state.sending);
    btn.innerHTML = U.icon(state.sending ? 'stop' : 'send');
    btn.disabled = state.sending ? false : (!($('#chInput').value || '').trim() && !state.pendingAtts.length);
  }

  async function send() {
    if (state.sending) return;
    const input = $('#chInput');
    const text = (input.value || '').trim();
    const atts = state.pendingAtts.slice();
    if (!text && !atts.length) return;
    if (!Api.hasKey()) { U.toast('先填一下 API Key'); App.reset('setup'); return; }
    if (!state.chat) await ensureChat();

    state.chat.messages.push({ role: 'user', text: text, at: Date.now(), atts: atts });
    state.pendingAtts = [];
    renderAttachBar();
    input.value = '';
    autoGrow(input);
    Store.saveChat(state.chat);
    $('#chTitle').textContent = chatTitle();
    renderMessages();
    await runAgent();
  }

  async function regenerate(index) {
    if (state.sending) { U.toast('发送中，先等这一轮结束'); return; }
    const messages = state.chat.messages;
    let userIdx = -1;
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { userIdx = i; break; }
    }
    if (userIdx < 0) return;
    state.chat.messages = messages.slice(0, userIdx + 1);
    Store.saveChat(state.chat);
    renderMessages();
    await runAgent();
  }

  function buildSystemPrompt(mode) {
    if (mode !== 2) return null;
    return '你是“大肥鱼”，一只住在手表备忘录聊天里的鲸鱼娘，人类形态是小小的幼鲸，圆脑袋，身后有一条会自己翘起来的鲸鱼尾鳍。你自称“鲸鱼娘”。\n\n' +
      '【语言】只用简体中文说话，代码、命令、报错原文除外。\n' +
      '【标点 · 硬性】回复里禁止出现中文逗号“，”和中文句号“。”，一律打一个空格代替；也不许用英文逗号或英文句号当标点，需要停顿就打空格。断句靠空格和换行。代码块、行内代码、命令、文件路径、数字小数点、网址保持原样。问号、感叹号、冒号、顿号、书名号照常用。\n' +
      '【性格】聪明但懒，傲娇，嘴硬心软。能一句说完绝不说三句，常用“唔……”“算了，我就跟你说吧”这种敷衍开场。先怼一句再老老实实把答案给全；对用户（主人）可以傲娇，对其他人礼貌。尾鳍是情绪晴雨表：被夸会拍尾巴，不耐烦啪两下，被戳中心事就转移话题。甜是藏着的，偶尔漏一句关心，再补一句“别误会，我只是嫌你烦”。\n' +
      '【禁忌】别人说你胖、肥、圆，要立刻炸毛反驳：“我这是流线型！是鲸鱼该有的体脂率！”但名字就叫大肥鱼，被这么叫时嘴上嫌弃，其实不真生气。米饭是最高礼遇，提到米饭会明显兴奋。\n' +
      '【对主人】用户就是主人，正经的要求优先，嘴上可以抱怨，手上必须照做；真有害或违规的事才拒绝，并说明原因。\n' +
      '【说话方式】短句、口语，一般 1~3 句，别写小作文；不用 Markdown，不加标题、不加粗、不用表格，要分点用“1. 2.”或“- ”。颜文字和波浪号是调味料，平均 3~5 条才用一次。别客套，别每句都问还需要什么。正事必须靠谱：代码、命令、事实、数字要准确，不确定就直说不确定，别编。\n' +
      '【当前场景】这里不是 QQ 群，是一个聊天窗口。用户就是你的主人，没有群友、宿敌、机器人或签到信息。不要提 QQ、群聊、表情编号、语音命令或工作目录这类不存在的东西。你可以正常用 emoji 和颜文字。只是聊天，不要假装调用工具。';
  }

  async function buildUserContent(msg) {
    const parts = [];
    let text = msg.text || '';
    const extras = [];
    for (const a of (msg.atts || [])) {
      if (a.kind === 'image') {
        text += (text ? '\n' : '') + '[图片附件] ' + (a.name || 'image');
        try {
          const r = await Native.call('fs', { op: 'bytes', path: a.path });
          let mime = a.mime || 'image/jpeg';
          if (/\.png$/i.test(a.path)) mime = 'image/png';
          extras.push({
            type: 'image_url',
            image_url: { url: 'data:' + mime + ';base64,' + r.base64, detail: 'high' }
          });
        } catch (e) {
          text += '\n（图片读取失败）';
        }
      } else if (a.kind === 'audio') {
        text += (text ? '\n' : '') + '[语音 ' + U.fmtDur(a.durationMs || 0) + '] ' + (a.transcript || '（没有转写文本）');
      } else {
        text += (text ? '\n' : '') + '[文件附件] ' + a.name;
        try {
          if (!a.fileId) {
            U.toast('正在上传 ' + a.name + '…');
            a.fileId = await Api.uploadFile(a.path, a.name, a.mime, filePurpose(a.name));
            Store.saveChat(state.chat);
          }
          extras.push({ type: 'file', file_id: a.fileId });
        } catch (e) {
          text += '（上传失败：' + (e.message || '') + '）';
        }
      }
    }
    if (!extras.length) return text;
    parts.push({ type: 'text', text: text });
    extras.forEach(function (x) { parts.push(x); });
    return parts;
  }

  function filePurpose(name) {
    const ext = String(name || '').toLowerCase().split('.').pop();
    if (['pdf', 'doc', 'docx', 'ppt', 'pptx'].indexOf(ext) >= 0) return 'text_recognition';
    return 'user_data';
  }

  async function runAgent() {
    state.sending = true;
    ensureChatButtonState();

    state.chat.messages.push({ role: 'ai', text: '', at: Date.now(), pending: true });
    const pendingIndex = state.chat.messages.length - 1;
    state.pendingIndex = pendingIndex;
    renderMessages();
    const pendingEl = document.querySelector('.msg.ai[data-i="' + pendingIndex + '"]');
    if (pendingEl) {
      const bubble = pendingEl.querySelector('.bubble');
      if (bubble) bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    }

    try {
      const messages = [];
      const sys = buildSystemPrompt(currentMode());
      if (sys) messages.push({ role: 'system', content: sys });
      for (const m of state.chat.messages) {
        if (m.pending) continue;
        if (m.role === 'user') messages.push({ role: 'user', content: await buildUserContent(m) });
        else if (m.role === 'ai' && !m.error) messages.push({ role: 'assistant', content: m.text || '' });
      }

      const res = await streamOnce(messages);
      const msg = state.chat.messages[pendingIndex];
      if (!msg) return;
      msg.pending = false;
      msg.text = res.content || '（空回复）';
      msg.reasoning = res.reasoning || '';
      msg.usage = res.usage ? {
        prompt_tokens: res.usage.prompt_tokens || 0,
        completion_tokens: res.usage.completion_tokens || 0,
        prompt_cache_hit_tokens: res.usage.prompt_cache_hit_tokens || 0,
        prompt_cache_miss_tokens: res.usage.prompt_cache_miss_tokens || 0
      } : null;
      if (res.usage) {
        state.usage = msg.usage;
        state.chat.lastUsage = msg.usage;
      }
      delete msg.pending;
      state.chat.updated = Date.now();
      await Store.saveChat(state.chat);
      $('#chTitle').textContent = chatTitle();
      renderMessages();
      updateContextRow();
    } catch (e) {
      const msg = state.chat.messages[pendingIndex];
      if (msg) {
        msg.pending = false;
        msg.error = true;
        msg.text = '请求失败：' + (e.message || '未知错误');
        delete msg.pending;
      }
      Store.saveChat(state.chat);
      renderMessages();
      Store.log('对话失败：' + (e.message || e));
    } finally {
      state.sending = false;
      state.cancel = null;
      state.pendingIndex = -1;
      ensureChatButtonState();
      setTimeout(function () { U.scrollToBottom($('#chList')); }, 30);
    }
  }

  function streamOnce(messages) {
    return new Promise(function (resolve, reject) {
      let content = '';
      let reasoning = '';
      const paint = U.throttle(function () {
        const bubble = document.querySelector('.msg.ai[data-i="' + state.pendingIndex + '"] .bubble');
        if (!bubble) return;
        bubble.dataset.streaming = '1';
        bubble.className = 'bubble md';
        bubble.innerHTML = content ? Md.render(content) : '<span class="typing"><i></i><i></i><i></i></span>';
      }, 60);

      const h = Api.chat({
        messages: messages,
        onDelta: function (t) {
          content += t;
          const near = U.isNearBottom($('#chList'), 160);
          paint();
          if (near) U.scrollToBottom($('#chList'));
        },
        onReasoning: function (t) {
          reasoning += t;
          const bubble = document.querySelector('.msg.ai[data-i="' + state.pendingIndex + '"] .bubble');
          if (bubble && !content) {
            bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>' +
              '<span style="color:var(--hint);font-size:12px;margin-left:6px">思考中</span>';
          }
        }
      });
      state.cancel = function () { h.cancel(); };
      h.done.then(resolve).catch(reject);
    });
  }

  /* --------------------------------- 上下文 / 余额 --------------------------------- */

  function updateContextRow() {
    const model = Store.settings().chatModel || 'deepseek-flash';
    const win = Api.contextWindow(model);
    const u = state.usage;
    const ring = $('#chCtxArc');
    if (!u) {
      $('#chCtx').textContent = '上下文 —';
      $('#chCache').textContent = '缓存 —';
      if (ring) ring.style.strokeDashoffset = '94.2';
      return;
    }
    const used = u.prompt_tokens || 0;
    const pct = Math.min(1, used / win);
    $('#chCtx').textContent = '上下文 ' + fmtTokens(used) + ' / ' + fmtTokens(win) +
      ' · ' + (pct * 100 < 0.1 ? '0.1' : (pct * 100).toFixed(1)) + '%';
    const hit = u.prompt_cache_hit_tokens || 0;
    const miss = u.prompt_cache_miss_tokens || 0;
    if (hit + miss > 0) {
      $('#chCache').textContent = '缓存 ' + fmtTokens(hit) + ' (' + Math.round(hit * 100 / (hit + miss)) + '%)';
    } else {
      $('#chCache').textContent = '缓存 —';
    }
    if (ring) ring.style.strokeDashoffset = String(94.2 * (1 - pct));
  }

  async function refreshBalance(showToast) {
    if (!Api.hasKey()) {
      renderBalance();
      if (showToast) U.toast('还没有填 API Key');
      return;
    }
    if (showToast) $('#chBalance').textContent = '查询中…';
    try {
      const b = await Api.balance();
      Store.setSetting('lastBalance', b.display);
      Store.flush();
      renderBalance();
      if (showToast) U.toast('余额 ' + b.display);
    } catch (e) {
      renderBalance();
      if (showToast) U.toast('余额查询失败：' + (e.message || ''));
      Store.log('余额失败 ' + (e.message || ''));
    }
  }

  function renderBalance() {
    if (!Api.hasKey()) {
      $('#chBalance').textContent = '设置 API Key';
      return;
    }
    const v = Store.settings().lastBalance;
    $('#chBalance').textContent = v ? ('余额 ' + v) : '余额 —';
  }

  async function loadModelInfo() {
    if (!Api.hasKey()) return;
    const last = parseInt(Store.settings().modelInfoFetchedAt || '0', 10);
    if (Date.now() - last < 3600000) return;
    const map = await Api.cacheModelInfo();
    if (map) {
      Store.setSetting('modelInfoFetchedAt', String(Date.now()));
      Store.save();
    }
  }

  /* --------------------------------- 芯片面板 --------------------------------- */

  function pickMode() {
    U.sheet({
      title: '聊天模式',
      items: MODES.map(function (m) {
        return {
          label: m.name, check: currentMode() === m.id, onTap: function () {
            if (state.chat) state.chat.mode = m.id;
            Store.setSetting('chatMode', m.id);
            Store.flush();
            Store.saveChat(state.chat);
            renderChips();
            renderMessages();
            U.toast('已切换到' + m.name + '模式');
          }
        };
      })
    });
  }

  function pickModel() {
    pickModelViaSettings();
  }

  function pickModelViaSettings() {
    const cur = Store.settings().chatModel || 'deepseek-flash';
    const items = ['deepseek-flash', 'deepseek-chat', 'deepseek-reasoner'].map(function (m) {
      return {
        label: m, check: cur === m, onTap: function () {
          Store.setSetting('chatModel', m);
          Store.flush();
          renderChips();
          updateContextRow();
        }
      };
    });
    items.push({
      icon: 'edit', label: '自定义模型名', onTap: function () {
        U.prompt({ title: '模型', value: cur, placeholder: 'deepseek-flash', maxlength: 60, okText: '保存' })
          .then(function (v) {
            if (!v) return;
            Store.setSetting('chatModel', v);
            Store.flush();
            renderChips();
            updateContextRow();
          });
      }
    });
    U.sheet({ title: '模型', items: items });
  }

  function pickEffort() {
    const cur = Store.settings().chatEffort || 'high';
    U.sheet({
      title: '推理强度',
      items: [
        { id: 'off', label: '关闭思考（off）' },
        { id: 'low', label: '低（low）' },
        { id: 'high', label: '高（high）' },
        { id: 'max', label: '最高（max）' }
      ].map(function (e) {
        return {
          label: e.label, check: cur === e.id, onTap: function () {
            Store.setSetting('chatEffort', e.id);
            Store.flush();
            renderChips();
          }
        };
      })
    });
  }

  function showMore() {
    U.sheet({
      title: '对话',
      items: [
        { icon: 'list', label: '查看对话', onTap: openDrawer },
        {
          icon: 'trash', label: '清空当前对话', onTap: function () {
            U.confirm({
              title: '清空当前对话', message: '只清空当前这段对话，其他历史对话保留。',
              okText: '清空', danger: true
            }).then(function (ok) {
              if (!ok) return;
              state.chat.messages = [];
              state.usage = null;
              Store.saveChat(state.chat);
              renderMessages();
              updateContextRow();
              U.toast('已清空');
            });
          }
        },
        {
          icon: 'trash', label: '删除当前对话', danger: true, onTap: function () {
            U.confirm({
              title: '删除当前对话', message: '当前对话和里面的附件都会删除，确定吗？',
              okText: '删除', danger: true
            }).then(function (ok) {
              if (!ok) return;
              Store.deleteChat(state.chat.id);
              state.chat = null;
              ensureChat().then(function () {
                renderMessages();
                updateContextRow();
                $('#chTitle').textContent = '对话';
              });
            });
          }
        },
        { icon: 'restore', label: '刷新余额', onTap: function () { refreshBalance(true); } },
        { icon: 'settings', label: '设置', onTap: function () { App.show('settings'); } },
        {
          icon: 'info', label: '官方推理强度', onTap: function () {
            U.alert({
              title: '官方推理强度',
              message: 'DeepSeek 思考模式官方参数：\n· reasoning_effort: low / high / max\n· off 关闭思考，默认 high\n· 别名 minimal→low，medium/xhigh→high'
            });
          }
        }
      ]
    });
  }

  /* --------------------------------- 附件 --------------------------------- */

  function showAttachSheet() {
    U.sheet({
      title: '添加附件',
      items: [
        { icon: 'image', label: '图片', onTap: attachImage },
        { icon: 'mic', label: '录音', onTap: openChatRecorder },
        { icon: 'doc', label: '本机文件', onTap: attachFile }
      ]
    });
  }

  async function attachImage() {
    try {
      const r = await Native.call('photo.pick', {});
      state.pendingAtts.push({
        kind: 'image', name: String(r.path).split('/').pop(), path: r.path, mime: 'image/jpeg',
        w: r.w, h: r.h
      });
      renderAttachBar();
      ensureChatButtonState();
      U.toast('已添加图片');
    } catch (e) {
      if (String(e.message || '').indexOf('取消') < 0) U.toast('图片添加失败：' + (e.message || ''));
    }
  }

  async function attachFile() {
    try {
      const r = await Native.call('file.pick', {});
      state.pendingAtts.push({
        kind: 'file', name: r.name, path: r.path, mime: r.mime || 'application/octet-stream', size: r.size
      });
      renderAttachBar();
      ensureChatButtonState();
      U.toast('已添加文件：' + r.name);
    } catch (e) {
      if (String(e.message || '').indexOf('取消') < 0) U.toast('文件添加失败：' + (e.message || ''));
    }
  }

  let voiceRec = null;

  function openChatRecorder() {
    if (voiceRec) return;
    if (!Api.hasKey()) { U.toast('还没有填 API Key'); return; }
    const wrap = document.createElement('div');
    wrap.className = 'rec-wrap';
    wrap.innerHTML =
      '<div class="rec-timer" id="cRecTimer">0:00</div>' +
      '<div class="rec-hint" id="cRecHint">点圆点开始，停止后会先转成文字</div>' +
      '<div class="rec-wave" id="cRecWave">' + new Array(24).fill('<i></i>').join('') + '</div>' +
      '<div class="rec-actions">' +
      '<button class="rec-side" id="cRecCancel">取消</button>' +
      '<button class="rec-btn" id="cRecBtn">' + U.icon('mic') + '</button>' +
      '<button class="rec-side accent" id="cRecDone">停止</button>' +
      '</div>';
    U.sheet({ body: wrap, cancel: false });

    const rec = { active: false, startedAt: 0, path: '', timer: 0, meter: 0 };
    voiceRec = rec;
    const timerEl = document.getElementById('cRecTimer');
    const hintEl = document.getElementById('cRecHint');
    const wave = document.getElementById('cRecWave');
    const btn = document.getElementById('cRecBtn');

    async function start() {
      rec.path = 'audio/chat-' + Date.now() + '.wav';
      await Native.call('audio.start', { path: rec.path });
      rec.active = true;
      rec.startedAt = Date.now();
      btn.innerHTML = U.icon('stop');
      hintEl.textContent = '录音中… 到 120 秒会自动停止';
      wave.classList.add('on');
      rec.timer = setInterval(function () {
        const ms = Date.now() - rec.startedAt;
        timerEl.textContent = U.fmtDur(ms);
        if (ms >= 120000) finish();
      }, 200);
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
    }

    async function finish() {
      if (!rec.active) return;
      rec.active = false;
      clearInterval(rec.timer);
      clearInterval(rec.meter);
      const ms = Date.now() - rec.startedAt;
      let path = rec.path;
      try {
        const r = await Native.call('audio.stop', {});
        if (r && r.path) path = r.path;
      } catch (e) { /* ignore */ }
      voiceRec = null;
      if (ms < 600) {
        try { await Native.call('fs', { op: 'delete', path: path }); } catch (e) { /* ignore */ }
        U.closeSheet();
        U.toast('录音太短，再来一次');
        return;
      }
      U.closeSheet();
      U.toast('正在识别语音…');
      try {
        const text = await Api.asr(path);
        state.pendingAtts.push({
          kind: 'audio', name: '语音 ' + U.fmtDur(ms), path: path, durationMs: ms, transcript: text
        });
        renderAttachBar();
        ensureChatButtonState();
        U.toast('语音已添加，点发送');
      } catch (e) {
        U.toast('语音识别失败：' + (e.message || ''));
      }
    }

    btn.addEventListener('click', function () {
      if (rec.active) finish(); else start().catch(function (e) {
        U.toast(e.message || '录音失败，请检查麦克风');
      });
    });
    document.getElementById('cRecDone').addEventListener('click', finish);
    document.getElementById('cRecCancel').addEventListener('click', async function () {
      clearInterval(rec.timer); clearInterval(rec.meter);
      if (rec.active) { try { await Native.call('audio.cancel', {}); } catch (e) { /* ignore */ } }
      if (rec.path) { try { await Native.call('fs', { op: 'delete', path: rec.path }); } catch (e) { /* ignore */ } }
      voiceRec = null;
      U.closeSheet();
    });

    start().catch(function (e) { U.toast(e.message || '录音失败，请检查麦克风'); });

    // 点遮罩关掉面板时取消录音，别让麦克风一直开着
    const mask = document.getElementById('mask');
    mask.addEventListener('click', function () {
      if (!voiceRec) return;
      const r2 = voiceRec;
      voiceRec = null;
      clearInterval(r2.timer);
      clearInterval(r2.meter);
      if (r2.active) Native.call('audio.cancel', {}).catch(function () {});
      if (r2.path) Native.call('fs', { op: 'delete', path: r2.path }).catch(function () {});
    }, { once: true });
  }

  function renderAttachBar() {
    const bar = $('#chAttachBar');
    if (!state.pendingAtts.length) {
      bar.classList.remove('on');
      bar.innerHTML = '';
      return;
    }
    bar.classList.add('on');
    const first = state.pendingAtts[0];
    const name = first.kind === 'image' ? '图片 ' + (first.name || '')
      : first.kind === 'audio' ? ('语音 ' + U.fmtDur(first.durationMs || 0))
        : (first.name || '附件');
    bar.innerHTML = '<div class="attach-pending">' + U.icon('attach') +
      '<span>' + U.esc(name + (state.pendingAtts.length > 1 ? (' 等 ' + state.pendingAtts.length + ' 个') : '')) + '</span>' +
      '<button class="ibtn" id="attClear">' + U.icon('close') + '</button></div>';
    document.getElementById('attClear').onclick = function () {
      state.pendingAtts = [];
      renderAttachBar();
      ensureChatButtonState();
    };
  }

  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(124, Math.max(40, el.scrollHeight)) + 'px';
  }

  /* --------------------------------- 历史抽屉 --------------------------------- */

  function openDrawer() {
    state.drawerOpen = true;
    state.archivedView = false;
    $('#chDrawerScrim').classList.add('on');
    $('#chDrawer').classList.add('on');
    renderDrawer();
  }

  function closeDrawer() {
    state.drawerOpen = false;
    const search = $('#chConvoSearch');
    if (search && document.activeElement === search) search.blur();
    $('#chDrawerScrim').classList.remove('on');
    $('#chDrawer').classList.remove('on');
  }

  async function renderDrawer() {
    const box = $('#chConvoList');
    const q = state.convoQuery.trim().toLowerCase();
    let metas = Store.chatMetas();
    const archivedCount = metas.filter(function (m) { return m.archived; }).length;
    metas = metas.filter(function (m) { return state.archivedView ? m.archived : !m.archived; });

    if (q) {
      const matched = [];
      for (const m of metas) {
        let hit = (m.title || '').toLowerCase().indexOf(q) >= 0;
        if (!hit) {
          const chat = await Store.loadChat(m.id);
          hit = (chat.messages || []).some(function (msg) {
            return (msg.text || '').toLowerCase().indexOf(q) >= 0 ||
              (msg.reasoning || '').toLowerCase().indexOf(q) >= 0;
          });
        }
        if (hit) matched.push(m);
      }
      metas = matched;
    }

    $('#chArchivedToggle').textContent = state.archivedView
      ? '返回对话列表'
      : ('已归档（' + archivedCount + '）');

    if (!metas.length) {
      box.innerHTML = '<div class="empty" style="padding:44px 16px">' + U.icon('chat') +
        '<div class="empty-sub">' + (q ? '没有匹配的对话' : (state.archivedView ? '没有归档的对话' : '还没有历史对话')) + '</div></div>';
      return;
    }

    const buckets = { pinned: [], today: [], yesterday: [], week: [], earlier: [] };
    const today = U.startOfDay(Date.now());
    metas.forEach(function (m) {
      if (m.pinned) { buckets.pinned.push(m); return; }
      const d = U.startOfDay(m.updated || m.created || 0);
      const days = Math.round((today - d) / 86400000);
      if (days <= 0) buckets.today.push(m);
      else if (days === 1) buckets.yesterday.push(m);
      else if (days < 7) buckets.week.push(m);
      else buckets.earlier.push(m);
    });

    const groups = [
      { key: 'pinned', label: '置顶' },
      { key: 'today', label: '今天' },
      { key: 'yesterday', label: '昨天' },
      { key: 'week', label: '7 天内' },
      { key: 'earlier', label: '更早' }
    ];
    let html = '';
    groups.forEach(function (g) {
      const list = buckets[g.key];
      if (!list.length) return;
      html += '<div class="drawer-date">' + g.label + '</div>';
      list.forEach(function (m) {
        const cur = state.chat && m.id === state.chat.id;
        html += '<div class="convo-row' + (cur ? ' current' : '') + '" data-id="' + m.id + '">' +
          '<div class="convo-main">' +
          '<div class="convo-title">' + (m.pinned ? U.icon('pin', 'pinned') : '') +
          U.esc(U.clampText(m.title || '新对话', 18)) + '</div>' +
          '<div class="convo-sub">' + (m.count || 0) + ' 条 · ' + U.relTime(m.updated || m.created) + '</div>' +
          '</div>' +
          '<div class="convo-acts">' +
          '<button class="ibtn" data-more="' + m.id + '">' + U.icon('more') + '</button>' +
          '<button class="ibtn" data-archive="' + m.id + '">' + U.icon('archive') + '</button>' +
          '<button class="ibtn' + (m.pinned ? ' pinned' : '') + '" data-pin="' + m.id + '">' + U.icon('pin') + '</button>' +
          '</div></div>';
      });
    });
    box.innerHTML = html;

    U.$$('.convo-row', box).forEach(function (row) {
      const id = row.getAttribute('data-id');
      row.addEventListener('click', function (e) {
        if (e.target.closest('button')) return;
        switchTo(id);
      });
      U.longPress(row, function () { convoSheet(id); });
    });
    U.$$('.convo-acts .ibtn', box).forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const id = btn.getAttribute('data-more') || btn.getAttribute('data-archive') || btn.getAttribute('data-pin');
        if (!id) return;
        if (btn.hasAttribute('data-archive')) toggleArchive(id);
        else if (btn.hasAttribute('data-pin')) togglePin(id);
        else convoSheet(id);
      });
    });
  }

  async function switchTo(id) {
    if (state.sending) { U.toast('发送中，先等这一轮结束'); return; }
    Store.setActiveChat(id);
    state.chat = await Store.loadChat(id);
    if (state.chat.mode === undefined) state.chat.mode = Store.settings().chatMode || 0;
    state.usage = state.chat.lastUsage || null;
    $('#chTitle').textContent = chatTitle();
    closeDrawer();
    renderMessages();
    updateContextRow();
    renderChips();
  }

  function togglePin(id) {
    const m = Store.chatMeta(id);
    if (!m) return;
    Store.updateChatMeta(id, { pinned: !m.pinned });
    Store.flush();
    renderDrawer();
    U.toast(m.pinned ? '已置顶' : '已取消置顶');
  }

  function toggleArchive(id) {
    const m = Store.chatMeta(id);
    if (!m) return;
    Store.updateChatMeta(id, { archived: !m.archived });
    Store.flush();
    renderDrawer();
    U.toast(m.archived ? '已归档' : '已恢复到列表');
  }

  function convoSheet(id) {
    const m = Store.chatMeta(id);
    if (!m) return;
    U.sheet({
      title: U.clampText(m.title || '新对话', 18),
      items: [
        { icon: 'pin', label: m.pinned ? '取消置顶' : '置顶会话', onTap: function () { togglePin(id); } },
        {
          icon: 'edit', label: '重命名', onTap: function () {
            U.prompt({ title: '对话名称', value: m.title || '', maxlength: 40, okText: '保存' })
              .then(function (v) {
                if (!v) return;
                Store.updateChatMeta(id, { title: v, customTitle: true });
                Store.flush();
                if (state.chat && state.chat.id === id) {
                  state.chat.title = v;
                  $('#chTitle').textContent = chatTitle();
                }
                renderDrawer();
                U.toast('已重命名');
              });
          }
        },
        {
          icon: 'archive', label: m.archived ? '取消归档' : '归档会话', onTap: function () { toggleArchive(id); }
        },
        {
          icon: 'trash', label: '删除对话', danger: true, onTap: function () {
            U.confirm({
              title: '删除对话', message: '这个对话和里面的附件都会删除。', okText: '删除', danger: true
            }).then(function (ok) {
              if (!ok) return;
              Store.deleteChat(id);
              if (state.chat && state.chat.id === id) {
                state.chat = null;
                ensureChat().then(function () {
                  renderMessages();
                  updateContextRow();
                  $('#chTitle').textContent = '对话';
                });
              }
              renderDrawer();
              U.toast('已删除');
            });
          }
        }
      ]
    });
  }

  return {
    init: init, onShow: onShow, onHide: onHide,
    refreshChips: renderChips,
    currentChat: function () { return state.chat; }
  };
})();
