/* 首页：搜索、分类、列表、长按菜单 */
window.Home = (function () {
  const $ = U.$;
  const state = { catId: 0, query: '', tag: '', starredOnly: false };

  function init() {
    $('#homeSearch').addEventListener('input', function () {
      state.query = this.value;
      const has = !!this.value;
      $('#homeSearchBar').classList.toggle('has-text', has);
      $('#homeChips').classList.toggle('hidden', has);
      renderList();
    });
    $('#homeSearchClear').addEventListener('click', function () {
      const input = $('#homeSearch');
      input.value = '';
      state.query = '';
      $('#homeSearchBar').classList.remove('has-text');
      $('#homeChips').classList.remove('hidden');
      input.blur();
      renderList();
    });
    $('#homeAdd').addEventListener('click', function () {
      U.haptic();
      const n = Store.createNote(state.catId);
      Editor.open(n.id);
    });
    $('#homeChat').addEventListener('click', function () { Chat.open(); });
    $('#homeVoice').addEventListener('click', function () { App.show('voice'); });
    $('#homeMore').addEventListener('click', showMore);
    $('#homeFilter').addEventListener('click', function () {
      state.tag = '';
      state.starredOnly = false;
      render();
    });
  }

  function render() {
    renderChips();
    renderFilter();
    renderList();
  }

  function renderChips() {
    const box = $('#homeChips');
    let html = '<button class="chip' + (state.catId === 0 ? ' on' : '') + '" data-cat="0">全部</button>';
    Store.categories().forEach(function (c) {
      html += '<button class="chip' + (state.catId === c.id ? ' on' : '') +
        '" data-cat="' + c.id + '" data-name="' + U.esc(c.name) + '">' + U.esc(c.name) + '</button>';
    });
    html += '<button class="chip add" id="chipAddCat">＋</button>';
    box.innerHTML = html;

    U.$$('.chip[data-cat]', box).forEach(function (chip) {
      const id = parseInt(chip.getAttribute('data-cat'), 10) || 0;
      chip.addEventListener('click', function () {
        state.catId = id;
        renderChips();
        renderList();
      });
      if (id) {
        U.longPress(chip, function () {
          const cat = Store.categoryById(id);
          if (cat) showCategorySheet(cat);
        });
      }
    });
    const add = $('#chipAddCat', box);
    if (add) add.addEventListener('click', addCategory);
  }

  function renderFilter() {
    const on = !!state.tag || state.starredOnly;
    $('#homeFilterRow').classList.toggle('on', on);
    if (on) {
      $('#homeFilter').textContent = state.tag ? ('＃' + state.tag + '   ×') : '★ 星标   ×';
    }
  }

  function renderList() {
    const list = Store.notes({
      catId: state.catId, q: state.query, tag: state.tag,
      starredOnly: state.starredOnly
    });
    const box = $('#homeList');
    const q = state.query.trim();
    $('#homeCount').textContent = list.length ? '· ' + list.length : '';

    if (!list.length) {
      let title = '还没有备忘', sub = '点右下角 ＋ 写下第一条', icon = 'edit';
      if (q) { title = '没有找到'; sub = '换个关键词或标签试试'; icon = 'search'; }
      else if (state.starredOnly || state.tag) { title = '没有找到'; sub = '点上面的筛选条取消筛选'; icon = 'tag'; }
      else if (state.catId) { title = '这里还是空的'; sub = '点 ＋ 记一条'; icon = 'edit'; }
      box.innerHTML = '<div class="empty">' + U.icon(icon) +
        '<div class="empty-title">' + U.esc(title) + '</div>' +
        '<div class="empty-sub">' + U.esc(sub) + '</div></div>';
      return;
    }

    const sortedByTitle = (Store.settings().sort || 0) === 2;
    let html = '';
    let lastDay = '';
    list.forEach(function (n) {
      if (!sortedByTitle) {
        const day = U.dayLabel(n.updated);
        if (day !== lastDay) {
          html += '<div class="list-date">' + U.esc(day) + '</div>';
          lastDay = day;
        }
      }
      const cat = Store.categoryById(n.catId);
      const title = Store.noteTitle(n);
      const snippet = n.plain || '';
      const hitIdx = q ? snippet.toLowerCase().indexOf(q.toLowerCase()) : -1;
      let snipHtml = '';
      if (snippet) {
        if (hitIdx > 0) {
          const from = Math.max(0, hitIdx - 14);
          snipHtml = (from > 0 ? '…' : '') + U.highlight(snippet.slice(from, from + 90), q) +
            (snippet.length > from + 90 ? '…' : '');
        } else {
          snipHtml = U.highlight(snippet.slice(0, 100), q);
        }
      }
      const tags = (n.tags || []).join(' · ');
      html += '<article class="note-card" data-id="' + n.id + '">' +
        (n.starred ? '<span class="note-star">' + U.icon('star') + '</span>' : '') +
        '<div class="note-title">' + U.esc(title) + '</div>' +
        (snipHtml ? '<div class="note-snippet' + (hitIdx >= 0 ? ' match' : '') + '">' + snipHtml + '</div>' : '') +
        '<div class="note-meta">' +
        (cat ? '<span class="note-cat"><i class="dot" style="background:' + U.esc(cat.color) + '"></i>' + U.esc(cat.name) + '</span>' : '') +
        (tags ? '<span class="note-tags">#' + U.esc(tags) + '</span>' : '') +
        '<span class="note-time">' + U.noteTimeLabel(n.updated) + '</span>' +
        '</div></article>';
    });
    box.innerHTML = html;

    U.$$('.note-card', box).forEach(function (card) {
      const id = parseInt(card.getAttribute('data-id'), 10);
      card.addEventListener('click', function () { Editor.open(id); });
      U.longPress(card, function () { showNoteSheet(id); });
    });
  }

  /* ------------------------------- 面板 ------------------------------- */

  function showNoteSheet(id) {
    const n = Store.noteById(id);
    if (!n) return;
    const title = Store.noteTitle(n);
    U.sheet({
      title: U.clampText(title, 18),
      items: [
        { icon: 'edit', label: '打开备忘', onTap: function () { Editor.open(id); } },
        {
          icon: 'star', label: n.starred ? '取消星标' : '加星标', onTap: function () {
            Store.toggleStar(id);
            renderList();
            U.toast(n.starred ? '已加星标' : '已取消星标');
          }
        },
        {
          icon: 'tag', label: '标签', onTap: function () {
            nameTags(id);
          }
        },
        {
          icon: 'folder', label: '移动分类', onTap: function () {
            pickCategory(id);
          }
        },
        {
          icon: 'copy', label: '复制全文', onTap: function () {
            const text = title + '\n\n' + (n.plain || '');
            U.copy(text).then(function (ok) { U.toast(ok ? '已复制到剪贴板' : '复制失败'); });
          }
        },
        {
          icon: 'share', label: '分享', onTap: function () {
            Native.call('share', { text: title + '\n\n' + (n.plain || ''), subject: title }).catch(function () {});
          }
        },
        {
          icon: 'trash', label: '删除', danger: true, onTap: function () {
            U.confirm({ title: '删除备忘', message: '删除后可在「回收站」里恢复。', okText: '删除', danger: true })
              .then(function (ok) {
                if (!ok) return;
                Store.trashNote(id);
                render();
                U.toast('已移到回收站');
              });
          }
        }
      ]
    });
  }

  function showCategorySheet(cat) {
    U.sheet({
      title: cat.name,
      items: [
        {
          icon: 'edit', label: '重命名分类', onTap: function () {
            U.prompt({
              title: '重命名分类', value: cat.name, maxlength: 8, okText: '保存',
              validate: function (v) {
                if (!v) return '请输入名称';
                if (Store.categoryNameExists(v, cat.id)) return '已有同名分类';
                return null;
              }
            }).then(function (v) {
              if (!v) return;
              Store.renameCategory(cat.id, v);
              render();
              U.toast('已重命名');
            });
          }
        },
        {
          icon: 'trash', label: '删除分类', danger: true, onTap: function () {
            U.confirm({
              title: '删除分类',
              message: '删除「' + cat.name + '」？该分类下的备忘会变成未分类。',
              okText: '删除', danger: true
            }).then(function (ok) {
              if (!ok) return;
              Store.removeCategory(cat.id);
              if (state.catId === cat.id) state.catId = 0;
              render();
              U.toast('已删除分类');
            });
          }
        }
      ]
    });
  }

  function showMore() {
    const trash = Store.trashCount();
    const sortNames = ['最近修改', '最近创建', '标题顺序'];
    U.sheet({
      title: '备忘',
      items: [
        {
          icon: 'sort', label: '排序', sub: sortNames[Store.settings().sort || 0],
          onTap: showSort
        },
        {
          icon: 'star', label: '只看星标', check: state.starredOnly, onTap: function () {
            state.starredOnly = !state.starredOnly;
            state.tag = '';
            render();
          }
        },
        {
          icon: 'tag', label: '按标签筛选', onTap: showTagFilter
        },
        {
          icon: 'restore', label: '回收站' + (trash ? '（' + trash + '）' : ''), onTap: function () {
            App.show('trash');
          }
        },
        { icon: 'plus', label: '新建分类', onTap: addCategory },
        { icon: 'settings', label: '设置', onTap: function () { App.show('settings'); } },
        {
          icon: 'info', label: '使用帮助', onTap: function () {
            U.alert({
              title: '使用帮助',
              message: '· 输入即自动保存，不用点保存。\n· 底部工具栏：A 改字色/高亮，B 加粗，□ 待办，图片，语音。\n' +
                '· 待办行以 □ 开头，点一下变成 ■ 并划掉。\n· 首页长按备忘：星标、标签、移动分类、删除。\n' +
                '· 长按顶部分类可以重命名或删除。\n· 右上角 ⋯ 可以排序、只看星标、管理标签、打开回收站。\n' +
                '· 删除的备忘会进回收站，可以恢复。'
            });
          }
        }
      ]
    });
  }

  function showSort() {
    const cur = Store.settings().sort || 0;
    U.sheet({
      title: '排序',
      items: ['最近修改', '最近创建', '标题顺序'].map(function (name, i) {
        return {
          label: name, check: cur === i, onTap: function () {
            Store.setSetting('sort', i);
            Store.flush();
            render();
          }
        };
      })
    });
  }

  function showTagFilter() {
    const tags = Store.allTags();
    if (!tags.length) { U.toast('未加标签'); return; }
    const items = tags.map(function (t) {
      return {
        icon: 'tag', label: t.tag + '  ' + t.count, check: state.tag === t.tag,
        onTap: function () {
          state.tag = t.tag;
          state.starredOnly = false;
          render();
        }
      };
    });
    if (state.tag || state.starredOnly) {
      items.push({
        icon: 'close', label: '取消筛选', onTap: function () {
          state.tag = '';
          state.starredOnly = false;
          render();
        }
      });
    }
    U.sheet({ title: '标签', items: items });
  }

  function addCategory() {
    U.prompt({
      title: '新建分类', placeholder: '分类名称', maxlength: 8, okText: '新建',
      validate: function (v) {
        if (!v) return '请输入名称';
        if (v.length > 8) return '分类名最多 8 个字';
        if (Store.categoryNameExists(v, -1)) return '已有同名分类';
        return null;
      }
    }).then(function (v) {
      if (!v) return;
      const c = Store.addCategory(v);
      state.catId = c.id;
      Store.flush();
      render();
      U.toast('已新建分类');
    });
  }

  function pickCategory(noteId) {
    const n = Store.noteById(noteId);
    if (!n) return;
    const items = [{
      icon: 'folder', label: '未分类', check: !n.catId, onTap: function () {
        Store.setCategory(noteId, 0);
        render();
        if (window.Editor && Editor.currentNoteId && Editor.currentNoteId() === noteId) Editor.renderMeta();
      }
    }];
    Store.categories().forEach(function (c) {
      items.push({
        icon: 'folder', label: c.name, check: n.catId === c.id, onTap: function () {
          Store.setCategory(noteId, c.id);
          render();
          if (window.Editor && Editor.currentNoteId && Editor.currentNoteId() === noteId) Editor.renderMeta();
          U.toast('已移动到「' + c.name + '」');
        }
      });
    });
    items.push({
      icon: 'plus', label: '新建分类', onTap: function () {
        U.prompt({
          title: '新建分类', placeholder: '分类名称', maxlength: 8, okText: '新建',
          validate: function (v) {
            if (!v) return '请输入名称';
            if (Store.categoryNameExists(v, -1)) return '已有同名分类';
            return null;
          }
        }).then(function (v) {
          if (!v) return;
          const c = Store.addCategory(v);
          Store.setCategory(noteId, c.id);
          Store.flush();
          render();
          if (window.Editor && Editor.currentNoteId && Editor.currentNoteId() === noteId) Editor.renderMeta();
          U.toast('已移动到「' + c.name + '」');
        });
      }
    });
    U.sheet({ title: '选择分类', items: items });
  }

  /* ------------------------------- 标签选择 ------------------------------- */

  function nameTags(noteId) {
    const n = Store.noteById(noteId);
    if (!n) return;
    const picked = (n.tags || []).slice();

    const body = document.createElement('div');
    body.innerHTML =
      '<div class="tag-pick" id="tagPickList" style="display:flex;flex-wrap:wrap;gap:8px;padding:2px 18px 12px"></div>' +
      '<div class="hex-row" style="padding:0 18px 10px">' +
      '<input id="tagNewInput" placeholder="新标签" maxlength="6" style="flex:1">' +
      '<button class="pill" id="tagNewBtn" style="height:42px;border-radius:11px;padding:0 16px">添加</button>' +
      '</div>';

    U.sheet({ title: '标签', body: body, cancel: false });

    function renderTags() {
      const names = Store.allTagNames();
      picked.forEach(function (t) { if (names.indexOf(t) < 0) names.push(t); });
      const box = document.getElementById('tagPickList');
      if (!box) return;
      if (!names.length) {
        box.innerHTML = '<span style="color:var(--hint);font-size:13.5px">还没有标签，在下面输入一个</span>';
      } else {
        box.innerHTML = names.map(function (t) {
          const on = picked.indexOf(t) >= 0;
          return '<button class="chip' + (on ? ' on' : '') + '" data-tag="' + U.esc(t) + '">' +
            (on ? '✓ ' : '') + U.esc(t) + '</button>';
        }).join('');
        U.$$('.chip[data-tag]', box).forEach(function (btn) {
          btn.addEventListener('click', function () {
            const t = btn.getAttribute('data-tag');
            const i = picked.indexOf(t);
            if (i >= 0) picked.splice(i, 1); else picked.push(t);
            Store.setTags(noteId, picked.slice());
            renderTags();
          });
        });
      }
      const done = document.createElement('button');
      done.className = 'pill';
      done.style.cssText = 'width:calc(100% - 36px);margin:8px 18px 4px;height:44px;border-radius:13px';
      done.textContent = '完成';
      done.onclick = function () {
        Store.flush();
        U.closeSheet();
        if (window.Editor && Editor.currentNoteId && Editor.currentNoteId() === noteId) Editor.renderMeta();
        renderList();
      };
      box.parentNode.appendChild(done);
    }

    renderTags();
    const input = document.getElementById('tagNewInput');
    const btn = document.getElementById('tagNewBtn');
    function addTag() {
      const v = (input.value || '').trim();
      if (!v) return;
      if (v.length > 6) { U.toast('标签最多 6 个字'); return; }
      if (picked.indexOf(v) < 0) picked.push(v);
      Store.setTags(noteId, picked.slice());
      input.value = '';
      Store.flush();
      renderTags();
    }
    btn.addEventListener('click', addTag);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });
  }

  return {
    init: init, render: render, renderList: renderList,
    addCategory: addCategory,
    pickTags: nameTags, pickCategory: pickCategory,
    state: state
  };
})();
