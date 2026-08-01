'use client';

/**
 * Reference client — copy this file into your app and point it at the route
 * created by `unticked/adapters/next`. It renders from `ls --json` and writes
 * through the adapter; it never touches `.tickets/` itself.
 *
 * Styling is plain Tailwind on a dark surface. Restyle it freely — the whole
 * point is that the data contract survives whatever you do to the markup.
 */

import { useCallback, useEffect, useState } from 'react';

type Ticket = {
  id: string;
  title: string;
  status: 'open' | 'doing' | 'closed';
  priority: 'p0' | 'p1' | 'p2' | 'p3';
  tags: string[];
  docs: string[];
  created: string | null;
  closed: string | null;
  body: string;
  file: string;
};

const PRIORITY_STYLE: Record<string, string> = {
  p0: 'bg-red-500/15 text-red-400 border-red-500/30',
  p1: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  p2: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  p3: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

const COLUMNS = [
  { status: 'open', label: '待办' },
  { status: 'doing', label: '进行中' },
  { status: 'closed', label: '已关闭' },
] as const;

/** Derived from a doc's tickets by the server — never stored. */
type DocStatus = {
  doc: string;
  status: 'todo' | 'doing' | 'done' | 'archived';
  total: number;
  open: number;
  doing: number;
  closed: number;
};

const DOC_LABEL: Record<DocStatus['status'], string> = {
  todo: '未开始',
  doing: '进行中',
  done: '已完成',
  archived: '已归档',
};

const DOC_STYLE: Record<DocStatus['status'], string> = {
  todo: 'text-gray-400',
  doing: 'text-sky-400',
  done: 'text-emerald-400',
  archived: 'text-gray-600',
};

export default function TicketBoard({ endpoint = '/api/tickets' }: { endpoint?: string }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [docs, setDocs] = useState<DocStatus[]>([]);
  const [orphanDocs, setOrphanDocs] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${endpoint}?status=all`, { cache: 'no-store' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setTickets(data.tickets);
      setDocs(data.docs ?? []);
      setOrphanDocs(data.orphanDocs ?? []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  const write = async (body: Record<string, unknown>) => {
    const res = await fetch(endpoint, { method: 'POST', body: JSON.stringify(body) });
    const data = await res.json();
    if (data.error) setError(data.error);
    await load();
  };

  const needle = q.trim().toLowerCase();
  const visible = needle
    ? tickets.filter(t => (t.title + t.body + t.tags.join() + t.docs.join()).toLowerCase().includes(needle))
    : tickets;

  return (
    <div className="p-6 space-y-4 text-gray-100">
      <div className="flex flex-wrap gap-3 items-center">
        <h1 className="text-xl font-bold">Tickets</h1>
        <span className="text-sm text-gray-500">
          {tickets.filter(t => t.status !== 'closed').length} 项未完成
        </span>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="搜索标题 / 正文 / 标签 / 文档"
          className="ml-auto w-64 px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-sm outline-none focus:border-blue-500/50"
        />
      </div>

      <form
        onSubmit={e => {
          e.preventDefault();
          if (!title.trim()) return;
          void write({ action: 'create', title });
          setTitle('');
        }}
        className="flex gap-2"
      >
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="新建 ticket：一句话说清要做什么"
          className="flex-1 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm outline-none focus:border-blue-500/50"
        />
        <button type="submit" className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium">
          新建
        </button>
      </form>

      {error && <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">{error}</div>}

      {docs.length > 0 && (
        <section className="rounded-lg bg-gray-900 border border-gray-800 p-3 space-y-1.5">
          <h2 className="text-sm font-semibold text-gray-400">
            关联文档 <span className="text-gray-600">{docs.length}</span>
            <span className="ml-2 font-normal text-[11px] text-gray-600">状态由该文档的 ticket 推导，不单独存储</span>
          </h2>
          {docs.map(d => (
            <div key={d.doc} className="flex items-center gap-2 text-xs">
              <span className={`w-12 shrink-0 ${DOC_STYLE[d.status]}`}>{DOC_LABEL[d.status]}</span>
              <span className="font-mono text-gray-300 truncate" title={d.doc}>
                {d.doc}
              </span>
              <span className="text-gray-600 shrink-0">
                {d.closed}/{d.total}
              </span>
              {d.status === 'done' && (
                <button
                  onClick={() => {
                    if (confirm(`归档 ${d.doc}？\n文件会移到归档目录，引用它的 ticket 会自动改指向新路径。`)) {
                      void write({ action: 'archive', doc: d.doc });
                    }
                  }}
                  className="ml-auto shrink-0 px-2 py-0.5 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30"
                >
                  归档
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {orphanDocs.length > 0 && (
        <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-300">
          这些文档的 ticket 已全部关闭，可以归档：{orphanDocs.join('、')}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map(col => {
          const items = visible.filter(t => t.status === col.status);
          return (
            <section key={col.status} className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-400">
                {col.label} <span className="text-gray-600">{items.length}</span>
              </h2>
              {items.map(t => (
                <article key={t.id} className="rounded-lg bg-gray-900 border border-gray-800 p-3 space-y-2">
                  <button onClick={() => setOpen(open === t.id ? null : t.id)} className="w-full text-left space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${PRIORITY_STYLE[t.priority]}`}>
                        {t.priority}
                      </span>
                      <span className="font-mono text-xs text-gray-500">{t.id}</span>
                    </div>
                    <div className={`text-sm ${t.status === 'closed' ? 'text-gray-500 line-through' : ''}`}>{t.title}</div>
                    {(t.tags.length > 0 || t.docs.length > 0) && (
                      <div className="flex flex-wrap gap-1 text-[11px] text-gray-500">
                        {t.tags.map(tag => (
                          <span key={tag} className="px-1.5 py-0.5 rounded bg-gray-800">
                            #{tag}
                          </span>
                        ))}
                        {t.docs.map(d => (
                          <span key={d} className="px-1.5 py-0.5 rounded bg-gray-800 font-mono" title={d}>
                            → {d.split('/').pop()}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>

                  {open === t.id && (
                    <pre className="text-xs text-gray-400 whitespace-pre-wrap border-t border-gray-800 pt-2">{t.body}</pre>
                  )}

                  <div className="flex gap-1.5 text-xs">
                    {t.status !== 'doing' && t.status !== 'closed' && (
                      <button onClick={() => write({ action: 'status', id: t.id, status: 'doing' })} className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700">
                        开始
                      </button>
                    )}
                    {t.status !== 'closed' ? (
                      <button onClick={() => write({ action: 'status', id: t.id, status: 'closed' })} className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700">
                        关闭
                      </button>
                    ) : (
                      <button onClick={() => write({ action: 'status', id: t.id, status: 'open' })} className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700">
                        重开
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (confirm(`删除 ${t.id}「${t.title}」？\n这不是关闭，是彻底删掉，不可恢复。`)) {
                          void write({ action: 'remove', id: t.id });
                        }
                      }}
                      className="px-2 py-1 rounded text-gray-600 hover:bg-red-500/15 hover:text-red-400"
                    >
                      删除
                    </button>
                    <span className="ml-auto self-center font-mono text-[10px] text-gray-600">{t.file}</span>
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
