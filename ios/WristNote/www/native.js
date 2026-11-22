/* WristNote 原生桥 —— 有 WKWebView 就走原生，桌面浏览器走本地 mock，方便开发时直接看界面 */
(function () {
  const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native;
  const hasNative = !!handler;
  let seq = 0;
  const pending = new Map();
  const streamCbs = new Map();

  window.__nres = function (id, ok, payload) {
    const p = pending.get(id);
    pending.delete(id);
    if (!p) return;
    if (ok) p.resolve(payload);
    else p.reject(new Error((payload && payload.error) || '原生调用失败'));
  };

  window.__nev = function (id, type, payload) {
    const cb = streamCbs.get(id);
    if (!cb) return;
    if (type === 'chunk') { try { cb.onChunk((payload && payload.text) || ''); } catch (e) {} }
    else if (type === 'done') { streamCbs.delete(id); try { cb.onDone(payload || {}); } catch (e) {} }
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
        reject(e);
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
        reject(e);
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

  /* ---------------- 桌面 mock ---------------- */

  const VFS_KEY = 'wristnote.vfs.';
  function vfsAll() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(VFS_KEY) === 0) out[k.slice(VFS_KEY.length)] = localStorage.getItem(k);
    }
    return out;
  }

  let recorder = null, recChunks = [], recStart = 0;

  function mock(method, p) {
    return new Promise(function (resolve, reject) {
      switch (method) {
        case 'info':
          resolve({
            version: 'dev', ios: 'web', model: navigator.platform || 'browser',
            width: window.innerWidth, height: window.innerHeight,
            scale: window.devicePixelRatio || 1, safeTop: 0, safeBottom: 0
          });
          return;
        case 'fs': {
          const key = VFS_KEY + (p.path || '');
          switch (p.op) {
            case 'write': localStorage.setItem(key, p.text == null ? '' : p.text); resolve({}); return;
            case 'read': {
              const v = localStorage.getItem(key);
              if (v === null) reject(new Error('not found')); else resolve({ text: v });
              return;
            }
            case 'list': {
              const dir = (p.path || '').replace(/\/$/, '');
              const pre = dir ? dir + '/' : '';
              const names = Object.keys(vfsAll())
                .filter(function (k) { return k.indexOf(pre) === 0; })
                .map(function (k) { const rest = k.slice(pre.length); return rest.split('/')[0]; });
              resolve({ names: Array.from(new Set(names)).sort() });
              return;
            }
            case 'delete': localStorage.removeItem(key); resolve({}); return;
            case 'exists': resolve({ exists: localStorage.getItem(key) !== null }); return;
            case 'bytes': {
              const v = localStorage.getItem(key) || '';
              resolve({ base64: v.indexOf('data:') === 0 ? v.split(',')[1] : btoa(unescape(encodeURIComponent(v))) });
              return;
            }
            case 'writeBytes': localStorage.setItem(key, 'data:application/octet-stream;base64,' + p.base64); resolve({}); return;
            case 'size': resolve({ size: (localStorage.getItem(key) || '').length }); return;
            default: reject(new Error('unknown fs op')); return;
          }
        }
        case 'http': {
          fetch(p.url, {
            method: p.method || 'GET',
            headers: p.headers || {},
            body: p.body || undefined
          }).then(function (r) {
            return r.text().then(function (t) { resolve({ status: r.status, body: t }); });
          }).catch(function (e) { reject(new Error(String(e))); });
          return;
        }
        case 'audio.start': {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { reject(new Error('no mic')); return; }
          navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
            try { recorder = new MediaRecorder(s); } catch (e) { reject(e); return; }
            recChunks = [];
            recorder.ondataavailable = function (e) { if (e.data && e.data.size) recChunks.push(e.data); };
            recorder.start();
            recStart = Date.now();
            resolve({ path: p.path || 'audio/rec.wav' });
          }).catch(function (e) { reject(new Error('麦克风不可用: ' + e)); });
          return;
        }
        case 'audio.stop': {
          if (!recorder) { reject(new Error('没有在录音')); return; }
          const r = recorder; recorder = null;
          const ms = Date.now() - recStart;
          r.onstop = function () {
            const blob = new Blob(recChunks, { type: r.mimeType || 'audio/webm' });
            const fr = new FileReader();
            fr.onload = function () {
              const b64 = String(fr.result).split(',')[1];
              resolve({ path: p.path || 'audio/rec.webm', ms: ms, base64: b64, mime: blob.type, size: blob.size });
            };
            fr.readAsDataURL(blob);
          };
          try { r.stop(); } catch (e) { reject(e); }
          if (r.stream) r.stream.getTracks().forEach(function (t) { t.stop(); });
          return;
        }
        case 'audio.cancel': {
          if (recorder) { try { recorder.stop(); } catch (e) {} recorder = null; }
          resolve({}); return;
        }
        case 'audio.level': resolve({ level: -40 + Math.random() * 20 }); return;
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
              img.onload = function () {
                resolve({ path: 'images/' + Date.now() + '.jpg', base64: b64, w: img.width, h: img.height });
              };
              img.onerror = function () { resolve({ path: 'images/' + Date.now() + '.jpg', base64: b64, w: 0, h: 0 }); };
              img.src = url;
            };
            fr.readAsDataURL(f);
          };
          inp.click();
          return;
        }
        case 'openURL': window.open(p.url, '_blank'); resolve({}); return;
        case 'share': {
          if (navigator.share) navigator.share({ text: p.text }).catch(function () {});
          else if (navigator.clipboard) navigator.clipboard.writeText(p.text || '');
          resolve({}); return;
        }
        case 'haptic': resolve({}); return;
        default: reject(new Error('未知方法 ' + method)); return;
      }
    });
  }

  function mockStream(method, p, onChunk) {
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

  window.Native = {
    hasNative: hasNative,
    call: call,
    stream: stream
  };
})();
