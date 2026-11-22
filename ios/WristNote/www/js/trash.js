/* 回收站 */
window.Trash = (function () {
  const $ = U.$;

  function init() {
    $('#trBack').addEventListener('click', function () { App.back('home'); });
    $('#trClear').addEventListener('click', function () {
      const list = Store.trashed();
      if (!list.length) { U.toast('回收站是空的'); return; }
      U.confirm({
        title: '清空回收站',
        message: '彻底删除回收站里的 ' + list.length + ' 条备忘？删除后无法恢复。',
        okText: '清空', danger: true
      }).then(function (ok) {
        if (!ok) return;
        Store.emptyTrash();
        Store.flush();
        render();
        U.toast('已清空回收站');
      });
    });
  }

  function render() {
    const list = Store.trashed();
    const box = $('#trList');
    if (!list.length) {
      box.innerHTML = '<div class="empty">' + U.icon('trash') +
        '<div class="empty-title">回收站是空的</div></div>';
      return;
    }
    box.innerHTML = list.map(function (n) {
      return '<div class="trash-card" data-id="' + n.id + '">' +
        '<div class="trash-main">' +
        '<div class="trash-title">' + U.esc(Store.noteTitle(n)) + '</div>' +
        '<div class="trash-sub">删除于 ' + U.esc(U.fmtDateTime(n.deletedAt || n.updated)) + '</div>' +
        '</div><span class="row-chev">' + U.icon('chevron') + '</span></div>';
    }).join('');

    U.$$('.trash-card', box).forEach(function (card) {
      const id = parseInt(card.getAttribute('data-id'), 10);
      card.addEventListener('click', function () { showSheet(id); });
    });
  }

  function showSheet(id) {
    const n = Store.noteById(id);
    if (!n) { render(); return; }
    U.sheet({
      title: U.clampText(Store.noteTitle(n), 18),
      items: [
        {
          icon: 'restore', label: '恢复', onTap: function () {
            Store.restoreNote(id);
            Store.flush();
            render();
            U.toast('已恢复');
          }
        },
        {
          icon: 'trash', label: '彻底删除', danger: true, onTap: function () {
            U.confirm({ title: '彻底删除', message: '这条备忘会被永久删除，无法恢复。', okText: '删除', danger: true })
              .then(function (ok) {
                if (!ok) return;
                Store.purgeNote(id);
                Store.flush();
                render();
                U.toast('已彻底删除');
              });
          }
        }
      ]
    });
  }

  return { init: init, render: render };
})();
