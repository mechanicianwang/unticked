/**
 * unticked board client.
 * Auto-refreshes while the tab is visible; reloads immediately after writes.
 */

const COLUMNS = [
  { status: 'open', label: 'To do' },
  { status: 'doing', label: 'In progress' },
  { status: 'closed', label: 'Closed' },
];

const state = {
  tickets: [],
  docs: [],
  orphanDocs: [],
  readOnly: false,
  pollMs: 4000,
  q: '',
  lastOkAt: null,
  timer: null,
  loading: false,
  fingerprint: '',
  // Default collapsed; only open if user previously expanded.
  docsOpen: localStorage.getItem('unticked-docs-open') === '1',
  view: 'board', // 'board' | 'doc'
  openDocPath: null,
};

const $ = id => document.getElementById(id);

// —— theme ————————————————————————————————————————————————————————————

function initTheme() {
  const saved = localStorage.getItem('unticked-theme');
  const preferred =
    saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(preferred);
  $('themeBtn').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('unticked-theme', next);
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
}

// —— live indicator ———————————————————————————————————————————————————

function setLive(kind, text) {
  const el = $('live');
  el.classList.remove('is-live', 'is-refreshing', 'is-error');
  if (kind) el.classList.add(kind);
  $('liveText').textContent = text;
}

function formatAgo(ts) {
  if (!ts) return '…';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 2) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function tickLiveLabel() {
  if (state.loading) return;
  if ($('live').classList.contains('is-error')) return;
  setLive('is-live', `updated ${formatAgo(state.lastOkAt)}`);
}

// —— api ——————————————————————————————————————————————————————————————

