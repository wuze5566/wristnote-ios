/* 应用入口：对话为首屏，设置是二级页 */
window.App = (function () {
  const VIEWS = { chat: 'v-chat', settings: 'v-settings' };

  let stack = [];
  let info = { version: '1.0.0', ios: '', dark: false };
  let current = '';
  let systemDark = false;

  function viewEl(name) { return document.getElementById(VIEWS[name]); }

  function onShow(name) {
    if (name === 'chat') Chat.onShow();
    else if (name === 'settings') Settings.render();
  }

  function onHide(name) {
    if (name === 'chat') Chat.onHide();
  }

  function show(name) {
    if (!VIEWS[name] || current === name) {
      if (current === name) onShow(name);
      return;
    }
    const prev = current ? viewEl(current) : null;
    const next = viewEl(name);
    if (prev) {
      const ae = document.activeElement;
      if (ae && ae !== document.body && prev.contains(ae) && ae.blur) ae.blur();
      prev.classList.remove('on');
      prev.classList.add('behind');
    }
    next.classList.remove('behind');
    void next.offsetWidth;
    next.classList.add('on');
    if (current) stack.push(current);
    current = name;
    onShow(name);
  }

  function back(fallback) {
    const prevName = stack.pop();
    const cur = current ? viewEl(current) : null;
    if (!prevName) {
      if (fallback) show(fallback);
      return;
    }
    const prev = viewEl(prevName);
    const ae = document.activeElement;
    if (ae && ae !== document.body && ae.blur) ae.blur();
    onHide(current);
    if (cur) cur.classList.remove('on');
    prev.classList.remove('behind');
    prev.classList.add('on');
    current = prevName;
    onShow(prevName);
  }

  function reset(name) {
    const ae = document.activeElement;
    if (ae && ae !== document.body && ae.blur) ae.blur();
    Object.keys(VIEWS).forEach(function (k) {
      const el = viewEl(k);
      if (el) el.classList.remove('on', 'behind');
    });
    stack = [];
    current = name;
    viewEl(name).classList.add('on');
    onShow(name);
  }

  /* ------------------------------- 主题 ------------------------------- */

  function applyTheme() {
    const t = Store.settings().theme;
    let dark;
    if (t === 1) dark = false;
    else if (t === 2) dark = true;
    else dark = systemDark;
    document.body.classList.toggle('dark', dark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#121316' : '#FFFFFF');
    try { Native.call('ui.appearance', { dark: dark }); } catch (e) { /* ignore */ }
  }

  function setSystemDark(v) {
    systemDark = !!v;
    if ((Store.settings().theme || 0) === 0) applyTheme();
  }

  /* ------------------------------- 启动 ------------------------------- */

  async function boot() {
    try {
      info = await Native.call('info', {});
    } catch (e) {
      info = { version: '1.0.0', ios: 'n/a', dark: false };
    }
    systemDark = !!info.dark;
    try {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      systemDark = mq.matches;
      const onMq = function (e) { setSystemDark(e.matches); };
      if (mq.addEventListener) mq.addEventListener('change', onMq);
      else if (mq.addListener) mq.addListener(onMq);
    } catch (e) { /* ignore */ }
    try {
      await Store.init();
    } catch (e) {
      U.toast('数据读取失败：' + (e.message || e));
    }

    applyTheme();
    Settings.init();
    Chat.init();
    reset('chat');

    Store.log('启动 v' + info.version + ' iOS ' + info.ios + ' ' + (info.model || '') +
      ' ' + info.width + 'x' + info.height + '@' + info.scale);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        Store.flush();
        Chat.onHide();
      } else if (current === 'chat') {
        Chat.onShow();
      }
    });
    window.addEventListener('pagehide', function () { Store.flush(); });
    setInterval(function () { Store.flush(); }, 8000);
  }

  function versionText() {
    return 'v' + (info.version || '1.0.0') + '（正式版）';
  }

  function deviceInfo() { return info; }

  document.addEventListener('DOMContentLoaded', boot);

  return {
    show: show, back: back, reset: reset,
    applyTheme: applyTheme, setSystemDark: setSystemDark,
    versionText: versionText, deviceInfo: deviceInfo,
    current: function () { return current; }
  };
})();
