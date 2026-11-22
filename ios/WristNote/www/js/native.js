/* 原生桥：iPhone 上走 WKWebView messageHandlers，桌面浏览器用 mock 方便调 UI */
window.Native = (function () {
  const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native;
  const hasNative = !!handler;
  let seq = 0;
  const pending = new Map();
  const streamCbs = new Map();
  const audioCbs = [];

  window.__nres = function (id, ok, payload) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(payload);
    else p.reject(new Error((payload && payload.error) || '原生调用失败'));
  };

  window.__nev = function (id, type, payload) {
    const cb = streamCbs.get(id);
    if (!cb) return;
    if (type === 'chunk') {
      try { cb.onChunk((payload && payload.text) || ''); } catch (e) { console.error(e); }
    } else if (type === 'done') {
      streamCbs.delete(id);
      try { cb.onDone(payload || {}); } catch (e) { console.error(e); }
    }
  };

  window.__naudio = function (payload) {
    audioCbs.forEach(function (cb) {
      try { cb(payload); } catch (e) { console.error(e); }
    });
  };

  function call(method, params) {
    params = params || {};
    if (!hasNative) return mock(method, params);
    return new Promise(function (resolve, reject) {
      const id = ++seq;
      pending.set(id, { resolve: resolve, reject: reject });
      try {
        handler.postMessage({ id: id, method: method, params: params });
      } catch (e) {
        pending.delete(id);
        reject(new Error(String(e && e.message || e)));
      }
    });
  }

  function stream(method, params, onChunk) {
    params = Object.assign({ stream: true }, params || {});
    if (!hasNative) return mockStream(method, params, onChunk);
    const id = ++seq;
    let settled = false;
    const done = new Promise(function (resolve, reject) {
      streamCbs.set(id, {
        onChunk: onChunk,
        onDone: function (payload) {
          settled = true;
          if (payload && payload.error) reject(new Error(payload.error));
          else resolve(payload);
        }
      });
      try {
        handler.postMessage({ id: id, method: method, params: params });
      } catch (e) {
        streamCbs.delete(id);
        reject(new Error(String(e && e.message || e)));
      }
    });
    return {
      id: id,
      done: done,
      cancel: function () {
        if (settled) return;
        settled = true;
        streamCbs.delete(id);
        call('http.cancel', { id: id }).catch(function () {});
      }
    };
  }

  function onAudio(cb) { audioCbs.push(cb); }

  function log(text) {
    try { call('log', { text: String(text) }); } catch (e) { console.log(text); }
    if (!hasNative) console.log('[log]', text);
  }

  /* ======================= 桌面 mock（仅预览用） ======================= */

  const mem = new Map();
  function memGet(p) { return mem.has(p) ? mem.get(p) : null; }
  function memSet(p, v) { mem.set(p, v); }

  let recStart = 0;
  let recPath = '';
  let recording = false;

  function silentWav(seconds) {
    const rate = 16000, ch = 1, bits = 16;
    const samples = Math.max(1, Math.round(rate * seconds));
    const dataSize = samples * 2;
    const buf = new ArrayBuffer(44 + dataSize);
    const dv = new DataView(buf);
    const str = function (off, s) { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + dataSize, true); str(8, 'WAVE');
    str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
    dv.setUint16(22, ch, true); dv.setUint32(24, rate, true);
    dv.setUint32(28, rate * ch * bits / 8, true); dv.setUint16(32, ch * bits / 8, true);
    dv.setUint16(34, bits, true); str(36, 'data'); dv.setUint32(40, dataSize, true);
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  }

  function dataUrlFor(path) {
    const v = memGet(path);
    if (!v) return null;
    if (v.indexOf('data:') === 0) return v;
    const mime = /\.wav$/.test(path) ? 'audio/wav' : /\.(png)$/.test(path) ? 'image/png' : 'image/jpeg';
    return 'data:' + mime + ';base64,' + v;
  }

  /* ---------------- mock 聊天：没有 API Key 时也能看界面 ---------------- */
  const MOCK_REPLY = '（本地预览模式，没有连接真实接口）\n\n' +
    '这是 **Markdown** 渲染测试：\n\n' +
    '## 小标题\n\n' +
    '- 粗体 **重点**、*斜体*、~~删除~~\n' +
    '- 行内代码 `note.id`\n' +
    '- 链接 [DeepSeek](https://api-docs.deepseek.com)\n\n' +
    '| 项目 | 值 |\n| --- | --- |\n| 上下文 | 1M |\n| 缓存 | 62% |\n\n' +
    '```js\nconst a = 1;\nconsole.log(a);\n```\n\n' +
    '> 引用一行\n\n' +
    '1. 第一点\n2. 第二点\n\n' +
    '括号测试 \\( 行内公式 \\) 和 \\[ 方括号 \\]。';

  function mockChatStream(p, onChunk) {
    const body = (function () { try { return JSON.parse(p.body || '{}'); } catch (e) { return {}; } })();
    const hasTools = !!(body.tools && body.tools.length);
    const hasToolResult = (body.messages || []).some(function (m) { return m.role === 'tool'; });
    const lastUser = (function () {
      const ms = (body.messages || []).filter(function (m) { return m.role === 'user'; });
      const m = ms[ms.length - 1];
      return m ? String(m.content || '') : '';
    })();
    let cancelled = false;
    const done = new Promise(function (resolve) {
      setTimeout(function () {
        if (cancelled) return resolve({ status: 0, error: 'cancelled' });
        const wantsTool = hasTools && !hasToolResult && /备忘|note|列出|搜索/.test(lastUser) && !/不要工具/.test(lastUser);
        if (wantsTool) {
          const payload = {
            id: 'call_mock_' + Date.now(),
            type: 'function',
            function: {
              name: 'list_notes',
              arguments: JSON.stringify({ query: '', limit: 3 })
            }
          };
          const chunk = 'data: ' + JSON.stringify({
            choices: [{ delta: { tool_calls: [{ index: 0, id: payload.id, type: 'function', function: { name: 'list_notes', arguments: '{"query":"","limit":3}' } }] } }]
          }) + '\n\n';
          onChunk(chunk);
          onChunk('data: ' + JSON.stringify({
            choices: [{ delta: {}, finish_reason: 'tool_calls' }],
            usage: { prompt_tokens: 1200, completion_tokens: 20, prompt_cache_hit_tokens: 800, prompt_cache_miss_tokens: 400 }
          }) + '\n\n');
          resolve({ status: 200 });
          return;
        }
        const usage = { prompt_tokens: 8200 + Math.floor(Math.random() * 800), completion_tokens: 420, prompt_cache_hit_tokens: 6100, prompt_cache_miss_tokens: 2100 };
        let i = 0;
        const text = MOCK_REPLY;
        const step = 14;
        const timer = setInterval(function () {
          if (cancelled) { clearInterval(timer); return; }
          const piece = text.slice(i, i + step);
          i += step;
          if (piece) onChunk('data: ' + JSON.stringify({ choices: [{ delta: { content: piece } }] }) + '\n\n');
          if (i >= text.length) {
            clearInterval(timer);
            onChunk('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: usage }) + '\n\n');
            onChunk('data: [DONE]\n\n');
            resolve({ status: 200 });
          }
        }, 26);
      }, 380);
    });
    return { done: done, cancel: function () { cancelled = true; } };
  }

  function mock(method, p) {
    return new Promise(function (resolve, reject) {
      switch (method) {
        case 'info':
          resolve({
            version: '1.0.0', build: '1', ios: 'web-preview', model: 'browser',
            width: window.innerWidth, height: window.innerHeight,
            scale: window.devicePixelRatio || 1,
            safeTop: 0, safeBottom: 0, dark: false
          });
          return;

        case 'fs': {
          const path = p.path || '';
          switch (p.op) {
            case 'write': memSet(path, p.text == null ? '' : p.text); resolve({}); return;
            case 'read': {
              const v = memGet(path);
              if (v === null || v.indexOf('data:') === 0) reject(new Error('not found'));
              else resolve({ text: v });
              return;
            }
            case 'list': {
              const dir = path.replace(/\/$/, '');
              const pre = dir ? dir + '/' : '';
              const names = [];
              mem.forEach(function (_, k) {
                if (k.indexOf(pre) !== 0) return;
                const rest = k.slice(pre.length);
                if (rest.indexOf('/') >= 0) return;
                names.push(rest);
              });
              resolve({ names: Array.from(new Set(names)).sort() });
              return;
            }
            case 'delete': mem.delete(path); resolve({}); return;
            case 'exists': resolve({ exists: mem.has(path) }); return;
            case 'bytes': {
              const v = memGet(path);
              if (v === null) { reject(new Error('not found')); return; }
              if (v.indexOf('data:') === 0) resolve({ base64: v.split(',')[1] });
              else resolve({ base64: btoa(unescape(encodeURIComponent(v))) });
              return;
            }
            case 'writeBytes': memSet(path, 'data:application/octet-stream;base64,' + p.base64); resolve({}); return;
            case 'size': {
              const v = memGet(path) || '';
              resolve({ size: v.length });
              return;
            }
            case 'mkdir': resolve({}); return;
            case 'move': {
              const v = memGet(p.from);
              if (v !== null) { memSet(p.to, v); mem.delete(p.from); }
              resolve({});
              return;
            }
            default: reject(new Error('unknown fs op')); return;
          }
        }

        case 'http': {
          if (/\/user\/balance/.test(p.url)) {
            resolve({ status: 200, body: JSON.stringify({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '88.88', granted_balance: '0.00', topped_up_balance: '88.88' }] }) });
            return;
          }
          if (/\/models/.test(p.url)) {
            resolve({ status: 200, body: JSON.stringify({ data: [{ id: 'deepseek-flash', context_window: 1000000 }, { id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }) });
            return;
          }
          if (/\/chat\/completions/.test(p.url)) {
            resolve({
              status: 200,
              body: JSON.stringify({
                choices: [{
                  message: { content: MOCK_REPLY, reasoning_content: '先把问题拆成几块，再给结论。' },
                  finish_reason: 'stop'
                }],
                usage: {
                  prompt_tokens: 8200, completion_tokens: 420,
                  prompt_cache_hit_tokens: 6100, prompt_cache_miss_tokens: 2100
                }
              })
            });
            return;
          }
          fetch(p.url, {
            method: p.method || 'GET',
            headers: p.headers || {},
            body: p.body || undefined
          }).then(function (r) {
            return r.text().then(function (t) { resolve({ status: r.status, body: t }); });
          }).catch(function (e) { reject(new Error(String(e))); });
          return;
        }

        case 'http.multipart': {
          resolve({ status: 200, body: JSON.stringify({ ok: true, text: '（预览模式）这是一段模拟的语音识别结果。', id: 'file_mock' }) });
          return;
        }

        case 'http.cancel': resolve({}); return;

        case 'audio.start': {
          recStart = Date.now();
          recPath = p.path || ('audio/rec-' + recStart + '.wav');
          recording = true;
          resolve({ path: recPath });
          return;
        }
        case 'audio.stop': {
          if (!recording) { reject(new Error('没有在录音')); return; }
          recording = false;
          const ms = Math.max(300, Date.now() - recStart);
          const b64 = silentWav(Math.max(0.3, ms / 1000));
          memSet(recPath, 'data:audio/wav;base64,' + b64);
          resolve({ path: recPath, ms: ms, base64: b64, size: b64.length });
          return;
        }
        case 'audio.cancel': {
          recording = false;
          if (recPath) mem.delete(recPath);
          resolve({});
          return;
        }
        case 'audio.level': resolve({ level: -38 + Math.random() * 16 }); return;

        case 'audio.play': {
          mockAudio.play(p.path, p.ms || 0, p.speed || 1);
          resolve({ ok: true });
          return;
        }
        case 'audio.pause': mockAudio.pause(); resolve({}); return;
        case 'audio.resume': mockAudio.resume(); resolve({}); return;
        case 'audio.stop': mockAudio.stop(); resolve({}); return;
        case 'audio.seek': mockAudio.seek(p.ms || 0); resolve({}); return;

        case 'photo.pick': {
          const inp = document.createElement('input');
          inp.type = 'file'; inp.accept = 'image/*';
          inp.onchange = function () {
            const f = inp.files && inp.files[0];
            if (!f) { reject(new Error('取消')); return; }
            const fr = new FileReader();
            fr.onload = function () {
              const url = String(fr.result);
              const b64 = url.split(',')[1];
              const img = new Image();
              const path = 'images/' + Date.now() + '.jpg';
              img.onload = function () {
                memSet(path, url);
                resolve({ path: path, w: img.width, h: img.height });
              };
              img.onerror = function () { memSet(path, url); resolve({ path: path, w: 0, h: 0 }); };
              img.src = url;
            };
            fr.readAsDataURL(f);
          };
          inp.click();
          return;
        }

        case 'file.pick': {
          const inp = document.createElement('input');
          inp.type = 'file'; inp.accept = p.accept || '*/*';
          inp.onchange = function () {
            const f = inp.files && inp.files[0];
            if (!f) { reject(new Error('取消')); return; }
            const fr = new FileReader();
            fr.onload = function () {
              const path = 'files/' + Date.now() + '-' + f.name;
              memSet(path, String(fr.result));
              resolve({ path: path, name: f.name, size: f.size, mime: f.type || 'application/octet-stream' });
            };
            fr.readAsDataURL(f);
          };
          inp.click();
          return;
        }

        case 'clip.set': {
          try { navigator.clipboard.writeText(p.text || ''); } catch (e) { /* ignore */ }
          resolve({});
          return;
        }
        case 'openURL': window.open(p.url, '_blank'); resolve({}); return;
        case 'share': {
          if (navigator.share) navigator.share({ text: p.text || '' }).catch(function () {});
          resolve({});
          return;
        }
        case 'haptic': resolve({}); return;
        case 'log': {
          console.log('[native log]', p.text);
          (window.__log = window.__log || []).push(p.text);
          resolve({});
          return;
        }
        case 'log.read': resolve({ text: (window.__log || []).join('\n') }); return;
        case 'log.clear': window.__log = []; resolve({}); return;
        case 'ui.appearance': {
          document.body.classList.toggle('dark', !!p.dark);
          resolve({});
          return;
        }
        default: reject(new Error('未知原生方法 ' + method)); return;
      }
    });
  }

  const mockAudio = (function () {
    let timer = 0, startAt = 0, base = 0, dur = 0, playing = false, speed = 1, path = '';
    function emit(state) {
      window.__naudio({ state: state, ms: Math.min(dur, base + (playing ? (Date.now() - startAt) * speed : 0)), dur: dur, path: path });
    }
    function tick() {
      if (!playing) return;
      const ms = base + (Date.now() - startAt) * speed;
      if (ms >= dur) { playing = false; clearInterval(timer); base = dur; emit('ended'); return; }
      emit('playing');
    }
    return {
      play: function (p, from, sp) {
        path = p; speed = sp || 1; dur = 5000;
        const v = memGet(p);
        const audio = new Audio(v ? dataUrlFor(p) : '');
        audio.onloadedmetadata = function () { if (isFinite(audio.duration)) dur = audio.duration * 1000; };
        audio.playbackRate = speed;
        audio.currentTime = from / 1000;
        audio.play().catch(function () {});
        mockAudio._audio = audio;
        base = from; startAt = Date.now(); playing = true;
        clearInterval(timer); timer = setInterval(tick, 200);
        emit('playing');
      },
      pause: function () {
        if (!playing) return;
        base = base + (Date.now() - startAt) * speed;
        playing = false; clearInterval(timer);
        if (mockAudio._audio) mockAudio._audio.pause();
        emit('paused');
      },
      resume: function () {
        if (playing) return;
        startAt = Date.now(); playing = true;
        clearInterval(timer); timer = setInterval(tick, 200);
        if (mockAudio._audio) mockAudio._audio.play().catch(function () {});
        emit('playing');
      },
      stop: function () {
        playing = false; clearInterval(timer); base = 0;
        if (mockAudio._audio) { mockAudio._audio.pause(); mockAudio._audio.currentTime = 0; }
        emit('stopped');
      },
      seek: function (ms) {
        base = ms; startAt = Date.now();
        if (mockAudio._audio) mockAudio._audio.currentTime = ms / 1000;
        emit(playing ? 'playing' : 'paused');
      }
    };
  })();

  function mockStream(method, p, onChunk) {
    if (/\/chat\/completions/.test(p.url)) {
      return mockChatStream(p, onChunk);
    }
    const ctrl = new AbortController();
    const done = fetch(p.url, {
      method: p.method || 'POST',
      headers: p.headers || {},
      body: p.body || undefined,
      signal: ctrl.signal
    }).then(function (r) {
      if (!r.body || !r.body.getReader) {
        return r.text().then(function (t) { onChunk(t); return { status: r.status }; });
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder('utf-8');
      function pump() {
        return reader.read().then(function (res) {
          if (res.done) return { status: r.status };
          onChunk(dec.decode(res.value, { stream: true }));
          return pump();
        });
      }
      return pump();
    });
    return { done: done, cancel: function () { ctrl.abort(); } };
  }

  return {
    hasNative: hasNative,
    call: call,
    stream: stream,
    onAudio: onAudio,
    log: log,
    dataUrl: dataUrlFor
  };
})();