async function apiGet() {
  const res = await fetch('/api/tickets?status=all', { cache: 'no-store' });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function apiWrite(body) {
  const res = await fetch('/api/tickets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function fingerprintOf(data) {
  // Cheap change detection so quiet polls don't thrash the DOM.
  return JSON.stringify({
    t: data.tickets.map(x => [x.id, x.status, x.priority, x.title, x.closed, x.file]),
    d: data.docs,
    o: data.orphanDocs,
    r: data.readOnly,
  });
}

async function load({ silent = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  if (!silent) setLive('is-refreshing', 'refreshing…');
  else if (state.lastOkAt) setLive('is-refreshing', `updated ${formatAgo(state.lastOkAt)}`);

  try {
    const data = await apiGet();
    const fp = fingerprintOf(data);
    const changed = fp !== state.fingerprint;

    state.tickets = data.tickets || [];
    state.docs = data.docs || [];
    state.orphanDocs = data.orphanDocs || [];
    state.readOnly = !!data.readOnly;
    if (typeof data.pollMs === 'number' && data.pollMs > 0) state.pollMs = data.pollMs;
    state.lastOkAt = Date.now();
    state.fingerprint = fp;

    document.body.classList.toggle('read-only', state.readOnly);
    const createBtn = $('createBtn');
    const titleInput = $('titleInput');
    const priorityInput = $('priorityInput');
    if (createBtn) createBtn.disabled = state.readOnly;
    if (titleInput) titleInput.disabled = state.readOnly;
    if (priorityInput) priorityInput.disabled = state.readOnly;
    const hint = $('hint');
    if (state.readOnly && hint) {
      hint.textContent = 'Read-only mode — open the board with write access to edit.';
    }

    if (changed || !silent) render();
    hideBanner();
    setLive('is-live', `updated ${formatAgo(state.lastOkAt)}`);
  } catch (err) {
    showBanner(err.message || String(err));
    setLive('is-error', 'offline');
  } finally {
    state.loading = false;
  }
}

// —— polling ——————————————————————————————————————————————————————————

function schedulePoll() {
  clearInterval(state.timer);
  state.timer = setInterval(() => {
    if (document.hidden) return;
    void load({ silent: true });
  }, state.pollMs);
}

function initVisibility() {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void load({ silent: true });
  });
  // Keep the "updated Ns ago" label honest without refetching.
  setInterval(tickLiveLabel, 1000);
}

// —— render ———————————————————————————————————————————————————————————

function showBanner(msg, kind = 'error') {
  const el = $('banner');
  if (!el) return;
  el.hidden = false;
  el.dataset.kind = kind === 'warn' ? 'warn' : '';
  el.textContent = msg;
}

function hideBanner() {
  const el = $('banner');
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function visibleTickets() {
  const q = state.q.trim().toLowerCase();
  if (!q) return state.tickets;
  return state.tickets.filter(t =>
    (t.title + ' ' + t.body + ' ' + t.tags.join(' ') + ' ' + t.docs.join(' ')).toLowerCase().includes(q)
  );
}

function render() {
  renderDocs();
  renderBoard();
  const open = state.tickets.filter(t => t.status !== 'closed').length;
  const foot = $('footStats');
  if (foot) foot.textContent = `${open} open · ${state.tickets.length} total`;
  const sub = $('subtitle');
  if (sub) sub.textContent = state.readOnly ? 'read-only board' : 'tickets as files';
}

function setDocsOpen(open) {
  state.docsOpen = !!open;
  localStorage.setItem('unticked-docs-open', state.docsOpen ? '1' : '0');
  const ws = $('workspace');
  if (ws) ws.dataset.docsOpen = state.docsOpen ? 'true' : 'false';
  const btn = $('docsBtn');
  if (btn) {
    btn.setAttribute('aria-expanded', state.docsOpen ? 'true' : 'false');
    btn.classList.toggle('is-active', state.docsOpen);
    btn.title = state.docsOpen ? 'Hide linked documents' : 'Show linked documents';
  }
}

function initDocsPanel() {
  setDocsOpen(state.docsOpen);
  const toggle = () => setDocsOpen(!state.docsOpen);
  $('docsBtn')?.addEventListener('click', toggle);
  $('docsToggle')?.addEventListener('click', toggle);
}

function renderDocs() {
  const list = $('docsList');
  const empty = $('docsEmpty');
  const n = String(state.docs.length);
  const countEl = $('docsCount');
  const countBtn = $('docsBtnCount');
  if (countEl) countEl.textContent = n;
  if (countBtn) countBtn.textContent = n;
  if (!list) return;

  if (!state.docs.length) {
    list.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  list.innerHTML = state.docs
    .map(d => {
      const canArchive = d.status === 'done' && !state.readOnly;
      const active = state.openDocPath === d.doc ? ' is-active' : '';
      return `<li class="${active.trim()}">
        <span class="doc-status ${escapeHtml(d.status)}">${escapeHtml(d.status)}</span>
        <button type="button" class="doc-path" data-open-doc="${escapeHtml(d.doc)}" title="Open ${escapeHtml(d.doc)}">${escapeHtml(d.doc)}</button>
        <div class="doc-meta">
          <span class="muted">${d.closed}/${d.total}</span>
          ${
            canArchive
              ? `<button type="button" class="btn ghost" data-archive="${escapeHtml(d.doc)}">Archive</button>`
              : ''
          }
        </div>
      </li>`;
    })
    .join('');

  list.querySelectorAll('[data-open-doc]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      void openDocument(btn.getAttribute('data-open-doc'), { push: true });
    });
  });

  list.querySelectorAll('[data-archive]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const doc = btn.getAttribute('data-archive');
      if (!confirm(`Archive ${doc}?\nFile moves to the archive directory; ticket docs: pointers are updated.`)) return;
      void write({ action: 'archive', doc });
    });
  });
}

function actionButtons(t) {
  if (state.readOnly) return '';
  const bits = [];
  if (t.status === 'open') {
    bits.push(`<button type="button" class="act" data-act="status" data-id="${t.id}" data-status="doing">Start</button>`);
  }
  if (t.status === 'doing') {
    bits.push(`<button type="button" class="act" data-act="status" data-id="${t.id}" data-status="open">Back</button>`);
  }
  if (t.status !== 'closed') {
    bits.push(`<button type="button" class="act" data-act="status" data-id="${t.id}" data-status="closed">Close</button>`);
  } else {
    bits.push(`<button type="button" class="act" data-act="status" data-id="${t.id}" data-status="open">Reopen</button>`);
  }
  bits.push(`<button type="button" class="act is-danger" data-act="remove" data-id="${t.id}">Delete</button>`);
  return bits.join('');
}

