/* DeepSeek 官方接口：Chat Completions（SSE 流式）、余额、模型、Files、ASR */
window.Api = (function () {

  function s() { return Store.settings(); }

  function base() {
    let b = (s().apiBase || 'https://api.deepseek.com').trim();
    while (b.endsWith('/')) b = b.slice(0, -1);
    return b || 'https://api.deepseek.com';
  }

  function key() { return (s().apiKey || '').trim(); }
  function hasKey() { return !!key(); }

  function headers(extra) {
    const h = { Authorization: 'Bearer ' + key() };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  async function request(path, opts) {
    opts = opts || {};
    if (!hasKey()) throw new Error('还没有填 API Key（设置 → 语音与识别）');
    const url = base() + path;
    const params = {
      url: url,
      method: opts.method || 'GET',
      headers: headers(opts.headers || {}),
      timeout: opts.timeout || 120
    };
    if (opts.json !== undefined) {
      params.headers['Content-Type'] = 'application/json; charset=utf-8';
      params.body = JSON.stringify(opts.json);
    }
    const r = await Native.call('http', params);
    if (r.status >= 200 && r.status < 300) return r.body;
    throw new Error(errorText(r.status, r.body));
  }

  function errorText(status, body) {
    let msg = '';
    try {
      const j = JSON.parse(body);
      msg = (j.error && (j.error.message || j.error.code)) || j.message || j.detail || '';
    } catch (e) {
      msg = String(body || '').slice(0, 200);
    }
    return (status ? 'HTTP ' + status + ' ' : '') + (msg || '请求失败');
  }

  /* --------------------------------- 对话 --------------------------------- */

  /**
   * 流式对话
   * @param {{messages:Array, tools?:Array, model?:string, effort?:string,
   *          onDelta?:(t:string)=>void, onReasoning?:(t:string)=>void,
   *          onToolCalls?:(calls:Array)=>void}} opts
   * @returns {{done:Promise, cancel:Function}}
   */
  function chat(opts) {
    if (!hasKey()) {
      return {
        done: Promise.reject(new Error('还没有填 API Key（设置 → 语音与识别）')),
        cancel: function () {}
      };
    }
    const model = opts.model || s().chatModel || 'deepseek-flash';
    const effort = opts.effort || s().chatEffort || 'high';
    const body = {
      model: model,
      messages: opts.messages,
      stream: true,
      stream_options: { include_usage: true }
    };
    if (effort === 'off') {
      body.thinking = { type: 'disabled' };
    } else {
      body.thinking = { type: 'enabled' };
      body.reasoning_effort = effort;
    }
    if (opts.tools && opts.tools.length) {
      body.tools = opts.tools;
      body.tool_choice = 'auto';
    }

    let content = '';
    let reasoning = '';
    let usage = null;
    let finishReason = ''
    let rawError = '';
    const toolCalls = [];
    let buffer = '';
    let gotAny = false;

    function handleLine(line) {
      if (!line || line.indexOf('data:') !== 0) return;
      const payload = line.slice(5).trim();
      if (!payload) return;
      if (payload === '[DONE]') return;
      let json;
      try { json = JSON.parse(payload); } catch (e) { return; }
      gotAny = true;
      if (json.error) {
        rawError = (json.error && (json.error.message || json.error.code)) || '接口返回错误';
        return;
      }
      const choice = (json.choices || [])[0] || {};
      const delta = choice.delta || {};
      if (delta.content) {
        content += delta.content;
        if (opts.onDelta) opts.onDelta(delta.content);
      }
      const think = delta.reasoning_content !== undefined ? delta.reasoning_content : delta.reasoning;
      if (think) {
        reasoning += think;
        if (opts.onReasoning) opts.onReasoning(think);
      }
      if (delta.tool_calls) {
        delta.tool_calls.forEach(function (tc) {
          const idx = tc.index || 0;
          if (!toolCalls[idx]) toolCalls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
          const slot = toolCalls[idx];
          if (tc.id) slot.id = tc.id;
          if (tc.type) slot.type = tc.type;
          if (tc.function) {
            if (tc.function.name) slot.function.name += tc.function.name;
            if (tc.function.arguments) slot.function.arguments += tc.function.arguments;
          }
        });
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
      if (json.usage) usage = json.usage;
    }

    const stream = Native.stream('http', {
      url: base() + '/chat/completions',
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json; charset=utf-8' }),
      body: JSON.stringify(body),
      timeout: 600
    }, function (text) {
      buffer += text;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        handleLine(line);
      }
    });

    const done = stream.done.then(function (res) {
      if (buffer.trim()) handleLine(buffer.trim());
      if (res && res.error) throw new Error(res.error);
      const status = (res && res.status) || 0;
      if (status >= 400) throw new Error(errorText(status, rawError || ''));
      if (rawError) throw new Error(rawError);
      if (!gotAny && status && status !== 200) throw new Error(errorText(status, ''));
      return {
        content: content,
        reasoning: reasoning,
        toolCalls: toolCalls.filter(Boolean),
        usage: usage,
        finishReason: finishReason
      };
    });

    return { done: done, cancel: stream.cancel };
  }

  /* --------------------------------- 余额 --------------------------------- */

  async function balance() {
    const text = await request('/user/balance', { timeout: 20 });
    let root;
    try { root = JSON.parse(text); } catch (e) { throw new Error('余额返回格式不对'); }
    const infos = root.balance_infos || [];
    const first = infos[0] || {};
    const total = String(first.total_balance != null ? first.total_balance : (root.total_balance || ''));
    const currency = first.currency || root.currency || 'CNY';
    const display = currency === 'CNY' ? ('¥' + total) : (total + ' ' + currency);
    return {
      total: total, currency: currency, display: display,
      granted: first.granted_balance || '', topped: first.topped_up_balance || '',
      available: root.is_available !== false
    };
  }

  /* --------------------------------- 模型 --------------------------------- */

  async function models() {
    const text = await request('/models', { timeout: 20 });
    const root = JSON.parse(text);
    const arr = root.data || root.models || [];
    return arr.map(function (m) {
      return {
        id: m.id || m.name,
        contextWindow: m.context_window || (m.context && m.context.window) || 0,
        efforts: (m.effort && m.effort.supported_levels) || []
      };
    });
  }

  function contextWindow(model) {
    const known = {
      'deepseek-flash': 1000000,
      'deepseek-v4-flash': 1000000,
      'deepseek-chat': 1000000,
      'deepseek-reasoner': 1000000
    };
    if (known[model]) return known[model];
    try {
      const info = JSON.parse(s().modelInfo || '{}');
      if (info[model] && info[model].contextWindow) return info[model].contextWindow;
    } catch (e) { /* ignore */ }
    return 1000000;
  }

  async function cacheModelInfo() {
    try {
      const list = await models();
      const map = {};
      list.forEach(function (m) { map[m.id] = m; });
      Store.setSetting('modelInfo', JSON.stringify(map));
      Store.flush();
      return map;
    } catch (e) {
      return null;
    }
  }

  /* --------------------------------- Files -------------------------------- */

  async function uploadFile(path, name, mime, purpose) {
    if (!hasKey()) throw new Error('还没有填 API Key');
    const r = await Native.call('http.multipart', {
      url: base() + '/files',
      method: 'POST',
      headers: headers(),
      fields: [{ name: 'purpose', value: purpose || 'user_data' }],
      file: { field: 'file', path: path, name: name || 'file', mime: mime || 'application/octet-stream' },
      timeout: 300
    });
    if (r.status < 200 || r.status >= 300) throw new Error(errorText(r.status, r.body));
    const j = JSON.parse(r.body);
    return j.id || (j.data && j.data.id) || '';
  }

  /* ---------------------------------- ASR --------------------------------- */

  async function asr(path) {
    if (!hasKey()) throw new Error('还没填 API Key（设置 → 语音与识别）');
    const r = await Native.call('http.multipart', {
      url: base() + '/v1/tools/asr',
      method: 'POST',
      headers: headers(),
      fields: [],
      file: { field: 'file', path: path, name: 'audio.wav', mime: 'audio/wav' },
      timeout: 180
    });
    if (r.status < 200 || r.status >= 300) throw new Error(errorText(r.status, r.body));
    let text = '';
    try {
      const j = JSON.parse(r.body);
      text = j.text || j.transcript || j.result || (j.data && (j.data.text || (j.data[0] && j.data[0].text))) || '';
    } catch (e) {
      text = String(r.body || '');
    }
    if (!text) throw new Error('识别结果为空');
    return String(text).trim();
  }

  return {
    base: base, key: key, hasKey: hasKey, headers: headers,
    request: request, errorText: errorText,
    chat: chat, balance: balance, models: models, contextWindow: contextWindow,
    cacheModelInfo: cacheModelInfo, uploadFile: uploadFile, asr: asr
  };
})();
