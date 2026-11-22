/* 通用工具与 UI 组件：toast / 操作面板 / 弹窗 / 长按 / 时间格式化 */
window.U = (function () {
  const $ = function (s, root) { return (root || document).querySelector(s); };
  const $$ = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
  }

  function icon(name, cls) {
    return '<svg class="ico ' + (cls || '') + '"><use href="#i-' + name + '"/></svg>';
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtClock(ts) {
    const d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function fmtDateTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    if (sameYear) return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + fmtClock(ts);
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function startOfDay(ts) {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  /** 今天 / 昨天 / 10月8日 / 2025年10月8日 */
  function dayLabel(ts) {
    const today = startOfDay(Date.now());
    const t = startOfDay(ts);
    const diff = Math.round((today - t) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    const d = new Date(ts);
    if (new Date().getFullYear() === d.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function relTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    return dayLabel(ts);
  }

  /** 毫秒 -> 0:05 / 12:03 / 1:02:03 */
  function fmtDur(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
    return m + ':' + pad(s);
  }

  function debounce(fn, wait) {
    let t = 0;
    const wrapped = function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait);
    };
    wrapped.cancel = function () { clearTimeout(t); };
    return wrapped;
  }

  function throttle(fn, wait) {
    let last = 0, timer = 0, lastArgs = null;
    return function () {
      lastArgs = arguments;
      const now = Date.now();
      const rest = wait - (now - last);
      if (rest <= 0) {
        last = now;
        fn.apply(this, lastArgs);
      } else if (!timer) {
        const self = this;
        timer = setTimeout(function () { timer = 0; last = Date.now(); fn.apply(self, lastArgs); }, rest);
      }
    };
  }

  /* ---------------------------------- toast --------------------------------- */

  let toastTimer = 0;
  function toast(msg) {
    const box = $('#toast');
    if (!box) return;
    box.textContent = msg;
    box.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove('on'); }, 1900);
  }

  /* ---------------------------------- 面板 ---------------------------------- */

  let sheetOpen = false;

  function closeSheet() {
    sheetOpen = false;
    $('#mask').classList.remove('on');
    $('#sheet').classList.remove('on');
    const wrap = $('#sheetWrap');
    if (wrap) wrap.style.pointerEvents = 'none';
  }

  /**
   * 底部操作面板
   * @param {{title?:string, note?:string, items?:Array, body?:HTMLElement|string, cancel?:boolean}} opts
   */
  function sheet(opts) {
    opts = opts || {};
    const sh = $('#sheet');
    const mask = $('#mask');
    let html = '<div class="sheet-grabber"></div>';
    if (opts.title) html += '<div class="sheet-title">' + esc(opts.title) + '</div>';
    if (opts.note) html += '<div class="sheet-note">' + esc(opts.note) + '</div>';
    if (opts.body) {
      html += '<div class="sheet-body"></div>';
    }
    if (opts.items && opts.items.length) {
      opts.items.forEach(function (it, i) {
        html += '<button class="sheet-item' + (it.danger ? ' danger' : '') + '" data-i="' + i + '"' +
          (it.disabled ? ' disabled' : '') + '>' +
          (it.icon ? icon(it.icon) : '') +
          '<span>' + esc(it.label) + '</span>' +
          (it.check ? '<span class="check">✓</span>' : (it.sub ? '<span class="sub">' + esc(it.sub) + '</span>' : '')) +
          '</button>';
      });
    }
    if (opts.cancel !== false) html += '<button class="sheet-cancel" data-cancel="1">取消</button>';
    sh.innerHTML = html;

    if (opts.body) {
      const holder = $('.sheet-body', sh);
      if (typeof opts.body === 'string') holder.innerHTML = opts.body;
      else holder.appendChild(opts.body);
    }

    $$('.sheet-item', sh).forEach(function (node) {
      node.addEventListener('click', function () {
        const idx = parseInt(node.getAttribute('data-i'), 10);
        const it = opts.items[idx];
        closeSheet();
        setTimeout(function () { if (it && it.onTap) it.onTap(); }, 30);
      });
    });
    const cancelBtn = $('.sheet-cancel', sh);
    if (cancelBtn) cancelBtn.addEventListener('click', closeSheet);

    $('#sheetWrap').style.pointerEvents = 'auto';
    mask.classList.add('on');
    sh.classList.add('on');
    sheetOpen = true;
  }

  /* ---------------------------------- 弹窗 ---------------------------------- */

  let modalResolve = null;

  function closeModal(value) {
    const wrap = $('#modalWrap');
    wrap.classList.remove('on');
    const fn = modalResolve;
    modalResolve = null;
    if (fn) fn(value);
  }

  function openModal(html, onMount) {
    const wrap = $('#modalWrap');
    const box = $('#modal');
    box.innerHTML = html;
    wrap.classList.add('on');
    if (onMount) onMount(box);
  }

  function alertBox(opts) {
    opts = typeof opts === 'string' ? { message: opts } : (opts || {});
    return new Promise(function (resolve) {
      modalResolve = resolve;
      openModal(
        '<h3>' + esc(opts.title || '提示') + '</h3>' +
        (opts.message ? '<p>' + esc(opts.message) + '</p>' : '') +
        '<div class="modal-btns"><button class="btn-line primary" data-ok="1">' + esc(opts.okText || '好') + '</button></div>',
        function (box) {
          $('[data-ok]', box).onclick = function () { closeModal(true); };
        });
    });
  }

  function confirmBox(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      modalResolve = resolve;
      openModal(
        '<h3>' + esc(opts.title || '确认') + '</h3>' +
        (opts.message ? '<p>' + esc(opts.message) + '</p>' : '') +
        '<div class="modal-btns">' +
        '<button class="btn-line" data-cancel="1">' + esc(opts.cancelText || '取消') + '</button>' +
        '<button class="btn-line ' + (opts.danger ? 'danger' : 'primary') + '" data-ok="1">' + esc(opts.okText || '确定') + '</button>' +
        '</div>',
        function (box) {
          $('[data-ok]', box).onclick = function () { closeModal(true); };
          $('[data-cancel]', box).onclick = function () { closeModal(false); };
        });
    });
  }

  /**
   * 输入弹窗，返回输入值（取消返回 null）
   * validate: (value) => string|null  返回错误文案
   */
  function promptBox(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      modalResolve = resolve;
      openModal(
        '<h3>' + esc(opts.title || '输入') + '</h3>' +
        (opts.message ? '<p>' + esc(opts.message) + '</p>' : '') +
        '<input id="__promptInput" type="' + (opts.inputType || 'text') + '" ' +
        (opts.maxlength ? 'maxlength="' + opts.maxlength + '" ' : '') +
        (opts.inputMode ? 'inputmode="' + opts.inputMode + '" ' : '') +
        'placeholder="' + esc(opts.placeholder || '') + '" value="' + esc(opts.value || '') + '">' +
        '<div class="hint" id="__promptHint">' + esc(opts.hint || '') + '</div>' +
        '<div class="modal-btns">' +
        '<button class="btn-line" data-cancel="1">取消</button>' +
        '<button class="btn-line primary" data-ok="1">' + esc(opts.okText || '确定') + '</button>' +
        '</div>',
        function (box) {
          const input = $('#__promptInput', box);
          const hint = $('#__promptHint', box);
          const submit = function () {
            let v = input.value;
            if (opts.trim !== false) v = v.trim();
            if (opts.validate) {
              const err = opts.validate(v);
              if (err) {
                hint.textContent = err;
                hint.classList.add('error');
                box.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' },
                  { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 180 });
                return;
              }
            }
            closeModal(v);
          };
          $('[data-ok]', box).onclick = submit;
          $('[data-cancel]', box).onclick = function () { closeModal(null); };
          input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
          });
          input.addEventListener('input', function () {
            hint.classList.remove('error');
            if (opts.hint) hint.textContent = opts.hint;
          });
          setTimeout(function () { input.focus(); input.select(); }, 60);
        });
    });
  }

  /* --------------------------------- 长按 --------------------------------- */

  let suppressClickUntil = 0;

  function longPress(node, cb, delay) {
    let timer = 0, sx = 0, sy = 0, fired = false;
    const start = function (e) {
      if (e.touches && e.touches.length > 1) return;
      fired = false;
      const p = e.touches ? e.touches[0] : e;
      sx = p.clientX; sy = p.clientY;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fired = true;
        suppressClickUntil = Date.now() + 700;
        haptic();
        cb(e);
      }, delay || 480);
    };
    const move = function (e) {
      const p = e.touches ? e.touches[0] : e;
      if (Math.abs(p.clientX - sx) > 10 || Math.abs(p.clientY - sy) > 10) clearTimeout(timer);
    };
    const end = function () { clearTimeout(timer); };
    node.addEventListener('touchstart', start, { passive: true });
    node.addEventListener('touchmove', move, { passive: true });
    node.addEventListener('touchend', end);
    node.addEventListener('touchcancel', end);
    node.addEventListener('contextmenu', function (e) {
      // 桌面右键 / iOS 长按产生的 contextmenu 也当成一次长按
      e.preventDefault();
      if (fired) return;
      fired = true;
      suppressClickUntil = Date.now() + 700;
      haptic();
      cb(e);
    });
  }

  function haptic() {
    try { if (window.Native) Native.call('haptic'); } catch (e) { /* ignore */ }
  }

  /* --------------------------------- 剪贴板 -------------------------------- */

  async function copy(text) {
    text = String(text == null ? '' : text);
    try {
      if (window.Native && Native.hasNative) {
        await Native.call('clip.set', { text: text });
        return true;
      }
    } catch (e) { /* fall through */ }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (e) { return false; }
  }

  /* --------------------------------- 文本 --------------------------------- */

  function highlight(text, q) {
    const t = String(text || '');
    if (!q) return esc(t);
    const lower = t.toLowerCase();
    const needle = q.toLowerCase();
    let idx = lower.indexOf(needle);
    if (idx < 0) return esc(t);
    let out = '';
    let from = 0;
    while (idx >= 0) {
      out += esc(t.slice(from, idx)) + '<mark>' + esc(t.slice(idx, idx + q.length)) + '</mark>';
      from = idx + q.length;
      idx = lower.indexOf(needle, from);
    }
    out += esc(t.slice(from));
    return out;
  }

  /** 从 HTML 里取纯文本（预览、搜索、复制用） */
  function htmlToText(html) {
    if (!html) return '';
    const d = document.createElement('div');
    d.innerHTML = String(html)
      .replace(/<\/(div|p|h\d|li|tr)>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ');
    d.querySelectorAll('img').forEach(function (im) {
      const isSticker = im.getAttribute('data-asset');
      im.replaceWith(document.createTextNode(isSticker ? ' [贴纸] ' : ' [图片] '));
    });
    d.querySelectorAll('.vn-audio').forEach(function (a) {
      const dur = parseInt(a.getAttribute('data-dur') || '0', 10);
      a.replaceWith(document.createTextNode(' [语音 ' + Math.round(dur / 1000) + 's] '));
    });
    return (d.textContent || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
  }

  function clampText(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  /* --------------------------------- 其它 --------------------------------- */

  function isDark() {
    return document.body.classList.contains('dark');
  }

  function cssVar(name) {
    return getComputedStyle(document.body).getPropertyValue(name).trim();
  }

  function scrollToBottom(node, smooth) {
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }

  function isNearBottom(node, pad) {
    if (!node) return true;
    return node.scrollHeight - node.scrollTop - node.clientHeight < (pad || 120);
  }

  function vibrate() { haptic(); }

  document.addEventListener('click', function (e) {
    if (Date.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  document.addEventListener('DOMContentLoaded', function () {
    $('#mask').addEventListener('click', closeSheet);
    const wrap = $('#modalWrap');
    wrap.addEventListener('click', function (e) { if (e.target === wrap) closeModal(null); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if ($('#modalWrap').classList.contains('on')) closeModal(null);
        else if (sheetOpen) closeSheet();
      }
    });
  });

  return {
    $: $, $$: $$, esc: esc, el: el, icon: icon,
    pad: pad, fmtClock: fmtClock, fmtDateTime: fmtDateTime, dayLabel: dayLabel,
    startOfDay: startOfDay, relTime: relTime, fmtDur: fmtDur,
    debounce: debounce, throttle: throttle,
    toast: toast,
    sheet: sheet, closeSheet: closeSheet,
    alert: alertBox, confirm: confirmBox, prompt: promptBox,
    closeModal: closeModal,
    longPress: longPress, haptic: haptic, copy: copy,
    highlight: highlight, htmlToText: htmlToText, clampText: clampText,
    isDark: isDark, cssVar: cssVar,
    scrollToBottom: scrollToBottom, isNearBottom: isNearBottom
  };
})();