function renderBoard() {
  const board = $('board');
  const items = visibleTickets();
  board.innerHTML = COLUMNS.map(col => {
    const colItems = items.filter(t => t.status === col.status);
    const cards = colItems.length
      ? colItems
          .map(t => {
            const chips = [
              ...t.tags.map(tag => `<span class="chip">#${escapeHtml(tag)}</span>`),
              ...t.docs.map(
                d =>
                  `<button type="button" class="chip doc" data-open-doc="${escapeHtml(d)}" title="${escapeHtml(d)}">→ ${escapeHtml(d.split('/').pop())}</button>`
              ),
            ].join('');
            return `<article class="ticket ${t.status === 'closed' ? 'is-closed' : ''}" data-id="${escapeHtml(t.id)}" data-prio="${escapeHtml(t.priority)}">
              <button type="button" class="ticket-title" data-act="open" data-id="${escapeHtml(t.id)}">${escapeHtml(t.title)}</button>
              ${chips ? `<div class="chips">${chips}</div>` : ''}
              <div class="ticket-foot">
                <span class="prio ${escapeHtml(t.priority)}">${escapeHtml(t.priority)}</span>
                <span class="ticket-id">${escapeHtml(t.id)}</span>
                <span class="ticket-actions">${actionButtons(t)}</span>
              </div>
            </article>`;
          })
          .join('')
      : `<div class="empty">${col.status === 'open' ? 'Nothing waiting' : col.status === 'doing' ? 'Nothing in flight' : 'Nothing closed yet'}</div>`;

    return `<section class="column" data-status="${col.status}">
      <div class="column-head">
        <h2>${col.label}</h2>
        <span class="count">${colItems.length}</span>
      </div>
      <div class="cards">${cards}</div>
    </section>`;
  }).join('');

  board.querySelectorAll('[data-act]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      const act = el.getAttribute('data-act');
      const id = el.getAttribute('data-id');
      if (act === 'open') {
        openDetail(id);
        return;
      }
      if (act === 'status') {
        void write({ action: 'status', id, status: el.getAttribute('data-status') });
        return;
      }
      if (act === 'remove') {
        const t = state.tickets.find(x => x.id === id);
        if (!confirm(`Delete ${id}${t ? ` “${t.title}”` : ''}?\nThis is not closing — the ticket is gone for good.`)) return;
        void write({ action: 'remove', id });
      }
    });
  });

  board.querySelectorAll('[data-open-doc]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      void openDocument(el.getAttribute('data-open-doc'), { push: true });
    });
  });
}

async function write(body) {
  try {
    await apiWrite(body);
    await load({ silent: false });
  } catch (err) {
    showBanner(err.message || String(err));
  }
}

// —— detail dialog ————————————————————————————————————————————————————

function openDetail(id) {
  const t = state.tickets.find(x => x.id === id);
  if (!t) return;
  const dialog = $('detailDialog');
  $('dId').textContent = `${t.id} · ${t.priority} · ${t.status}`;
  $('dTitle').textContent = t.title;
  $('dMeta').innerHTML = [
    ...t.tags.map(tag => `<span class="chip">#${escapeHtml(tag)}</span>`),
    ...t.docs.map(
      d => `<button type="button" class="chip doc" data-open-doc="${escapeHtml(d)}">${escapeHtml(d)}</button>`
    ),
    `<span class="chip doc" title="file">${escapeHtml(t.file)}</span>`,
  ].join('');
  $('dBody').textContent = t.body || '(empty body)';

  const actions = $('dActions');
  if (state.readOnly) {
    actions.innerHTML = '';
  } else {
    actions.innerHTML = actionButtons(t);
    actions.querySelectorAll('[data-act]').forEach(el => {
      el.addEventListener('click', () => {
        const act = el.getAttribute('data-act');
        const tid = el.getAttribute('data-id');
        dialog.close();
        if (act === 'status') void write({ action: 'status', id: tid, status: el.getAttribute('data-status') });
        if (act === 'remove') {
          if (!confirm(`Delete ${tid}?`)) return;
          void write({ action: 'remove', id: tid });
        }
      });
    });
  }

  $('dMeta')
    .querySelectorAll('[data-open-doc]')
    .forEach(el => {
      el.addEventListener('click', () => {
        dialog.close();
        void openDocument(el.getAttribute('data-open-doc'), { push: true });
      });
    });

  if (typeof dialog.showModal === 'function') dialog.showModal();
}

