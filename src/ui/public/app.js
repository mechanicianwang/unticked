/**
 * unticked board client.
 * Auto-refreshes while the tab is visible; reloads immediately after writes.
 * UI strings: English + 中文 (toggle in the header).
 */

const I18N = {
  en: {
    subtitle: 'tickets as files',
    subtitleRo: 'read-only board',
    search: 'Search',
    searchPlaceholder: 'Filter title, body, tags, docs…',
    liveTitle: 'Auto-refreshes while this tab is open',
    connecting: 'connecting…',
    refreshing: 'refreshing…',
    offline: 'offline',
    updated: 'updated {ago}',
    justNow: 'just now',
    secondsAgo: '{n}s ago',
    minutesAgo: '{n}m ago',
    hoursAgo: '{n}h ago',
    docs: 'Docs',
    docsShow: 'Show linked documents',
    docsHide: 'Hide linked documents',
    docsLinked: 'Linked documents',
    docsSub: 'Status from tickets · never stored',
    docsEmpty: 'No document links yet.',
    themeToggle: 'Toggle light / dark',
    titlePlaceholder: 'What needs doing — one line',
    priority: 'Priority',
    add: 'Add',
    hint: 'Closes with the files. Commit when you are done.',
    hintRo: 'Read-only mode — open the board with write access to edit.',
    footStats: '{open} open · {total} total',
    footData: 'data lives in <code>.tickets/</code>',
    colOpen: 'To do',
    colDoing: 'In progress',
    colClosed: 'Closed',
    emptyOpen: 'Nothing waiting',
    emptyDoing: 'Nothing in flight',
    emptyClosed: 'Nothing closed yet',
    start: 'Start',
    backStatus: 'Back',
    close: 'Close',
    reopen: 'Reopen',
    delete: 'Delete',
    archive: 'Archive',
    openDoc: 'Open {path}',
    back: '← Back',
    loading: 'Loading…',
    failedOpen: 'Failed to open',
    emptyBody: '(empty body)',
    confirmArchive: 'Archive {path}?\nFile moves to the archive directory; ticket docs: pointers are updated.',
    confirmDelete: 'Delete {id}{title}?\nThis is not closing — the ticket is gone for good.',
    confirmDeleteShort: 'Delete {id}?',
    docMeta: '{kind} · {kb} KB · updated {time}',
    langSwitchTo: '中文',
    langTitle: 'Switch to Chinese',
  },
  zh: {
    subtitle: '票据即文件',
    subtitleRo: '只读看板',
    search: '搜索',
    searchPlaceholder: '筛选标题、正文、标签、文档…',
    liveTitle: '标签页打开时自动刷新',
    connecting: '连接中…',
    refreshing: '刷新中…',
    offline: '离线',
    updated: '{ago}更新',
    justNow: '刚刚',
    secondsAgo: '{n} 秒前',
    minutesAgo: '{n} 分钟前',
    hoursAgo: '{n} 小时前',
    docs: '文档',
    docsShow: '显示关联文档',
    docsHide: '隐藏关联文档',
    docsLinked: '关联文档',
    docsSub: '状态由票据推导 · 从不落盘',
    docsEmpty: '还没有关联文档。',
    themeToggle: '切换浅色 / 深色',
    titlePlaceholder: '要做什么 — 一句话',
    priority: '优先级',
    add: '添加',
    hint: '和代码一起提交。做完了就 commit。',
    hintRo: '只读模式 — 需要可写权限才能编辑。',
    footStats: '{open} 未关闭 · 共 {total}',
    footData: '数据在 <code>.tickets/</code>',
    colOpen: '待办',
    colDoing: '进行中',
    colClosed: '已关闭',
    emptyOpen: '暂无待办',
    emptyDoing: '暂无进行中',
    emptyClosed: '暂无已关闭',
    start: '开始',
    backStatus: '退回',
    close: '关闭',
    reopen: '重开',
    delete: '删除',
    archive: '归档',
    openDoc: '打开 {path}',
    back: '← 返回',
    loading: '加载中…',
    failedOpen: '打开失败',
    emptyBody: '（正文为空）',
    confirmArchive: '归档 {path}？\n文件会移到归档目录，并更新相关票据的 docs: 指针。',
    confirmDelete: '删除 {id}{title}？\n这不是关闭 — 票据会永久删除。',
    confirmDeleteShort: '删除 {id}？',
    docMeta: '{kind} · {kb} KB · 更新于 {time}',
    langSwitchTo: 'EN',
    langTitle: '切换到 English',
  },
};

