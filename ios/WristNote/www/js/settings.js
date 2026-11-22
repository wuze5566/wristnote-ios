/* 设置：模型 / 推理强度 / 余额 / API / 外观 / 诊断 */
window.Settings = (function () {
  const $ = U.$;

  function init() {
    $('#setBack').addEventListener('click', function () { App.back('chat'); });
  }

  function makeSection(title, rows) {
    const sec = document.createElement('div');
    sec.className = 'section';
    if (title) {
      const h = document.createElement('div');
      h.className = 'section-title';
      h.textContent = title;
      sec.appendChild(h);
    }
    const group = document.createElement('div');
    group.className = 'group';
    rows.forEach(function (r) { if (r) group.appendChild(r); });
    sec.appendChild(group);
    return sec;
  }

  function makeRow(opts) {
    const row = document.createElement('button');
    row.className = 'row';
    let html = '';
    if (opts.icon) html += '<span class="row-icon">' + U.icon(opts.icon) + '</span>';
    html += '<span class="row-main"><span class="row-title">' + U.esc(opts.title) + '</span></span>';
    if (opts.switchOn !== undefined) html += '<span class="switch' + (opts.switchOn ? ' on' : '') + '"></span>';
    else {
      if (opts.value !== undefined) html += '<span class="row-value">' + U.esc(opts.value) + '</span>';
      html += '<span class="row-chev">' + U.icon('chevron') + '</span>';
    }
    row.innerHTML = html;
    if (opts.onTap) row.addEventListener('click', function () { U.haptic(); opts.onTap(); });
    return row;
  }

  function themeName(v) {
    return v === 1 ? '浅色' : v === 2 ? '深色' : '跟随系统';
  }

  function render() {
    const s = Store.settings();
    const list = $('#setList');
    list.innerHTML = '';

    list.appendChild(makeSection('对话', [
      makeRow({
        title: '模型', value: s.chatModel, icon: 'spark', onTap: function () {
          U.sheet({
            title: '模型',
            items: ['deepseek-flash', 'deepseek-chat', 'deepseek-reasoner'].map(function (m) {
              return {
                label: m, check: s.chatModel === m, onTap: function () {
                  Store.setSetting('chatModel', m);
                  Store.flush();
                  render();
                  Chat.refreshChips();
                }
              };
            }).concat([{
              icon: 'edit', label: '自定义模型名', onTap: function () {
                U.prompt({ title: '模型', value: s.chatModel, placeholder: 'deepseek-flash', maxlength: 60, okText: '保存' })
                  .then(function (v) {
                    if (!v) return;
                    Store.setSetting('chatModel', v);
                    Store.flush();
                    render();
                    Chat.refreshChips();
                  });
              }
            }])
          });
        }
      }),
      makeRow({
        title: '推理强度', value: s.chatEffort, icon: 'info', onTap: function () {
          U.sheet({
            title: '推理强度',
            items: [
              { id: 'off', label: '关闭思考（off）' },
              { id: 'low', label: '低（low）' },
              { id: 'high', label: '高（high）' },
              { id: 'max', label: '最高（max）' }
            ].map(function (e) {
              return {
                label: e.label, check: s.chatEffort === e.id, onTap: function () {
                  Store.setSetting('chatEffort', e.id);
                  Store.flush();
                  render();
                  Chat.refreshChips();
                }
              };
            })
          });
        }
      }),
      makeRow({
        title: '账户余额', value: s.lastBalance || '未查询', icon: 'key', onTap: function () {
          if (!Api.hasKey()) { U.toast('还没有填 API Key'); return; }
          U.toast('查询中…');
          Api.balance().then(function (b) {
            Store.setSetting('lastBalance', b.display);
            Store.flush();
            render();
            U.toast('余额 ' + b.display);
          }).catch(function (e) {
            U.toast('查询失败：' + (e.message || ''));
          });
        }
      }),
      makeRow({
        title: 'DeepSeek API Key', value: s.apiKey ? '已设置' : '未设置', icon: 'key',
        onTap: function () {
          U.prompt({
            title: 'DeepSeek API Key', placeholder: 'sk-...', value: s.apiKey || '',
            maxlength: 200, okText: '保存'
          }).then(function (v) {
            if (v === null) return;
            Store.setSetting('apiKey', v.trim());
            Store.flush();
            render();
            U.toast(v.trim() ? 'API Key 已保存' : 'API Key 已清空');
          });
        }
      }),
      makeRow({
        title: '测试连接', value: '点一下验证 Key', icon: 'check', onTap: function () {
          if (!Api.hasKey()) { U.toast('还没有填 API Key'); return; }
          U.toast('测试中…');
          Api.models().then(function (list) {
            U.toast('连接正常 · ' + list.length + ' 个模型');
          }).catch(function (e) {
            U.toast('连接失败：' + (e.message || ''));
          });
        }
      }),
      makeRow({
        title: '接口地址', value: s.apiBase, icon: 'doc', onTap: function () {
          U.prompt({
            title: '接口地址', value: s.apiBase, placeholder: 'https://api.deepseek.com',
            maxlength: 200, okText: '保存'
          }).then(function (v) {
            if (v === null) return;
            Store.setSetting('apiBase', v.trim() || 'https://api.deepseek.com');
            Store.flush();
            render();
          });
        }
      })
    ]));

    list.appendChild(makeSection('外观', [
      makeRow({
        title: '外观', value: themeName(s.theme), icon: 'palette', onTap: function () {
          U.sheet({
            title: '外观',
            items: [['跟随系统', 0], ['浅色', 1], ['深色', 2]].map(function (pair) {
              return {
                label: pair[0], check: (s.theme || 0) === pair[1], onTap: function () {
                  Store.setSetting('theme', pair[1]);
                  Store.flush();
                  App.applyTheme();
                  render();
                }
              };
            })
          });
        }
      })
    ]));

    list.appendChild(makeSection('其他', [
      makeRow({
        title: '记录诊断日志', switchOn: s.diagnostics !== false, onTap: function () {
          const next = !(s.diagnostics !== false);
          Store.setSetting('diagnostics', next);
          Store.flush();
          render();
          U.toast(next ? '已开启诊断日志' : '已关闭诊断日志');
        }
      }),
      makeRow({ title: '诊断日志', value: '', icon: 'info', onTap: showLog }),
      makeRow({ title: '版本号', value: App.versionText(), icon: 'info', onTap: null }),
      makeRow({
        title: '联系我', value: 'wuze5566@outlook.com', icon: 'edit', onTap: function () {
          U.copy('wuze5566@outlook.com').then(function () { U.toast('邮箱已复制'); });
        }
      })
    ]));

    const foot = document.createElement('div');
    foot.className = 'version-line';
    foot.textContent = App.versionText();
    list.appendChild(foot);
  }

  async function showLog() {
    const body = document.createElement('div');
    body.innerHTML = '<pre class="log-box" id="diagText" style="margin:0 18px 10px;max-height:46vh">读取中…</pre>' +
      '<div class="log-actions" style="padding:0 18px 8px">' +
      '<button class="btn-line" id="diagCopy">复制</button>' +
      '<button class="btn-line" id="diagClear">清空</button>' +
      '</div>';
    U.sheet({ title: '诊断日志', body: body, cancel: true });

    async function load() {
      const el = document.getElementById('diagText');
      if (!el) return;
      try {
        const r = await Native.call('log.read', {});
        el.textContent = (r && r.text) ? r.text : '（还没有日志）';
      } catch (e) {
        el.textContent = '读取失败：' + (e.message || '');
      }
    }
    await load();
    const copy = document.getElementById('diagCopy');
    const clear = document.getElementById('diagClear');
    if (copy) copy.onclick = async function () {
      const r = await Native.call('log.read', {});
      await U.copy((r && r.text) || '');
      U.toast('日志已复制');
    };
    if (clear) clear.onclick = async function () {
      await Native.call('log.clear', {});
      load();
      U.toast('日志已清空');
    };
  }

  return { init: init, render: render };
})();