// —— document reader ——————————————————————————————————————————————————

function setView(view) {
  state.view = view;
  const ws = $('workspace');
  if (ws) ws.dataset.view = view;
  const boardView = $('boardView');
  const docView = $('docView');
  if (boardView) boardView.hidden = view !== 'board';
  if (docView) docView.hidden = view !== 'doc';
}

function showBoard({ push = false } = {}) {
  state.openDocPath = null;
  setView('board');
  renderDocs(); // clear active highlight
  if (push) {
    const url = new URL(location.href);
    url.searchParams.delete('doc');
    history.pushState({ view: 'board' }, '', url.pathname + url.search);
  }
}

async function openDocument(docPath, { push = false } = {}) {
  if (!docPath) return;
  // Expand the docs rail so context stays visible while reading.
  if (!state.docsOpen) setDocsOpen(true);

  setView('doc');
  state.openDocPath = docPath;
  renderDocs();

  const pathEl = $('docViewPath');
  const subEl = $('docViewSub');
  const bodyEl = $('docViewBody');
  const loading = $('docViewLoading');
  if (pathEl) pathEl.textContent = docPath;
  if (subEl) subEl.textContent = 'Loading…';
  if (bodyEl) bodyEl.innerHTML = '';
  if (loading) loading.hidden = false;

  if (push) {
    const url = new URL(location.href);
    url.searchParams.set('doc', docPath);
    history.pushState({ view: 'doc', path: docPath }, '', url.pathname + url.search);
  }

  try {
    const res = await fetch('/api/doc?path=' + encodeURIComponent(docPath), { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);

    if (subEl) {
      const kb = (data.size / 1024).toFixed(1);
      subEl.textContent = `${data.kind} · ${kb} KB · updated ${new Date(data.mtime).toLocaleString()}`;
    }
    if (loading) loading.hidden = true;
    if (bodyEl) bodyEl.innerHTML = renderDocument(data);
  } catch (err) {
    if (loading) loading.hidden = true;
    if (subEl) subEl.textContent = 'Failed to open';
    if (bodyEl) {
      bodyEl.innerHTML = `<p class="doc-error">${escapeHtml(err.message || String(err))}</p>`;
    }
  }
}

/**
 * Minimal markdown → HTML. Good enough for internal docs; not a full CommonMark
 * engine. Zero deps so the board stays offline-friendly.
 */
function renderMarkdown(src) {
  const text = String(src || '').replace(/\r\n/g, '\n');
  // Extract fenced code blocks first so they survive other transforms.
  const fences = [];
  let s = text.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const i = fences.length;
    fences.push(
      `<pre><code class="language-${escapeHtml((lang || '').trim())}">${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`
    );
    return `\u0000FENCE${i}\u0000`;
  });

  const lines = s.split('\n');
  const out = [];
  let i = 0;
  let para = [];

  const flushPara = () => {
    if (!para.length) return;
    const raw = para.join(' ').trim();
    if (raw) out.push(`<p>${inlineMd(raw)}</p>`);
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      flushPara();
      i++;
      continue;
    }

    // restored fence placeholder as its own block
    const fenceHit = /^\u0000FENCE(\d+)\u0000$/.exec(line.trim());
    if (fenceHit) {
      flushPara();
      out.push(fences[Number(fenceHit[1])]);
      i++;
      continue;
    }

    if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      flushPara();
      out.push('<hr />');
      i++;
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flushPara();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMd(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushPara();
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote><p>${inlineMd(quote.join(' '))}</p></blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      flushPara();
      out.push('<ul>');
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        out.push(`<li>${inlineMd(lines[i].replace(/^\s*[-*+]\s+/, ''))}</li>`);
        i++;
      }
      out.push('</ul>');
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      out.push('<ol>');
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        out.push(`<li>${inlineMd(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`);
        i++;
      }
      out.push('</ol>');
      continue;
    }

    // simple GFM table
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:-|]+\|[\s:-|]*$/.test(lines[i + 1])
    ) {
      flushPara();
      const rows = [];
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(
          lines[i]
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map(c => c.trim())
        );
        i++;
        if (rows.length === 1 && i < lines.length && /^\s*\|?[\s:-|]+\|[\s:-|]*$/.test(lines[i])) {
          i++; // skip separator
        }
      }
      if (rows.length) {
        const [head, ...body] = rows;
        out.push('<table><thead><tr>');
        head.forEach(c => out.push(`<th>${inlineMd(c)}</th>`));
        out.push('</tr></thead><tbody>');
        body.forEach(row => {
          out.push('<tr>');
          row.forEach(c => out.push(`<td>${inlineMd(c)}</td>`));
          out.push('</tr>');
        });
        out.push('</tbody></table>');
      }
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();

  // restore any fence tokens that landed inside paragraphs (shouldn't, but safe)
  return out
    .join('\n')
    .replace(/\u0000FENCE(\d+)\u0000/g, (_, n) => fences[Number(n)] || '');
}