function detectLang() {
  const saved = localStorage.getItem('unticked-lang');
  if (saved === 'en' || saved === 'zh') return saved;
  const nav = (navigator.language || '').toLowerCase();
  return nav.startsWith('zh') ? 'zh' : 'en';
}

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
  lang: detectLang(),
};

const $ = id => document.getElementById(id);

function t(key, vars) {
  const table = I18N[state.lang] || I18N.en;
  let s = table[key] ?? I18N.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

function columns() {
  return [
    { status: 'open', label: t('colOpen') },
    { status: 'doing', label: t('colDoing') },
    { status: 'closed', label: t('colClosed') },
  ];
}

/** Apply data-i18n* attributes on static markup. */
function applyStaticI18n() {
  document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
  });

  const langLabel = $('langBtnLabel');
  const langBtn = $('langBtn');
  if (langLabel) langLabel.textContent = t('langSwitchTo');
  if (langBtn) langBtn.title = t('langTitle');

  // Re-apply dynamic titles that depend on open state / readonly.
  setDocsOpen(state.docsOpen);
  const hint = $('hint');
  if (hint) hint.textContent = state.readOnly ? t('hintRo') : t('hint');
  const sub = $('subtitle');
  if (sub) sub.textContent = state.readOnly ? t('subtitleRo') : t('subtitle');
}

function setLang(lang) {
  state.lang = lang === 'zh' ? 'zh' : 'en';
  localStorage.setItem('unticked-lang', state.lang);
  applyStaticI18n();
  render();
  tickLiveLabel();
}

function initLang() {
  applyStaticI18n();
  $('langBtn')?.addEventListener('click', () => {
    setLang(state.lang === 'zh' ? 'en' : 'zh');
  });
}

// —— theme ————————————————————————————————————————————————————————————

function initTheme() {
  const saved = localStorage.getItem('unticked-theme');
  const preferred =
    saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(preferred);
  $('themeBtn')?.addEventListener('click', () => {
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
  if (!el) return;
  el.classList.remove('is-live', 'is-refreshing', 'is-error');
  if (kind) el.classList.add(kind);
  const liveText = $('liveText');
  if (liveText) liveText.textContent = text;
}

function formatAgo(ts) {
  if (!ts) return '…';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 2) return t('justNow');
  if (s < 60) return t('secondsAgo', { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('minutesAgo', { n: m });
  return t('hoursAgo', { n: Math.floor(m / 60) });
}

function tickLiveLabel() {
  if (state.loading) return;
  const live = $('live');
  if (!live || live.classList.contains('is-error')) return;
  setLive('is-live', t('updated', { ago: formatAgo(state.lastOkAt) }));
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
  if (!silent) setLive('is-refreshing', t('refreshing'));
  else if (state.lastOkAt) setLive('is-refreshing', t('updated', { ago: formatAgo(state.lastOkAt) }));

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
    if (hint) hint.textContent = state.readOnly ? t('hintRo') : t('hint');

    if (changed || !silent) render();
    hideBanner();
    setLive('is-live', t('updated', { ago: formatAgo(state.lastOkAt) }));
  } catch (err) {
    showBanner(err.message || String(err));
    setLive('is-error', t('offline'));
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
  if (foot) foot.textContent = t('footStats', { open, total: state.tickets.length });
  const sub = $('subtitle');
  if (sub) sub.textContent = state.readOnly ? t('subtitleRo') : t('subtitle');
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
    btn.title = state.docsOpen ? t('docsHide') : t('docsShow');
  }
  const toggle = $('docsToggle');
  if (toggle) toggle.title = t('docsHide');
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
        <button type="button" class="doc-path" data-open-doc="${escapeHtml(d.doc)}" title="${escapeHtml(t('openDoc', { path: d.doc }))}">${escapeHtml(d.doc)}</button>
        <div class="doc-meta">
          <span class="muted">${d.closed}/${d.total}</span>
          ${
            canArchive
              ? `<button type="button" class="btn ghost" data-archive="${escapeHtml(d.doc)}">${escapeHtml(t('archive'))}</button>`
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
      if (!confirm(t('confirmArchive', { path: doc }))) return;
      void write({ action: 'archive', doc });
    });
  });
}

