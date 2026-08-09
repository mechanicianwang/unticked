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
    $('createBtn').disabled = state.readOnly;
    $('titleInput').disabled = state.readOnly;
    $('priorityInput').disabled = state.readOnly;
    if (state.readOnly) {
      $('hint').textContent = 'Read-only mode — open the board with write access to edit.';
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
  el.hidden = false;
  el.dataset.kind = kind === 'warn' ? 'warn' : '';
  el.textContent = msg;
}

function hideBanner() {
  $('banner').hidden = true;
  $('banner').textContent = '';
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
  $('footStats').textContent = `${open} open · ${state.tickets.length} total`;
  $('subtitle').textContent = state.readOnly ? 'read-only board' : 'tickets as files';
}

function renderDocs() {
  const panel = $('docsPanel');
  const list = $('docsList');
  if (!state.docs.length) {
    panel.hidden = true;
    list.innerHTML = '';
    return;
  }
  panel.hidden = false;
  $('docsCount').textContent = String(state.docs.length);
  list.innerHTML = state.docs
    .map(d => {
      const canArchive = d.status === 'done' && !state.readOnly;
      return `<li>
        <span class="doc-status ${escapeHtml(d.status)}">${escapeHtml(d.status)}</span>
        <span class="doc-path" title="${escapeHtml(d.doc)}">${escapeHtml(d.doc)}</span>
        <span class="muted">${d.closed}/${d.total}</span>
        ${
          canArchive
            ? `<button type="button" class="btn ghost" data-archive="${escapeHtml(d.doc)}">Archive</button>`
            : '<span></span>'
        }
      </li>`;
    })
    .join('');

  list.querySelectorAll('[data-archive]').forEach(btn => {
    btn.addEventListener('click', () => {
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
    bits.push(`<button type="button" class="btn" data-act="status" data-id="${t.id}" data-status="doing">Start</button>`);
  }
  if (t.status === 'doing') {
    bits.push(`<button type="button" class="btn" data-act="status" data-id="${t.id}" data-status="open">Back</button>`);
  }
  if (t.status !== 'closed') {
    bits.push(`<button type="button" class="btn" data-act="status" data-id="${t.id}" data-status="closed">Close</button>`);
  } else {
    bits.push(`<button type="button" class="btn" data-act="status" data-id="${t.id}" data-status="open">Reopen</button>`);
  }
  bits.push(`<button type="button" class="btn danger" data-act="remove" data-id="${t.id}">Delete</button>`);
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
                  `<span class="chip doc" title="${escapeHtml(d)}">→ ${escapeHtml(d.split('/').pop())}</span>`
              ),
            ].join('');
            return `<article class="ticket ${t.status === 'closed' ? 'is-closed' : ''}" data-id="${escapeHtml(t.id)}">
              <div class="ticket-top">
                <span class="prio ${escapeHtml(t.priority)}">${escapeHtml(t.priority)}</span>
                <span class="ticket-id">${escapeHtml(t.id)}</span>
              </div>
              <button type="button" class="ticket-title" data-act="open" data-id="${escapeHtml(t.id)}">${escapeHtml(t.title)}</button>
              ${chips ? `<div class="chips">${chips}</div>` : ''}
              <div class="ticket-actions">${actionButtons(t)}</div>
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
    ...t.docs.map(d => `<span class="chip doc">${escapeHtml(d)}</span>`),
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
  if (typeof dialog.showModal === 'function') dialog.showModal();
}

// —— forms ————————————————————————————————————————————————————————————

function initForms() {
  $('createForm').addEventListener('submit', e => {
    e.preventDefault();
    if (state.readOnly) return;
    const title = $('titleInput').value.trim();
    if (!title) return;
    const priority = $('priorityInput').value || 'p2';
    $('titleInput').value = '';
    void write({ action: 'create', title, priority });
  });

  let searchTimer = null;
  $('searchInput').addEventListener('input', e => {
    state.q = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(render, 80);
  });
}

// —— boot —————————————————————————————————————————————————————————————

initTheme();
initForms();
initVisibility();
void load({ silent: false }).then(schedulePoll);