function inlineMd(s) {
  let t = escapeHtml(s);
  // links [text](url)
  t = t.replace(
    /\[([^\]]+)\]\((https?:[^)\s]+|\/[^)\s]*|docs\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  // bold / italic
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  t = t.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  t = t.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');
  // inline code
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  return t;
}

function renderDocument(data) {
  if (data.kind === 'markdown') return renderMarkdown(data.content);
  if (data.kind === 'html') {
    // Sandboxed iframe — scripts disabled. Attribute-escape srcdoc only.
    const attr = data.content.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return `<iframe class="doc-html-frame" sandbox="" srcdoc="${attr}" title="${escapeHtml(data.path)}"></iframe>`;
  }
  if (data.kind === 'json') {
    try {
      const pretty = JSON.stringify(JSON.parse(data.content), null, 2);
      return `<pre class="doc-raw">${escapeHtml(pretty)}</pre>`;
    } catch {
      return `<pre class="doc-raw">${escapeHtml(data.content)}</pre>`;
    }
  }
  return `<pre class="doc-raw">${escapeHtml(data.content)}</pre>`;
}

function initDocReader() {
  $('docBackBtn')?.addEventListener('click', () => showBoard({ push: true }));

  window.addEventListener('popstate', ev => {
    const st = ev.state;
    if (st?.view === 'doc' && st.path) {
      void openDocument(st.path, { push: false });
    } else {
      showBoard({ push: false });
    }
  });

  // Deep link: ?doc=path/to/file.md
  const params = new URLSearchParams(location.search);
  const initial = params.get('doc');
  if (initial) {
    history.replaceState({ view: 'doc', path: initial }, '', location.href);
    void openDocument(initial, { push: false });
  } else {
    history.replaceState({ view: 'board' }, '', location.pathname + location.search);
  }
}

// —— forms ————————————————————————————————————————————————————————————

function initForms() {
  $('createForm')?.addEventListener('submit', e => {
    e.preventDefault();
    if (state.readOnly) return;
    const title = $('titleInput').value.trim();
    if (!title) return;
    const priority = $('priorityInput').value || 'p2';
    $('titleInput').value = '';
    void write({ action: 'create', title, priority });
  });

  let searchTimer = null;
  $('searchInput')?.addEventListener('input', e => {
    state.q = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(render, 80);
  });
}

// —— boot —————————————————————————————————————————————————————————————

initTheme();
initForms();
initDocsPanel();
initDocReader();
initVisibility();
void load({ silent: false }).then(schedulePoll);