function actionButtons(tkt) {
  if (state.readOnly) return '';
  const bits = [];
  if (tkt.status === 'open') {
    bits.push(`<button type="button" class="act" data-act="status" data-id="${tkt.id}" data-status="doing">${escapeHtml(t('start'))}</button>`);
  }
  if (tkt.status === 'doing') {
    bits.push(`<button type="button" class="act" data-act="status" data-id="${tkt.id}" data-status="open">${escapeHtml(t('backStatus'))}</button>`);
  }
  if (tkt.status !== 'closed') {
    bits.push(`<button type="button" class="act" data-act="status" data-id="${tkt.id}" data-status="closed">${escapeHtml(t('close'))}</button>`);
  } else {
    bits.push(`<button type="button" class="act" data-act="status" data-id="${tkt.id}" data-status="open">${escapeHtml(t('reopen'))}</button>`);
  }
  bits.push(`<button type="button" class="act is-danger" data-act="remove" data-id="${tkt.id}">${escapeHtml(t('delete'))}</button>`);
  return bits.join('');
}

function renderBoard() {
  const board = $('board');
  if (!board) return;
  const items = visibleTickets();
  board.innerHTML = columns().map(col => {
    const colItems = items.filter(tkt => tkt.status === col.status);
    const cards = colItems.length
      ? colItems
          .map(tkt => {
            const chips = [
              ...tkt.tags.map(tag => `<span class="chip">#${escapeHtml(tag)}</span>`),
              ...tkt.docs.map(
                d =>
                  `<button type="button" class="chip doc" data-open-doc="${escapeHtml(d)}" title="${escapeHtml(d)}">→ ${escapeHtml(d.split('/').pop())}</button>`
              ),
            ].join('');
            return `<article class="ticket ${tkt.status === 'closed' ? 'is-closed' : ''}" data-id="${escapeHtml(tkt.id)}" data-prio="${escapeHtml(tkt.priority)}">
              <button type="button" class="ticket-title" data-act="open" data-id="${escapeHtml(tkt.id)}">${escapeHtml(tkt.title)}</button>
              ${chips ? `<div class="chips">${chips}</div>` : ''}
              <div class="ticket-foot">
                <span class="prio ${escapeHtml(tkt.priority)}">${escapeHtml(tkt.priority)}</span>
                <span class="ticket-id">${escapeHtml(tkt.id)}</span>
                <span class="ticket-actions">${actionButtons(tkt)}</span>
              </div>
            </article>`;
          })
          .join('')
      : `<div class="empty">${
          col.status === 'open' ? t('emptyOpen') : col.status === 'doing' ? t('emptyDoing') : t('emptyClosed')
        }</div>`;

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
        const tkt = state.tickets.find(x => x.id === id);
        const titleBit = tkt ? ` “${tkt.title}”` : '';
        if (!confirm(t('confirmDelete', { id, title: titleBit }))) return;
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
  $('dBody').textContent = t.body || t('emptyBody');

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
          if (!confirm(t('confirmDeleteShort', { id: tid }))) return;
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
  if (subEl) subEl.textContent = t('loading');
  if (bodyEl) bodyEl.innerHTML = '';
  if (loading) {
    loading.hidden = false;
    loading.textContent = t('loading');
  }

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
      const locale = state.lang === 'zh' ? 'zh-CN' : 'en';
      subEl.textContent = t('docMeta', {
        kind: data.kind,
        kb,
        time: new Date(data.mtime).toLocaleString(locale),
      });
    }
    if (loading) loading.hidden = true;
    if (bodyEl) bodyEl.innerHTML = renderDocument(data);
  } catch (err) {
    if (loading) loading.hidden = true;
    if (subEl) subEl.textContent = t('failedOpen');
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

initLang();
initTheme();
initForms();
initDocsPanel();
initDocReader();
initVisibility();
void load({ silent: false }).then(schedulePoll);
