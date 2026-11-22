/* 极简 Markdown 渲染：粗体/标题/列表/表格/代码/删除线/链接/LaTeX 括号 */
window.Md = (function () {

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** 还原 \( \) \[ \] —— 模型常把中文括号转义成 LaTeX 形式 */
  function normalize(text) {
    return String(text || '')
      .replace(/\\\(/g, '(').replace(/\\\)/g, ')')
      .replace(/\\\[/g, '[').replace(/\\\]/g, ']')
      .replace(/\\\$/g, '$');
  }

  function inline(src) {
    // 行内代码先抽出来，避免被后面的规则改写
    const codes = [];
    let s = src.replace(/`([^`]+)`/g, function (_, code) {
      codes.push(code);
      return '\u0000C' + (codes.length - 1) + '\u0000';
    });

    s = esc(s);

    // 链接只留文字（README：括号里的链接不再露出来）
    s = s.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, '$1');
    s = s.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1');

    // 粗体 / 斜体 / 删除线
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // 行内代码回填
    s = s.replace(/\u0000C(\d+)\u0000/g, function (_, i) {
      return '<code>' + esc(codes[parseInt(i, 10)]) + '</code>';
    });
    return s;
  }

  function splitRow(line) {
    let t = line.trim();
    if (t.charAt(0) === '|') t = t.slice(1);
    if (t.charAt(t.length - 1) === '|') t = t.slice(0, -1);
    return t.split('|').map(function (c) { return c.trim(); });
  }

  function isTableSep(line) {
    return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
  }

  function tableHtml(rows) {
    if (!rows.length) return '';
    const head = rows[0];
    const body = rows.slice(1);
    let h = '<table><thead><tr>';
    head.forEach(function (c) { h += '<th>' + inline(c) + '</th>'; });
    h += '</tr></thead><tbody>';
    body.forEach(function (r) {
      h += '<tr>';
      for (let i = 0; i < head.length; i++) h += '<td>' + inline(r[i] == null ? '' : r[i]) + '</td>';
      h += '</tr>';
    });
    h += '</tbody></table>';
    return h;
  }

  function render(text) {
    const src = normalize(text);
    if (!src.trim()) return '';
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 代码块
      if (/^\s*```/.test(line)) {
        const lang = line.trim().replace(/^```/, '').trim();
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // 跳过结束 ```
        out.push('<pre><code' + (lang ? ' class="lang-' + esc(lang) + '"' : '') + '>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }

      // 空行
      if (!line.trim()) { i++; continue; }

      // 表格
      if (line.indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const rows = [];
        rows.push(splitRow(line));
        i += 2;
        while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim()) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        out.push(tableHtml(rows));
        continue;
      }

      // 分隔线
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

      // 标题
      const hd = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
      if (hd) {
        const lv = Math.min(4, hd[1].length);
        out.push('<h' + lv + '>' + inline(hd[2].replace(/\s+#+\s*$/, '')) + '</h' + lv + '>');
        i++;
        continue;
      }

      // 引用
      if (/^\s*>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        out.push('<blockquote>' + render(buf.join('\n')) + '</blockquote>');
        continue;
      }

      // 无序列表
      if (/^\s*[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          let item = lines[i].replace(/^\s*[-*+]\s+/, '');
          i++;
          // 续行（缩进）
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i])) {
            item += ' ' + lines[i].trim();
            i++;
          }
          items.push(item);
        }
        out.push('<ul>' + items.map(function (t) { return '<li>' + inline(t) + '</li>'; }).join('') + '</ul>');
        continue;
      }

      // 有序列表
      if (/^\s*\d+[.)]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
          i++;
        }
        out.push('<ol>' + items.map(function (t) { return '<li>' + inline(t) + '</li>'; }).join('') + '</ol>');
        continue;
      }

      // 普通段落
      const buf = [line];
      i++;
      while (i < lines.length && lines[i].trim() &&
        !/^\s*```/.test(lines[i]) &&
        !/^\s*#{1,6}\s+/.test(lines[i]) &&
        !/^\s*[-*+]\s+/.test(lines[i]) &&
        !/^\s*\d+[.)]\s+/.test(lines[i]) &&
        !/^\s*>\s?/.test(lines[i]) &&
        !(lines[i].indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) &&
        !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      out.push('<p>' + buf.map(inline).join('<br>') + '</p>');
    }

    return '<div class="md">' + out.join('') + '</div>';
  }

  return { render: render, inline: inline, esc: esc };
})();
