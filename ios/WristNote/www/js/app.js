/* 应用入口：视图栈、主题、启动 */
window.App = (function () {
  const $ = function (s) { return document.querySelector(s); };

  const VIEWS = {
    home: 'v-home',
    editor: 'v-editor',
    settings: 'v-settings',
    'settings-page': 'v-settings-page',
    trash: 'v-trash',
    voice: 'v-voice',
    chat: 'v-chat'
  };

  let stack = [];
  let info = { version: '1.0.0', ios: '', dark: false };
  let current = '';

  function viewEl(name) { return document.getElementById(VIEWS[name]); }

  function onShow(name, opts) {
    if (name === 'home') Home.render();
    else if (name === 'settings') Settings.renderRoot();
    else if (name === 'settings-page') Settings.renderPage();
    else if (name === 'trash') Trash.render();
    else if (name === 'voice') Voice.render();
    else if (name === 'chat') Chat.onShow();
    else if (name === 'editor') Editor.onShow();
  }

  function onHide(name) {
    if (name === 'voice') Voice.onHide();
    else if (name === 'chat') Chat.onHide();
    else if (name === 'editor') Editor.onHide();
  }

  function show(name, opts) {
    if (!VIEWS[name]) return;
    if (current === name) { onShow(name, opts); return; }
    const prev = current ? viewEl(current) : null;
    const next = viewEl(name);
    if (prev) {
      // 切换页面时收起键盘，避免输入框被藏起来后键盘还挂着
      const ae = document.activeElement;
      if (ae && ae !== document.body && prev.contains(ae) && ae.blur) ae.blur();
      prev.classList.remove('on');
      prev.classList.add('behind');
    }
    next.classList.remove('behind');
    // 强制 reflow，让滑动动画从右侧开始
    void next.offsetWidth;
    next.classList.add('on');
    if (current) stack.push(current);
    current = name;
    onShow(name, opts);
    if (opts && opts.scrollTop) next.querySelector('.scroll').scrollTop = 0;
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
    if (cur) {
      cur.classList.remove('on');
    }
    prev.classList.remove('behind');
    prev.classList.add('on');
    current = prevName;
    onShow(prevName);
  }

  function backTo(name) {
    while (stack.length) {
      const prev = stack[stack.length - 1];
      if (prev === name) { back(); return; }
      back();
    }
    if (current !== name) show(name);
  }

  function reset(name) {
    const ae0 = document.activeElement;
    if (ae0 && ae0 !== document.body && ae0.blur) ae0.blur();
    Object.keys(VIEWS).forEach(function (k) {
      const el = viewEl(k);
      if (!el) return;
      el.classList.remove('on', 'behind');
    });
    stack = [];
    current = name;
    viewEl(name).classList.add('on');
    onShow(name);
  }

  /* ------------------------------- 主题 ------------------------------- */

  let systemDark = false;

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
    // 编辑器纸张背景跟随主题
    if (window.Editor) Editor.applyPaper();
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

    // 启动时的主题选择
    applyTheme();

    Home.init();
    Editor.init();
    Settings.init();
    Trash.init();
    Voice.init();
    Chat.init();

    reset('home');

    // 恢复没保存完的录音
    setTimeout(function () { Voice.checkRecovery(); }, 900);

    if (info.ios === 'web-preview') {
      Store.log('web 预览模式启动');
    } else {
      Store.log('启动 v' + info.version + ' iOS ' + info.ios + ' ' + (info.model || '') +
        ' ' + info.width + 'x' + info.height + '@' + info.scale);
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        Store.flush();
        Voice.onHide();
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
    show: show, back: back, backTo: backTo, reset: reset,
    applyTheme: applyTheme, setSystemDark: setSystemDark,
    versionText: versionText, deviceInfo: deviceInfo,
    current: function () { return current; },
    stack: function () { return stack.slice(); }
  };
})();
