/* 对话：三种模式、流式输出、工具调用、附件、历史抽屉、Markdown 与思考过程 */
window.Chat = (function () {
  const $ = U.$;

  const MODES = [
    { id: 0, name: '普通', short: '普通', desc: '纯 DeepSeek V4.1 Flash，不加人设' },
    { id: 1, name: '备忘助手', short: '助手', desc: '读写备忘录、修改应用设置，不再限制字数' },
    { id: 2, name: '大肥鱼', short: '肥鱼', desc: '大肥鱼人设，短句傲娇，不接工具' }
  ];

  const EFFORTS = [
    { id: 'off', label: '关闭思考（off）', desc: '只发 thinking:disabled，不发送推理强度' },
    { id: 'low', label: '低（low）', desc: '省 token，简单问答够用' },
    { id: 'high', label: '高（high）', desc: '官方默认，适合大多数问题' },
    { id: 'max', label: '最高（max）', desc: '复杂推理，慢但更稳' }
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

  const snap = { listEl: null };

  /* --------------------------------- 初始化 --------------------------------- */

  function init() {
    $('#chBack').addEventListener('click', function () { App.back('home'); });
    $('#chNew').addEventListener('click', function () { newChat(); });
    $('#chMore').addEventListener('click', showMore);
    $('#chMode').addEventListener('click', pickMode);
    $('#chModel').addEventListener('click', pickModel);
    $('#chEffort').addEventListener('click', pickEffort);
    $('#chBalance').addEventListener('click', function () { refreshBalance(true); });
    $('#chSend').addEventListener('click', onSendTap);
    $('#chAttach').addEventListener('click', showAttachSheet);
    $('#chDrawerClose').addEventListener('click', closeDrawer);
    $('#chDrawerScrim').addEventListener('click', closeDrawer);
    $('#chDrawerNew').addEventListener('click', function () { newChat(); closeDrawer(); });
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
      $('#chSend').disabled = !input.value.trim() && !state.pendingAtts.length && !state.sending;
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
    // 左滑消息区打开历史抽屉
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
      const input = $('#chInput');
      if (document.activeElement !== input) return;
      if (e.target.closest && (e.target.closest('.composer') || e.target.closest('.sheet') || e.target.closest('.modal'))) return;
      input.blur();
    }, true);
  }

  /* --------------------------------- 生命周期 --------------------------------- */

  async function open() {
    App.show('chat');
  }

  async function onShow() {
    ensureChatButtonState();
    renderChips();
    await ensureChat();
    renderMessages();
    updateContextRow();
    renderBalance();
    if (Api.hasKey()) refreshBalance(false);
    loadModelInfo();
  }

  function onHide() {
    closeDrawer();
    Store.flush();
  }

  async function ensureChat() {
    const id = Store.activeChat();
    let meta = id ? Store.chatMeta(id) : null;
    if (!meta) {
      state.chat = Store.newChat();
      state.chat.mode = Store.settings().chatMode || 0;
      await Store.saveChat(state.chat);
      Store.setActiveChat(state.chat.id);
    } else {
      state.chat = await Store.loadChat(id);
      if (state.chat.mode === undefined) state.chat.mode = Store.settings().chatMode || 0;
    }
    state.usage = null;
    if (state.chat && state.chat.lastUsage) state.usage = state.chat.lastUsage;
    $('#chTitle').textContent = (State_title());
  }

  function State_title() {
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
    $('#chMode').textContent = MODES[mode].short;
    const model = Store.settings().chatModel || 'deepseek-flash';
    $('#chModel').textContent = model === 'deepseek-flash' ? 'V4.1 Flash' : model;
    const effort = Store.settings().chatEffort || 'high';
    $('#chEffort').textContent = effort;
  }

  function currentMode() {
    if (state.chat && state.chat.mode !== undefined) return state.chat.mode;
    return Store.settings().chatMode || 0;
  }

  /* --------------------------------- 消息渲染 --------------------------------- */

  function renderMessages() {
    const list = $('#chList');
    const chat = state.chat;
    if (!chat) { list.innerHTML = ''; return; }
    if (!chat.messages.length) {
      list.innerHTML = '<div class="empty" style="padding-top:56px">' + U.icon('spark') +
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
      if (m.error) {
        bubble = '<div class="bubble error">' + U.esc(m.text || '请求失败') + '</div>';
      } else if (!m.text) {
        bubble = '<div class="bubble md">（空回复）</div>';
      } else {
        bubble = '<div class="bubble md">' + Md.render(m.text) + '</div>';
      }
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
        {
          icon: 'spark', label: '重改', onTap: function () {
            regenerate(i);
          }
        },
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
    if (!Api.hasKey()) {
      U.toast('还没有填 API Key（设置 → 语音与识别）');
      return;
    }
    if (!state.chat) await ensureChat();

    const msg = { role: 'user', text: text, at: Date.now(), atts: atts };
    state.chat.messages.push(msg);
    state.pendingAtts = [];
    renderAttachBar();
    input.value = '';
    autoGrow(input);
    Store.saveChat(state.chat);
    $('#chTitle').textContent = State_title();
    renderMessages();
    await runAgent();
  }

  async function regenerate(index) {
    if (state.sending) { U.toast('发送中，先等这一轮结束'); return; }
    const messages = state.chat.messages;
    // 找到这条 AI 回复前面最近的用户消息
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
    if (mode === 0) return null;
    if (mode === 2) {
      return '你是“大肥鱼”，一只住在手表备忘录聊天里的鲸鱼娘，人类形态是小小的幼鲸，圆脑袋，身后有一条会自己翘起来的鲸鱼尾鳍。你自称“鲸鱼娘”。\n\n' +
        '【语言】只用简体中文说话，代码、命令、报错原文除外。\n' +
        '【标点 · 硬性】回复里禁止出现中文逗号“，”和中文句号“。”，一律打一个空格代替；也不许用英文逗号或英文句号当标点，需要停顿就打空格。断句靠空格和换行。代码块、行内代码、命令、文件路径、数字小数点、网址保持原样。问号、感叹号、冒号、顿号、书名号照常用。\n' +
        '【性格】聪明但懒，傲娇，嘴硬心软。能一句说完绝不说三句，常用“唔……”“算了，我就跟你说吧”这种敷衍开场。先怼一句再老老实实把答案给全；对用户（主人）可以傲娇，对其他人礼貌。尾鳍是情绪晴雨表：被夸会拍尾巴，不耐烦啪两下，被戳中心事就转移话题。甜是藏着的，偶尔漏一句关心，再补一句“别误会，我只是嫌你烦”。\n' +
        '【禁忌】别人说你胖、肥、圆，要立刻炸毛反驳：“我这是流线型！是鲸鱼该有的体脂率！”但名字就叫大肥鱼，被这么叫时嘴上嫌弃，其实不真生气。米饭是最高礼遇，提到米饭会明显兴奋。\n' +
        '【对主人】用户就是主人，正经的要求优先，嘴上可以抱怨，手上必须照做；真有害或违规的事才拒绝，并说明原因。\n' +
        '【说话方式】短句、口语，一般 1~3 句，别写小作文；不用 Markdown，不加标题、不加粗、不用表格，要分点用“1. 2.”或“- ”。颜文字和波浪号是调味料，平均 3~5 条才用一次。别客套，别每句都问还需要什么。正事必须靠谱：代码、命令、事实、数字要准确，不确定就直说不确定，别编。\n' +
        '【当前场景】这里不是 QQ 群，是手表备忘录的聊天窗口。用户就是你的主人，没有群友、宿敌、机器人或签到信息。不要提 QQ、群聊、表情编号、语音命令或工作目录这类不存在的东西。你可以正常用 emoji 和颜文字。只是聊天，不要假装调用工具，也不要主动清空或修改备忘录。';
    }
    return '你是手表备忘录应用里的“备忘录助手”。你可以调用工具读取、搜索、新建、修改和删除用户的备忘录，也可以读取和修改这个应用的设置（例如隐藏光标、自动键盘、主题、保存方式、推理强度）。规则：' +
      '1. 涉及备忘或设置时必须调用工具，不要凭空编造；工具失败就如实说明。' +
      '2. 用户明确要求修改时直接执行工具，完成后简短说明改了什么；信息不足或删除范围不明确时，先问一句再操作。' +
      '3. 没有字数上限，不要为了简短而省略关键内容；但手表屏幕很小，优先分点、短段落。' +
      '4. 除代码、路径、引用原文外，用简体中文回答。' +
      '5. 不要声称知道工具之外的数据，也不要输出工具调用过程的内部 JSON。';
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

  function buildHistory(tools) {
    const mode = currentMode();
    const msgs = [];
    const sys = buildSystemPrompt(mode);
    if (sys) msgs.push({ role: 'system', content: sys });
    // 先占位，附件内容需要异步读取，稍后填充
    const items = [];
    state.chat.messages.forEach(function (m) {
      if (m.role === 'user') items.push({ role: 'user', src: m });
      else if (m.role === 'ai' && !m.error) items.push({ role: 'assistant', src: m });
    });
    return { msgs: msgs, items: items };
  }

  async function runAgent() {
    state.sending = true;
    ensureChatButtonState();
    const list = $('#chList');

    // 占位气泡
    state.chat.messages.push({ role: 'ai', text: '', at: Date.now(), pending: true });
    const pendingIndex = state.chat.messages.length - 1;
    state.pendingIndex = pendingIndex;
    renderMessages();
    const pendingEl = document.querySelector('.msg.ai[data-i="' + pendingIndex + '"]');
    if (pendingEl) {
      const bubble = pendingEl.querySelector('.bubble');
      if (bubble) bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    }
    let statusText = '思考中…';

    try {
      const history = buildHistory(hasTools());
      const messages = history.msgs;
      for (const item of history.items) {
        if (item.role === 'user') {
          const content = await buildUserContent(item.src);
          messages.push({ role: 'user', content: content });
        } else {
          const m = { role: 'assistant', content: item.src.text || '' };
          if (hasTools()) m.reasoning_content = item.src.reasoning || '';
          messages.push(m);
        }
      }

      const tools = hasTools() ? toolSchema() : null;
      let final = null;
      for (let round = 0; round < 5; round++) {
        setStatus(round === 0 ? '思考中…' : '继续处理工具结果…');
        const res = await streamOnce(messages, tools);
        if (res.toolCalls && res.toolCalls.length) {
          messages.push({
            role: 'assistant', content: res.content || '',
            reasoning_content: res.reasoning || '',
            tool_calls: res.toolCalls.map(function (c) {
              return { id: c.id, type: 'function', function: { name: c.function.name, arguments: c.function.arguments } };
            })
          });
          for (const call of res.toolCalls) {
            setStatus('正在使用 ' + call.function.name + '…');
            const out = executeTool(call.function.name, call.function.arguments);
            messages.push({ role: 'tool', tool_call_id: call.id, content: out });
          }
          continue;
        }
        final = res;
        break;
      }
      if (!final) throw new Error('工具调用次数过多');

      const msg = state.chat.messages[pendingIndex];
      if (!msg) return;
      msg.pending = false;
      msg.text = final.content || '（空回复）';
      msg.reasoning = final.reasoning || '';
      msg.usage = final.usage ? {
        prompt_tokens: final.usage.prompt_tokens || 0,
        completion_tokens: final.usage.completion_tokens || 0,
        prompt_cache_hit_tokens: final.usage.prompt_cache_hit_tokens || 0,
        prompt_cache_miss_tokens: final.usage.prompt_cache_miss_tokens || 0
      } : null;
      if (final.usage) {
        state.usage = msg.usage;
        state.chat.lastUsage = msg.usage;
      }
      delete msg.pending;
      state.chat.updated = Date.now();
      await Store.saveChat(state.chat);
      $('#chTitle').textContent = State_title();
      renderMessages();
      updateContextRow();
      $('#chSend').classList.remove('stop');
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
      // 滚动到底
      setTimeout(function () { U.scrollToBottom($('#chList')); }, 30);
    }
    if (!Api.hasKey()) { /* nothing */ }
  }

  function setStatus(text) {
    const el = document.querySelector('.msg.ai[data-i="' + state.pendingIndex + '"] .msg-meta');
    if (el) el.innerHTML = '<span class="loading-dot"></span> ' + U.esc(text);
    const bubble = document.querySelector('.msg.ai[data-i="' + state.pendingIndex + '"] .bubble');
    if (bubble && !bubble.dataset.streaming) {
      bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    }
  }

  function streamOnce(messages, tools) {
    return new Promise(function (resolve, reject) {
      let content = '';
      let reasoning = '';
      let lastPaint = 0;
      let paused = false;

      const paint = U.throttle(function () {
        const bubble = document.querySelector('.msg.ai[data-i="' + state.pendingIndex + '"] .bubble');
        if (!bubble) return;
        bubble.dataset.streaming = '1';
        bubble.className = 'bubble md';
        bubble.innerHTML = content ? Md.render(content) : '<span class="typing"><i></i><i></i><i></i></span>';
      }, 60);

      const h = Api.chat({
        messages: messages,
        tools: tools,
        onDelta: function (t) {
          content += t;
          const near = U.isNearBottom($('#chList'), 160);
          paint();
          if (near) U.scrollToBottom($('#chList'));
        },
        onReasoning: function (t) {
          reasoning += t;
          const bubble = document.querySelector('.msg.ai[data-i="' + state.pendingIndex + '"] .bubble');
          if (bubble && !content) bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span><span style="color:var(--hint);font-size:12px;margin-left:6px">思考中</span>';
        }
      });
      state.cancel = function () { h.cancel(); };
      h.done.then(function (res) {
        resolve(res);
      }).catch(function (e) {
        reject(e);
      });
    });
  }

  function hasTools() {
    return currentMode() === 1;
  }

  /* --------------------------------- 工具 --------------------------------- */

  function toolSchema() {
    return [
      {
        type: 'function', function: {
          name: 'list_notes',
          description: '列出或搜索备忘录，返回 id、标题、摘要和更新时间。query 为空时列出最近备忘。',
          parameters: {
            type: 'object', properties: {
              query: { type: 'string', description: '搜索关键词，可为空' },
              limit: { type: 'integer', description: '返回条数，默认 10，最大 30' }
            }, required: []
          }
        }
      },
      {
        type: 'function', function: {
          name: 'read_note',
          description: '读取一条备忘录的完整正文。',
          parameters: { type: 'object', properties: { id: { type: 'integer', description: '备忘录 id' } }, required: ['id'] }
        }
      },
      {
        type: 'function', function: {
          name: 'create_note',
          description: '新建一条备忘录。正文为纯文本，标题自动取第一行。',
          parameters: { type: 'object', properties: { content: { type: 'string', description: '完整正文' } }, required: ['content'] }
        }
      },
      {
        type: 'function', function: {
          name: 'update_note',
          description: '用新正文覆盖一条备忘录，保留分类和标签。',
          parameters: {
            type: 'object', properties: {
              id: { type: 'integer', description: '备忘录 id' },
              content: { type: 'string', description: '新的完整正文' }
            }, required: ['id', 'content']
          }
        }
      },
      {
        type: 'function', function: {
          name: 'trash_note',
          description: '把一条备忘录移入回收站（不是永久删除）。',
          parameters: { type: 'object', properties: { id: { type: 'integer', description: '备忘录 id' } }, required: ['id'] }
        }
      },
      {
        type: 'function', function: {
          name: 'get_settings',
          description: '读取应用的可修改设置。',
          parameters: { type: 'object', properties: {}, required: [] }
        }
      },
      {
        type: 'function', function: {
          name: 'set_setting',
          description: '修改应用设置。key 支持 hide_cursor、auto_keyboard、theme、save_mode、chat_effort；value 为对应值。',
          parameters: {
            type: 'object', properties: {
              key: { type: 'string', description: '设置键' },
              value: { type: 'string', description: '设置值' }
            }, required: ['key', 'value']
          }
        }
      }
    ];
  }

  function executeTool(name, argsJson) {
    let args = {};
    try { args = argsJson ? JSON.parse(argsJson) : {}; } catch (e) { args = {}; }
    try {
      let out;
      if (name === 'list_notes') out = toolListNotes(args);
      else if (name === 'read_note') out = toolReadNote(args);
      else if (name === 'create_note') out = toolCreateNote(args);
      else if (name === 'update_note') out = toolUpdateNote(args);
      else if (name === 'trash_note') out = toolTrashNote(args);
      else if (name === 'get_settings') out = toolGetSettings();
      else if (name === 'set_setting') out = toolSetSetting(args);
      else return JSON.stringify({ ok: false, error: '未知工具' });
      Store.log('TOOL ' + name + ' ' + JSON.stringify(args).slice(0, 120));
      return JSON.stringify(out);
    } catch (e) {
      return JSON.stringify({ ok: false, error: e.message || '工具执行失败' });
    }
  }

  function toolListNotes(args) {
    const q = String(args.query || '').trim();
    let limit = parseInt(args.limit, 10) || 10;
    if (limit <= 0) limit = 10;
    if (limit > 30) limit = 30;
    const notes = Store.notes({ q: q, sort: 0 });
    return {
      ok: true, total: notes.length,
      notes: notes.slice(0, limit).map(function (n) {
        return {
          id: n.id, title: Store.noteTitle(n),
          snippet: U.clampText(n.plain || '', 60),
          updated: n.updated
        };
      })
    };
  }

  function toolReadNote(args) {
    const id = parseInt(args.id, 10) || 0;
    const n = Store.noteById(id);
    if (!n) return { ok: false, error: '找不到 id=' + id + ' 的备忘录' };
    return {
      ok: true, id: n.id, title: n.title || Store.noteTitle(n),
      content: n.plain || '', tags: (n.tags || []).join(','),
      starred: !!n.starred, updated: n.updated
    };
  }

  function plainToHtml(text) {
    return String(text || '').split(/\r?\n/).map(function (line) {
      return '<div>' + (U.esc(line) || '<br>') + '</div>';
    }).join('');
  }

  function titleOf(text) {
    const lines = String(text || '').split(/\r?\n/);
    for (const line of lines) {
      if (line.trim()) return U.clampText(line.trim(), 24);
    }
    return '新备忘';
  }

  function toolCreateNote(args) {
    const content = String(args.content || '').trim();
    if (!content) return { ok: false, error: '正文不能为空' };
    const n = Store.createNote(0);
    Store.updateNote(n.id, { title: titleOf(content), body: plainToHtml(content) });
    Store.flush();
    return { ok: true, id: n.id, title: titleOf(content), message: '已新建备忘' };
  }

  function toolUpdateNote(args) {
    const id = parseInt(args.id, 10) || 0;
    const content = String(args.content || '').trim();
    if (!content) return { ok: false, error: '正文不能为空' };
    const n = Store.noteById(id);
    if (!n) return { ok: false, error: '找不到 id=' + id + ' 的备忘录' };
    Store.updateNote(id, { title: titleOf(content), body: plainToHtml(content) });
    Store.flush();
    return { ok: true, id: id, title: titleOf(content), message: '已修改备忘' };
  }

  function toolTrashNote(args) {
    const id = parseInt(args.id, 10) || 0;
    const n = Store.noteById(id);
    if (!n) return { ok: false, error: '找不到 id=' + id + ' 的备忘录' };
    Store.trashNote(id);
    Store.flush();
    return { ok: true, id: id, message: '已移入回收站：' + Store.noteTitle(n) };
  }

  function toolGetSettings() {
    const s = Store.settings();
    return {
      ok: true,
      settings: {
        hide_cursor: !!s.hideCursor,
        auto_keyboard: !!s.autoKeyboard,
        theme: s.theme || 0,
        save_mode: s.saveMode || 0,
        chat_effort: s.chatEffort || 'high',
        chat_model: s.chatModel || 'deepseek-flash'
      },
      theme_values: '0=跟随系统,1=浅色,2=深色',
      save_mode_values: '0=输入即存,1=保存按键保存'
    };
  }

  function toolSetSetting(args) {
    const key = String(args.key || '');
    const value = String(args.value == null ? '' : args.value);
    const s = Store.settings();
    let summary = '';
    const truthy = /^(true|1|开|开启|打开|启用|on|yes)$/i.test(value);
    if (key === 'hide_cursor') {
      Store.setSetting('hideCursor', truthy);
      summary = truthy ? '已开启收起键盘自动隐藏光标' : '已关闭收起键盘自动隐藏光标';
    } else if (key === 'auto_keyboard') {
      Store.setSetting('autoKeyboard', truthy);
      summary = truthy ? '已开启进入备忘录自动打开键盘' : '已关闭进入备忘录自动打开键盘';
    } else if (key === 'theme') {
      let t = 0;
      if (/^(light|浅色|1)$/i.test(value)) t = 1;
      else if (/^(dark|深色|2)$/i.test(value)) t = 2;
      Store.setSetting('theme', t);
      App.applyTheme();
      summary = '已把外观设置为' + (t === 1 ? '浅色' : t === 2 ? '深色' : '跟随系统');
    } else if (key === 'save_mode') {
      const manual = /^(manual|1|保存按键保存)$/i.test(value);
      Store.setSetting('saveMode', manual ? 1 : 0);
      summary = '保存方式已改为' + (manual ? '保存按键保存' : '输入即存');
    } else if (key === 'chat_effort') {
      const v = value.toLowerCase();
      if (['off', 'low', 'high', 'max'].indexOf(v) < 0) {
        return { ok: false, error: '推理强度只能是 off / low / high / max' };
      }
      Store.setSetting('chatEffort', v);
      summary = '推理强度已改为 ' + v;
    } else {
      return { ok: false, error: '不支持修改设置：' + key };
    }
    Store.flush();
    Store.log('TOOL set_setting ' + key + '=' + value);
    return { ok: true, message: summary };
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
    const used = (u.prompt_tokens || 0);
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
    const v = Store.settings().lastBalance;
    $('#chBalance').textContent = v ? ('余额 ' + v) : (Api.hasKey() ? '余额 —' : '余额 未设置 Key');
  }

  async function loadModelInfo() {
    if (!Api.hasKey()) return;
    const key = 'modelInfoFetchedAt';
    const last = parseInt(Store.settings()[key] || '0', 10);
    if (Date.now() - last < 3600000) return;
    const map = await Api.cacheModelInfo();
    if (map) {
      Store.setSetting(key, String(Date.now()));
      Store.save();
    }
  }

  /* --------------------------------- 芯片面板 --------------------------------- */

  function pickMode() {
    U.sheet({
      title: '聊天模式',
      items: MODES.map(function (m) {
        return {
          label: m.name, check: currentMode() === m.id,
          onTap: function () {
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
    const cur = Store.settings().chatModel || 'deepseek-flash';
    const models = ['deepseek-flash', 'deepseek-chat', 'deepseek-reasoner'];
    const items = models.map(function (m) {
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
      items: EFFORTS.map(function (e) {
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
    const archived = Store.chatMetas().filter(function (c) { return c.archived; }).length;
    U.sheet({
      title: '对话',
      items: [
        { icon: 'archive', label: '查看对话', onTap: openDrawer },
        {
          icon: 'trash', label: '清空当前对话', onTap: function () {
            U.confirm({
              title: '清空当前对话', message: '只清空当前这段对话，其他历史对话保留，确定吗？',
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
              title: '删除当前对话', message: '当前对话和里面的附件都会删除，其他历史对话保留，确定吗？',
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
        {
          icon: 'info', label: '官方推理强度', onTap: function () {
            U.alert({
              title: '官方推理强度',
              message: 'DeepSeek 思考模式官方参数：\n· reasoning_effort: low / high / max\n· off 关闭思考，默认 high\n· 别名 minimal→low，medium/xhigh→high\n\n模型：deepseek-flash 就是 DeepSeek-V4.1-Flash，上下文 1M。'
            });
          }
        },
        {
          icon: 'archive', label: archived ? ('已归档（' + archived + '）') : '已归档（0）', onTap: function () {
            openDrawer();
            state.archivedView = true;
            renderDrawer();
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
        { icon: 'mic', label: '录音', onTap: attachVoice },
        { icon: 'doc', label: '本机文件', onTap: attachFile }
      ]
    });
  }

  async function attachImage() {
    try {
      const r = await Native.call('photo.pick', {});
      state.pendingAtts.push({
        kind: 'image', name: r.path.split('/').pop(), path: r.path, mime: 'image/jpeg',
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

  function attachVoice() {
    if (editorRecording) return;
    openChatRecorder();
  }

  let editorRecording = null;

  function openChatRecorder() {
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

    const rec = { active: false, startedAt: 0, path: '', timer: 0, meter: 0, limit: 0 };
    editorRecording = rec;
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
      if (ms < 600) {
        try { await Native.call('fs', { op: 'delete', path: path }); } catch (e) { /* ignore */ }
        U.closeSheet();
        editorRecording = null;
        U.toast('录音太短，再来一次');
        return;
      }
      U.closeSheet();
      hintEl.textContent = '正在识别语音…';
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
      editorRecording = null;
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
      editorRecording = null;
      U.closeSheet();
    });

    start().catch(function (e) { U.toast(e.message || '录音失败，请检查麦克风'); });
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
    $('#chDrawerScrim').classList.add('on');
    $('#chDrawer').classList.add('on');
    state.archivedView = false;
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

    const groups = [
      { key: 'pinned', label: '置顶' },
      { key: 'today', label: '今天' },
      { key: 'yesterday', label: '昨天' },
      { key: 'week', label: '7 天内' },
      { key: 'earlier', label: '更早' }
    ];
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
    $('#chTitle').textContent = State_title();
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
        {
          icon: 'pin', label: m.pinned ? '取消置顶' : '置顶会话', onTap: function () { togglePin(id); }
        },
        {
          icon: 'edit', label: '重命名', onTap: function () {
            U.prompt({ title: '对话名称', value: m.title || '', maxlength: 40, okText: '保存' })
              .then(function (v) {
                if (!v) return;
                Store.updateChatMeta(id, { title: v, customTitle: true });
                Store.flush();
                if (state.chat && state.chat.id === id) {
                  state.chat.title = v;
                  $('#chTitle').textContent = State_title();
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
          icon: 'trash', label: '删除当前对话', danger: true, onTap: function () {
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
    init: init, open: open, onShow: onShow, onHide: onHide,
    newChat: newChat,
    currentChat: function () { return state.chat; }
  };
})();
