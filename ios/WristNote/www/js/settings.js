/* 设置：基础 / 个性化 / 偏好 / 语音与识别 / 其他 */
window.Settings = (function () {
  const $ = U.$;

  const state = { page: '' };
  const PAGE_TITLES = {
    basic: '基础设置',
    personal: '个性化设置',
    prefs: '偏好设置',
    voice: '语音与识别',
    other: '其他',
    diag: '诊断日志'
  };

  function init() {
    $('#stBack').addEventListener('click', function () { App.back('home'); });
    $('#spBack').addEventListener('click', function () { App.back('settings'); });
  }

  /* ------------------------------- 组件 ------------------------------- */

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
    const row = document.createElement(opts.action || opts.onTap ? 'button' : 'div');
    row.className = 'row' + (opts.danger ? ' danger' : '') + (opts.static ? ' static' : '');
    let html = '';
    if (opts.icon) html += '<span class="row-icon">' + U.icon(opts.icon) + '</span>';
    html += '<span class="row-main"><span class="row-title">' + U.esc(opts.title) + '</span>' +
      (opts.sub ? '<span class="row-sub">' + U.esc(opts.sub) + '</span>' : '') + '</span>';
    if (opts.switchOn !== undefined) {
      html += '<span class="switch' + (opts.switchOn ? ' on' : '') + '"></span>';
    } else {
      if (opts.value !== undefined && opts.value !== null) html += '<span class="row-value">' + U.esc(opts.value) + '</span>';
      if (opts.mark !== undefined) html += '<span class="row-mark' + (opts.mark ? '' : ' off') + '">' + (opts.mark ? '✓' : '✗') + '</span>';
      if (opts.chev) html += '<span class="row-chev">' + U.icon('chevron') + '</span>';
    }
    row.innerHTML = html;
    if (opts.onTap) row.addEventListener('click', function () { U.haptic(); opts.onTap(); });
    return row;
  }

  /* ------------------------------- 目录 ------------------------------- */

  function renderRoot() {
    const list = $('#stList');
    list.innerHTML = '';

    list.appendChild(makeSection('', [
      makeRow({
        title: '基础设置', icon: 'palette', chev: true, onTap: function () { openPage('basic'); }
      }),
      makeRow({
        title: '个性化设置', icon: 'edit', chev: true, onTap: function () { openPage('personal'); }
      }),
      makeRow({
        title: '偏好设置', icon: 'keyboard', chev: true, onTap: function () { openPage('prefs'); }
      }),
      makeRow({
        title: '语音与识别', icon: 'mic', chev: true, onTap: function () { openPage('voice'); }
      }),
      makeRow({
        title: '其他', icon: 'info', chev: true, onTap: function () { openPage('other'); }
      })
    ]));

    const info = App.deviceInfo();
    const foot = document.createElement('div');
    foot.className = 'version-line';
    foot.textContent = App.versionText();
    list.appendChild(foot);
  }

  function openPage(key) {
    state.page = key;
    $('#spTitle').textContent = PAGE_TITLES[key] || '设置';
    App.show('settings-page');
  }

  function renderPage() {
    const key = state.page;
    const body = $('#spBody');
    $('#spTitle').textContent = PAGE_TITLES[key] || '设置';
    body.innerHTML = '';
    if (key === 'basic') renderBasic(body);
    else if (key === 'personal') renderPersonal(body);
    else if (key === 'prefs') renderPrefs(body);
    else if (key === 'voice') renderVoice(body);
    else if (key === 'other') renderOther(body);
    else if (key === 'diag') renderDiag(body);
  }

  /* ------------------------------- 基础 ------------------------------- */

  function themeName(v) {
    return v === 1 ? '浅色' : v === 2 ? '深色' : '跟随系统';
  }

  function renderBasic(body) {
    const s = Store.settings();
    body.appendChild(makeSection('', [
      makeRow({
        title: '外观', value: themeName(s.theme), chev: true, onTap: function () {
          U.sheet({
            title: '外观',
            items: [['跟随系统', 0], ['浅色', 1], ['深色', 2]].map(function (pair) {
              return {
                label: pair[0], check: (s.theme || 0) === pair[1], onTap: function () {
                  Store.setSetting('theme', pair[1]);
                  Store.flush();
                  App.applyTheme();
                  renderPage();
                }
              };
            })
          });
        }
      }),
      makeRow({
        title: '字号大小',
        value: s.editorFontPx ? (s.editorFontPx + ' px') : '默认（17 px）',
        chev: true, onTap: function () {
          U.prompt({
            title: '字号大小（px）',
            message: '输入 8 到 72 的整数',
            value: String(s.editorFontPx || 17),
            inputMode: 'numeric', okText: '保存', maxlength: 2,
            validate: function (v) {
              if (!/^\d+$/.test(v)) return '请输入整数';
              const n = parseInt(v, 10);
              if (n < 8 || n > 72) return '请输入 8 到 72 之间的整数';
              return null;
            }
          }).then(function (v) {
            if (v === null) return;
            Store.setSetting('editorFontPx', parseInt(v, 10));
            Store.flush();
            Editor.applyFont();
            renderPage();
            U.toast('字号已设为 ' + v + ' px');
          });
        }
      }),
      makeRow({ title: '版本号', value: App.versionText(), static: true })
    ]));
  }

  /* ------------------------------- 个性化 ------------------------------- */

  function bgLabel() {
    const s = Store.settings();
    if (s.noteBgType === 1) return '纯色';
    if (s.noteBgType === 2) return '图片';
    return '默认';
  }

  function renderPersonal(body) {
    const s = Store.settings();
    body.appendChild(makeSection('外观与纸张', [
      makeRow({
        title: '文字支持16进制颜色',
        switchOn: !!s.hexColor, onTap: function () {
          const next = !s.hexColor;
          Store.setSetting('hexColor', next);
          Store.flush();
          renderPage();
          U.toast(next ? '已开启 16 进制颜色' : '已关闭 16 进制颜色');
        }
      }),
      makeRow({
        title: '备忘录背景', value: bgLabel(), chev: true, onTap: function () {
          U.sheet({
            title: '备忘录背景',
            items: [
              {
                icon: 'close', label: '默认', check: (s.noteBgType || 0) === 0, onTap: function () {
                  Store.setSetting('noteBgType', 0);
                  Store.flush();
                  Editor.applyPaper();
                  renderPage();
                  U.toast('已恢复默认背景');
                }
              },
              {
                icon: 'palette', label: '纯色', onTap: function () {
                  U.prompt({
                    title: '背景颜色', placeholder: '#F5F5F6', value: s.noteBgColor || '#F5F5F6',
                    maxlength: 7, okText: '确定',
                    validate: function (v) {
                      return /^#?[0-9a-fA-F]{6}$/.test(v) ? null : '颜色格式不对，请输入 #RRGGBB';
                    }
                  }).then(function (v) {
                    if (!v) return;
                    if (v.charAt(0) !== '#') v = '#' + v;
                    Store.setSetting('noteBgType', 1);
                    Store.setSetting('noteBgColor', v);
                    Store.flush();
                    Editor.applyPaper();
                    renderPage();
                    U.toast('已设置背景');
                  });
                }
              },
              {
                icon: 'image', label: '图片', onTap: function () {
                  Native.call('photo.pick', {}).then(function (r) {
                    Store.setSetting('noteBgType', 2);
                    Store.setSetting('noteBgImage', r.path);
                    Store.flush();
                    Editor.applyPaper();
                    renderPage();
                    U.toast('已设置背景');
                  }).catch(function (e) {
                    if (String(e.message || '').indexOf('取消') < 0) U.toast('背景图片读取失败');
                  });
                }
              },
              {
                icon: 'trash', label: '清除背景', danger: true, onTap: function () {
                  Store.setSetting('noteBgType', 0);
                  Store.setSetting('noteBgImage', '');
                  Store.flush();
                  Editor.applyPaper();
                  renderPage();
                  U.toast('已恢复默认背景');
                }
              }
            ]
          });
        }
      })
    ]));

  }

  /* ------------------------------- 偏好 ------------------------------- */

  function renderPrefs(body) {
    const s = Store.settings();
    body.appendChild(makeSection('编辑与录音', [
      makeRow({
        title: '进入备忘录自动打开键盘', switchOn: !!s.autoKeyboard, onTap: function () {
          Store.setSetting('autoKeyboard', !s.autoKeyboard);
          Store.flush();
          renderPage();
        }
      }),
      makeRow({
        title: '收起键盘自动隐藏光标', switchOn: !!s.hideCursor, onTap: function () {
          Store.setSetting('hideCursor', !s.hideCursor);
          Store.flush();
          renderPage();
        }
      }),
      makeRow({
        title: '保存方式', value: s.saveMode === 1 ? '保存按键保存' : '输入即存', chev: true,
        onTap: function () {
          U.sheet({
            title: '保存方式',
            items: [
              {
                icon: 'check', label: '输入即存', check: s.saveMode !== 1, onTap: function () {
                  Store.setSetting('saveMode', 0);
                  Store.flush();
                  renderPage();
                }
              },
              {
                icon: 'check', label: '保存按键保存', check: s.saveMode === 1, onTap: function () {
                  Store.setSetting('saveMode', 1);
                  Store.flush();
                  renderPage();
                }
              }
            ]
          });
        }
      }),
      makeRow({
        title: '录音自动保存间隔', value: (s.voiceChunk || 5) + ' 秒', chev: true,
        onTap: function () {
          U.sheet({
            title: '录音自动保存间隔',
            items: [3, 5, 10, 15].map(function (sec) {
              return {
                label: sec + ' 秒', check: (s.voiceChunk || 5) === sec, onTap: function () {
                  Store.setSetting('voiceChunk', sec);
                  Store.flush();
                  renderPage();
                }
              };
            })
          });
        }
      })
    ]));
  }

  /* ------------------------------- 语音与识别 ------------------------------- */

  function renderVoice(body) {
    const s = Store.settings();
    body.appendChild(makeSection('DeepSeek', [
      makeRow({
        title: 'DeepSeek API Key',
        value: s.apiKey ? '已设置' : '未设置',
        chev: true,
        onTap: function () {
          U.prompt({
            title: 'DeepSeek API Key',
            placeholder: 'sk-...',
            value: s.apiKey || '',
            maxlength: 200,
            okText: '保存'
          }).then(function (v) {
            if (v === null) return;
            Store.setSetting('apiKey', v.trim());
            Store.flush();
            renderPage();
            U.toast(v.trim() ? 'API Key 已保存' : 'API Key 已清空');
          });
        }
      }),
      makeRow({
        title: '模型', value: s.apiModel || 'deepseek-flash', chev: true,
        onTap: function () {
          const models = ['deepseek-flash', 'deepseek-chat', 'deepseek-reasoner'];
          const items = models.map(function (m) {
            return {
              label: m, check: (s.apiModel || 'deepseek-flash') === m, onTap: function () {
                Store.setSetting('apiModel', m);
                Store.flush();
                renderPage();
              }
            };
          });
          items.push({
            icon: 'edit', label: '自定义模型名', onTap: function () {
              U.prompt({
                title: '模型', placeholder: 'deepseek-flash', value: s.apiModel || 'deepseek-flash',
                maxlength: 60, okText: '保存'
              }).then(function (v) {
                if (!v) return;
                Store.setSetting('apiModel', v);
                Store.flush();
                renderPage();
              });
            }
          });
          U.sheet({ title: '模型', items: items });
        }
      }),
      makeRow({
        title: '账户余额', value: s.lastBalance || '未查询', chev: true,
        onTap: function () {
          if (!Api.hasKey()) { U.toast('还没有填 API Key'); return; }
          U.toast('查询中…');
          Api.balance().then(function (b) {
            Store.setSetting('lastBalance', b.display);
            Store.flush();
            renderPage();
            U.toast('余额 ' + b.display);
          }).catch(function (e) {
            U.toast('查询失败：' + (e.message || ''));
          });
        }
      }),
      makeRow({
        title: '接口地址', value: s.apiBase || 'https://api.deepseek.com', chev: true,
        onTap: function () {
          U.prompt({
            title: '接口地址', placeholder: 'https://api.deepseek.com',
            value: s.apiBase || 'https://api.deepseek.com', maxlength: 200, okText: '保存'
          }).then(function (v) {
            if (v === null) return;
            Store.setSetting('apiBase', v.trim() || 'https://api.deepseek.com');
            Store.flush();
            renderPage();
          });
        }
      })
    ]));
  }

  /* ------------------------------- 其他 ------------------------------- */

  function renderOther(body) {
    const s = Store.settings();
    body.appendChild(makeSection('应用', [
      makeRow({ title: '版本号', value: App.versionText(), static: true }),
      makeRow({
        title: '联系我', value: 'wuze5566@outlook.com', chev: true,
        onTap: function () {
          U.copy('wuze5566@outlook.com').then(function () { U.toast('邮箱已复制'); });
        }
      }),
      makeRow({
        title: '记录诊断日志', switchOn: s.diagnostics !== false,
        onTap: function () {
          const next = !(s.diagnostics !== false);
          Store.setSetting('diagnostics', next);
          Store.flush();
          renderPage();
          U.toast(next ? '已开启诊断日志' : '已关闭诊断日志');
        }
      }),
      makeRow({
        title: '诊断日志', chev: true, onTap: function () {
          state.page = 'diag';
          App.show('settings-page');
        }
      })
    ]));
  }

  async function renderDiag(body) {
    const box = document.createElement('div');
    box.className = 'section';
    box.innerHTML = '<div class="section-title">诊断日志</div><div class="group" style="padding:12px">' +
      '<div class="log-box" id="diagText">读取中…</div>' +
      '<div class="log-actions">' +
      '<button class="btn-line" id="diagCopy">复制</button>' +
      '<button class="btn-line" id="diagClear">清空</button>' +
      '<button class="btn-line primary" id="diagRefresh">刷新</button>' +
      '</div></div>';
    body.appendChild(box);

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
    document.getElementById('diagCopy').onclick = async function () {
      const r = await Native.call('log.read', {});
      await U.copy((r && r.text) || '');
      U.toast('日志已复制');
    };
    document.getElementById('diagClear').onclick = async function () {
      await Native.call('log.clear', {});
      load();
      U.toast('日志已清空');
    };
    document.getElementById('diagRefresh').onclick = load;
  }

  return {
    init: init, renderRoot: renderRoot, renderPage: renderPage, openPage: openPage,
    state: state
  };
})();
