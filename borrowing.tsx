import { useMemo, useState, type ReactNode } from 'react';
import type {
  BlueFileBorrowInput,
  BlueFileLoan,
  BlueFileRecord,
  BlueFileReturnInput,
} from '@workspace/api-client-react';
import {
  AlertCircle, CalendarDays, Check, Clock3, FileText, History, Inbox, Layers3,
  LogOut, MapPin, Package, PackageCheck, Search, Truck, Undo2, UserRound, X,
} from 'lucide-react';

export type Status = BlueFileRecord['status'];

export const STATUS_META: Record<Status, { label: string; badge: string; dot: string }> = {
  available: { label: 'Available', badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', dot: 'bg-emerald-400' },
  borrowed: { label: 'Borrowed', badge: 'border-violet-500/30 bg-violet-500/10 text-violet-300', dot: 'bg-violet-400' },
  in_transit: { label: 'In Transit Area', badge: 'border-amber-500/30 bg-amber-500/10 text-amber-300', dot: 'bg-amber-400' },
};

export function StatusBadge({ status }: { status: Status }) {
  const meta = STATUS_META[status];
  return (
    <span data-testid={`badge-status-${status}`} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(minutes: number): string {
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (minutes < 1440) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(minutes / 1440);
  return `${days}d ${Math.floor((minutes % 1440) / 60)}h`;
}

export function minutesSince(value: string | null | undefined): number {
  if (!value) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
}

/** Value for <input type="datetime-local"> in the user's local time. */
function toLocalInputValue(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Returns an ISO string, or null when the field is empty/invalid. */
function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isFuture(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() > Date.now() + 5 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Dashboard summary cards
// ---------------------------------------------------------------------------

type StatusSummary = { total_files: number; available_files: number; borrowed_files: number; in_transit_files: number };

export function StatusCards({ summary, loading }: { summary?: StatusSummary; loading: boolean }) {
  const cards = [
    { key: 'total', label: 'Total Blue Files', value: summary?.total_files ?? 0, icon: Layers3, accent: 'text-sky-300', iconBg: 'bg-sky-500/10', border: 'border-sky-500/20' },
    { key: 'available', label: 'Available', value: summary?.available_files ?? 0, icon: PackageCheck, accent: 'text-emerald-300', iconBg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
    { key: 'borrowed', label: 'Borrowed', value: summary?.borrowed_files ?? 0, icon: Package, accent: 'text-violet-300', iconBg: 'bg-violet-500/10', border: 'border-violet-500/20' },
    { key: 'transit', label: 'In Transit Area', value: summary?.in_transit_files ?? 0, icon: Truck, accent: 'text-amber-300', iconBg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.key} data-testid={`card-status-${card.key}`} className={`flex min-h-[88px] items-center gap-3 rounded-xl border ${card.border} bg-[#111a28] px-3.5 py-3.5 sm:px-4`}>
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${card.iconBg} ${card.accent}`}><Icon className="h-[18px] w-[18px]" /></span>
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-medium text-slate-500">{card.label}</span>
              <span data-testid={`text-status-${card.key}`} className={`mt-0.5 block text-[22px] font-bold tracking-[-.03em] ${card.accent}`}>
                {loading ? <span className="inline-block h-6 w-14 animate-pulse rounded bg-slate-800" /> : card.value.toLocaleString()}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog shell + forms
// ---------------------------------------------------------------------------

function DialogShell({ title, subtitle, icon, tone, busy, onClose, footer, testId, children }: {
  title: string; subtitle: string; icon: ReactNode; tone: string; busy: boolean; onClose: () => void; footer: ReactNode; testId: string; children: ReactNode;
}) {
  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label={title} data-testid={testId} className="modal-panel my-auto w-full max-w-[520px] overflow-hidden rounded-2xl border border-slate-700 bg-[#131d2b] shadow-2xl">
        <header className="flex items-start justify-between border-b border-slate-800 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
            <div><h2 className="font-bold text-slate-100">{title}</h2><p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p></div>
          </div>
          <button aria-label="Close dialog" onClick={onClose} disabled={busy} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40"><X className="h-5 w-5" /></button>
        </header>
        <div className="max-h-[min(68vh,620px)] space-y-4 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        <footer className="flex items-center justify-end gap-2 border-t border-slate-800 bg-[#101926] px-5 py-4 sm:px-6">{footer}</footer>
      </section>
    </div>
  );
}

const inputClass = 'w-full rounded-lg border border-slate-700 bg-[#0d1521] px-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-500/70 focus:ring-2 focus:ring-sky-500/10';

function RecordSummary({ record }: { record: BlueFileRecord }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-[#0d1521] p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300"><FileText className="h-4 w-4" /></span>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-slate-100">{record.wo}</div>
        <div className="mono mt-0.5 text-[11px] text-slate-500">No {record.no ?? '—'} · Rack slot {record.place}</div>
      </div>
      <div className="ml-auto"><StatusBadge status={record.status} /></div>
    </div>
  );
}

export function BorrowDialog({ record, onClose, onSubmit }: {
  record: BlueFileRecord;
  onClose: () => void;
  onSubmit: (data: BlueFileBorrowInput) => Promise<boolean>;
}) {
  const [borrower, setBorrower] = useState('');
  const [borrowedAt, setBorrowedAt] = useState(() => toLocalInputValue());
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const futureDate = borrowedAt ? isFuture(borrowedAt) : false;
  const canSubmit = Boolean(borrower.trim() && borrowedAt && !futureDate);

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    await onSubmit({ borrower_name: borrower.trim(), borrowed_at: fromLocalInputValue(borrowedAt), remarks: remarks.trim() || null });
    setSaving(false);
  };

  return (
    <DialogShell testId="dialog-borrow" title="Borrow Blue File" subtitle="Record who is taking this file" tone="bg-violet-500/10 text-violet-300" icon={<LogOut className="h-5 w-5" />} busy={saving} onClose={onClose}
      footer={<>
        <button data-testid="button-cancel-borrow" onClick={onClose} disabled={saving} className="h-9 rounded-lg border border-slate-700 px-4 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-40">Cancel</button>
        <button data-testid="button-confirm-borrow" onClick={() => void submit()} disabled={!canSubmit || saving} className="inline-flex h-9 items-center gap-2 rounded-lg bg-violet-500 px-4 text-xs font-bold text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-45">{saving ? 'Saving…' : <><Check className="h-3.5 w-3.5" />Confirm borrow</>}</button>
      </>}>
      <RecordSummary record={record} />
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold text-slate-400">Borrower name<span className="ml-1 text-red-400">*</span></span>
        <input data-testid="input-borrower" autoFocus value={borrower} onChange={(event) => setBorrower(event.target.value)} placeholder="Who is borrowing this file?" className={`${inputClass} h-10`} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold text-slate-400">Borrow date &amp; time<span className="ml-1 text-red-400">*</span></span>
        <input data-testid="input-borrow-date" type="datetime-local" value={borrowedAt} onChange={(event) => setBorrowedAt(event.target.value)} className={`${inputClass} h-10`} />
        {futureDate && <span className="mt-1.5 block text-[11px] text-red-400">The borrow date cannot be in the future.</span>}
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold text-slate-400">Remarks <span className="font-normal text-slate-600">(optional)</span></span>
        <textarea data-testid="input-borrow-remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={3} placeholder="Purpose, expected return, etc." className={`${inputClass} resize-none py-2`} />
      </label>
    </DialogShell>
  );
}

export function ReturnDialog({ record, onClose, onSubmit }: {
  record: BlueFileRecord;
  onClose: () => void;
  onSubmit: (data: BlueFileReturnInput) => Promise<boolean>;
}) {
  const [returnTo, setReturnTo] = useState<'available' | 'in_transit'>('available');
  const [returnedAt, setReturnedAt] = useState(() => toLocalInputValue());
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const futureDate = returnedAt ? isFuture(returnedAt) : false;
  const beforeBorrow = Boolean(record.borrowed_at && returnedAt && new Date(returnedAt).getTime() < new Date(record.borrowed_at).getTime());
  const canSubmit = Boolean(returnedAt && !futureDate && !beforeBorrow);

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    await onSubmit({ return_to: returnTo, returned_at: fromLocalInputValue(returnedAt), remarks: remarks.trim() || null });
    setSaving(false);
  };

  const options: { value: 'available' | 'in_transit'; title: string; hint: string; icon: ReactNode }[] = [
    { value: 'available', title: 'Available', hint: `Back in its rack slot (${record.place})`, icon: <PackageCheck className="h-4 w-4" /> },
    { value: 'in_transit', title: 'Transit Area', hint: 'Returned, but not yet placed in its rack', icon: <Truck className="h-4 w-4" /> },
  ];

  return (
    <DialogShell testId="dialog-return" title="Return Blue File" subtitle="Close the loan and record where the file went" tone="bg-sky-500/10 text-sky-300" icon={<Undo2 className="h-5 w-5" />} busy={saving} onClose={onClose}
      footer={<>
        <button data-testid="button-cancel-return" onClick={onClose} disabled={saving} className="h-9 rounded-lg border border-slate-700 px-4 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-40">Cancel</button>
        <button data-testid="button-confirm-return" onClick={() => void submit()} disabled={!canSubmit || saving} className="inline-flex h-9 items-center gap-2 rounded-lg bg-sky-500 px-4 text-xs font-bold text-slate-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-45">{saving ? 'Saving…' : <><Check className="h-3.5 w-3.5" />Confirm return</>}</button>
      </>}>
      <RecordSummary record={record} />
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-violet-500/15 bg-violet-500/[.05] p-3 text-xs">
        <div><div className="text-[10px] uppercase tracking-[.12em] text-slate-500">Borrowed by</div><div className="mt-0.5 font-semibold text-slate-200">{record.borrower_name ?? '—'}</div></div>
        <div><div className="text-[10px] uppercase tracking-[.12em] text-slate-500">Since</div><div className="mt-0.5 font-semibold text-slate-200">{formatDateTime(record.borrowed_at)}</div></div>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-[11px] font-semibold text-slate-400">Return to</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {options.map((option) => (
            <label key={option.value} className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition ${returnTo === option.value ? 'border-sky-400/60 bg-sky-500/10' : 'border-slate-700 bg-[#0d1521] hover:border-slate-600'}`}>
              <input data-testid={`radio-return-${option.value}`} type="radio" name="return-to" value={option.value} checked={returnTo === option.value} onChange={() => setReturnTo(option.value)} className="mt-1 accent-sky-400" />
              <span><span className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">{option.icon}{option.title}</span><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{option.hint}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold text-slate-400">Return date &amp; time<span className="ml-1 text-red-400">*</span></span>
        <input data-testid="input-return-date" type="datetime-local" value={returnedAt} onChange={(event) => setReturnedAt(event.target.value)} className={`${inputClass} h-10`} />
        {futureDate && <span className="mt-1.5 block text-[11px] text-red-400">The return date cannot be in the future.</span>}
        {beforeBorrow && <span className="mt-1.5 block text-[11px] text-red-400">The return date cannot be before the borrow date.</span>}
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold text-slate-400">Remarks <span className="font-normal text-slate-600">(optional)</span></span>
        <textarea data-testid="input-return-remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={2} placeholder="Condition of the file, notes…" className={`${inputClass} resize-none py-2`} />
      </label>
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// Borrowed Blue Files page
// ---------------------------------------------------------------------------

function SearchBox({ value, onChange, placeholder, testId }: { value: string; onChange: (value: string) => void; placeholder: string; testId: string }) {
  return (
    <div className="relative w-full sm:max-w-xs">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
      <input data-testid={testId} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={`${inputClass} h-10 pl-9`} />
    </div>
  );
}

function EmptyState({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 px-6 py-14 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-700 bg-slate-800/70 text-slate-400">{icon}</div>
      <h3 className="mt-4 text-lg font-bold text-slate-200">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{text}</p>
    </div>
  );
}

const th = 'whitespace-nowrap px-3.5 py-3 font-semibold';
const td = 'px-3.5 py-3 align-top';

export function BorrowedPage({ records, summary, loading, onOpen, onReturn, onBorrow, onPlaceInRack }: {
  records: BlueFileRecord[];
  summary?: StatusSummary;
  loading: boolean;
  onOpen: (record: BlueFileRecord) => void;
  onReturn: (record: BlueFileRecord) => void;
  onBorrow: (record: BlueFileRecord) => void;
  onPlaceInRack: (record: BlueFileRecord) => void;
}) {
  const [tab, setTab] = useState<'borrowed' | 'in_transit'>('borrowed');
  const [query, setQuery] = useState('');

  const counts = useMemo(() => ({
    borrowed: records.filter((r) => r.status === 'borrowed').length,
    in_transit: records.filter((r) => r.status === 'in_transit').length,
  }), [records]);

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase();
    return records
      .filter((r) => r.status === tab)
      .filter((r) => !q || [r.wo, r.borrower_name ?? '', String(r.no ?? ''), r.place].some((v) => v.toUpperCase().includes(q)))
      // Oldest loans first: the files most at risk of being lost.
      .sort((a, b) => new Date(a.borrowed_at ?? a.updated_at).getTime() - new Date(b.borrowed_at ?? b.updated_at).getTime());
  }, [records, tab, query]);

  const tabs = [
    { key: 'borrowed' as const, label: 'Borrowed', count: counts.borrowed },
    { key: 'in_transit' as const, label: 'In Transit Area', count: counts.in_transit },
  ];

  return (
    <div data-testid="page-borrowed">
      <div className="mb-5">
        <p className="mb-1 text-[10px] font-bold tracking-[.18em] text-violet-400">CUSTODY TRACKING</p>
        <h2 className="text-[22px] font-bold tracking-[-.035em] text-slate-100 sm:text-[26px]">Borrowed Blue Files</h2>
        <p className="mt-1 text-sm text-slate-500">Files that are out of their rack: who has them, since when, and which ones are waiting in the Transit Area.</p>
      </div>
      <StatusCards summary={summary} loading={loading} />

      <section className="mt-6 rounded-2xl border border-slate-800 bg-[#111a28] p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-1 rounded-lg border border-slate-700/80 bg-[#0c1420] p-1">
            {tabs.map((item) => (
              <button key={item.key} data-testid={`tab-${item.key}`} onClick={() => setTab(item.key)} className={`inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-semibold transition ${tab === item.key ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-slate-100'}`}>
                {item.label}<span className={`mono rounded px-1.5 text-[10px] ${tab === item.key ? 'bg-slate-950/20' : 'bg-slate-800 text-slate-400'}`}>{item.count}</span>
              </button>
            ))}
          </div>
          <SearchBox testId="input-borrowed-search" value={query} onChange={setQuery} placeholder="Search file, borrower or place…" />
        </div>

        <div className="mt-4">
          {loading ? (
            <div className="space-y-2">{[1, 2, 3, 4].map((n) => <div key={n} className="h-12 animate-pulse rounded-lg bg-slate-800/50" />)}</div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={tab === 'borrowed' ? <Inbox className="h-6 w-6" /> : <Truck className="h-6 w-6" />}
              title={query ? 'No matching files' : tab === 'borrowed' ? 'No borrowed blue files' : 'The Transit Area is empty'}
              text={query ? 'Try a different search.' : tab === 'borrowed' ? 'Every blue file is accounted for. Borrowed files will appear here with who has them.' : 'Files taken from a rack but not yet re-shelved will appear here.'}
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full min-w-[860px] text-left text-xs">
                <thead className="border-b border-slate-800 bg-[#0d1521] text-[10px] uppercase tracking-[.1em] text-slate-500">
                  <tr><th className={th}>Blue File No</th><th className={th}>Blue File Name</th><th className={th}>Borrower</th><th className={th}>Borrow Date</th><th className={th}>Current Status</th><th className={th}>Current Location</th><th className={`${th} text-right`}>Action</th></tr>
                </thead>
                <tbody>
                  {rows.map((record) => (
                    <tr key={record.id} data-testid={`row-borrowed-${record.id}`} className="border-b border-slate-800/80 last:border-0 hover:bg-slate-900/40">
                      <td className={`${td} mono text-slate-400`}>{record.no ?? '—'}</td>
                      <td className={td}>
                        <button onClick={() => onOpen(record)} className="font-semibold text-sky-300 hover:text-sky-200">{record.wo}</button>
                        <div className="mono mt-0.5 text-[10px] text-slate-500">Rack slot {record.place}</div>
                      </td>
                      <td className={td}>
                        {record.borrower_name ? <><span className="flex items-center gap-1.5 font-medium text-slate-200"><UserRound className="h-3.5 w-3.5 text-slate-500" />{record.borrower_name}</span>{record.borrow_remarks && <div className="mt-0.5 max-w-[220px] truncate text-[10px] text-slate-500" title={record.borrow_remarks}>{record.borrow_remarks}</div>}</> : <span className="text-slate-600">—</span>}
                      </td>
                      <td className={td}>
                        {record.borrowed_at ? <><div className="text-slate-300">{formatDateTime(record.borrowed_at)}</div><div className="mt-0.5 text-[10px] text-slate-500">{formatDuration(minutesSince(record.borrowed_at))} ago</div></> : <span className="text-slate-600">—</span>}
                      </td>
                      <td className={td}><StatusBadge status={record.status} /></td>
                      <td className={`${td} text-slate-300`}><span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 shrink-0 text-slate-500" />{record.current_location}</span></td>
                      <td className={`${td} text-right`}>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {record.status === 'borrowed' ? (
                            <button data-testid={`button-return-${record.id}`} onClick={() => onReturn(record)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-sky-500 px-3 text-[11px] font-bold text-slate-950 hover:bg-sky-400"><Undo2 className="h-3.5 w-3.5" />Return</button>
                          ) : (
                            <>
                              <button data-testid={`button-place-${record.id}`} onClick={() => onPlaceInRack(record)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-500 px-3 text-[11px] font-bold text-slate-950 hover:bg-emerald-400"><PackageCheck className="h-3.5 w-3.5" />Place in rack</button>
                              <button onClick={() => onBorrow(record)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-700 px-3 text-[11px] font-semibold text-slate-300 hover:bg-slate-800"><LogOut className="h-3.5 w-3.5" />Borrow</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Borrowing history page
// ---------------------------------------------------------------------------

export function HistoryPage({ loans, loading, error, onRetry }: { loans: BlueFileLoan[]; loading: boolean; error: boolean; onRetry: () => void }) {
  const [query, setQuery] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase();
    return loans
      .filter((l) => !activeOnly || l.is_active)
      .filter((l) => !q || [l.wo, l.borrower_name, String(l.no ?? ''), l.place].some((v) => v.toUpperCase().includes(q)));
  }, [loans, query, activeOnly]);

  return (
    <div data-testid="page-history">
      <div className="mb-5">
        <p className="mb-1 text-[10px] font-bold tracking-[.18em] text-sky-400">TRACEABILITY</p>
        <h2 className="text-[22px] font-bold tracking-[-.035em] text-slate-100 sm:text-[26px]">Borrowing History</h2>
        <p className="mt-1 text-sm text-slate-500">A permanent log of every loan: who borrowed, when it went out, when it came back and for how long.</p>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-[#111a28] p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-300">
            <input data-testid="checkbox-active-only" type="checkbox" checked={activeOnly} onChange={(event) => setActiveOnly(event.target.checked)} className="h-4 w-4 accent-sky-400" />
            Show only files not yet returned
          </label>
          <SearchBox testId="input-history-search" value={query} onChange={setQuery} placeholder="Search file, borrower or place…" />
        </div>

        <div className="mt-4">
          {error ? (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-red-500/30 bg-red-500/[.08] px-4 py-3 text-sm text-red-200"><span className="flex items-center gap-2"><AlertCircle className="h-4 w-4 shrink-0" />Borrowing history could not be loaded.</span><button onClick={onRetry} className="rounded-md bg-red-500/10 px-3 py-1.5 font-semibold hover:bg-red-500/20">Retry</button></div>
          ) : loading ? (
            <div className="space-y-2">{[1, 2, 3, 4].map((n) => <div key={n} className="h-12 animate-pulse rounded-lg bg-slate-800/50" />)}</div>
          ) : rows.length === 0 ? (
            <EmptyState icon={<History className="h-6 w-6" />} title={loans.length === 0 ? 'No borrowing history yet' : 'No matching records'} text={loans.length === 0 ? 'When a blue file is borrowed it will be logged here, and stays here after it is returned.' : 'Try a different search or filter.'} />
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full min-w-[980px] text-left text-xs">
                  <thead className="border-b border-slate-800 bg-[#0d1521] text-[10px] uppercase tracking-[.1em] text-slate-500">
                    <tr><th className={th}>Blue File No</th><th className={th}>Blue File Name</th><th className={th}>Borrower</th><th className={th}>Borrow Date</th><th className={th}>Return Date</th><th className={th}>Duration</th><th className={th}>Returned To</th><th className={th}>Remarks</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((loan) => (
                      <tr key={loan.id} data-testid={`row-loan-${loan.id}`} className="border-b border-slate-800/80 last:border-0 hover:bg-slate-900/40">
                        <td className={`${td} mono text-slate-400`}>{loan.no ?? '—'}</td>
                        <td className={td}><div className="font-semibold text-slate-200">{loan.wo}</div><div className="mono mt-0.5 text-[10px] text-slate-500">{loan.place}{loan.record_id === null ? ' · record removed' : ''}</div></td>
                        <td className={`${td} font-medium text-slate-200`}>{loan.borrower_name}</td>
                        <td className={`${td} text-slate-300`}><span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-slate-500" />{formatDateTime(loan.borrowed_at)}</span></td>
                        <td className={td}>{loan.returned_at ? <span className="flex items-center gap-1.5 text-slate-300"><CalendarDays className="h-3.5 w-3.5 text-slate-500" />{formatDateTime(loan.returned_at)}</span> : <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[11px] font-semibold text-violet-300">Still borrowed</span>}</td>
                        <td className={`${td} whitespace-nowrap text-slate-300`}><span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5 text-slate-500" />{formatDuration(loan.duration_minutes)}{loan.is_active && <span className="text-[10px] text-slate-500">so far</span>}</span></td>
                        <td className={td}>{loan.returned_to ? <StatusBadge status={loan.returned_to} /> : <span className="text-slate-600">—</span>}</td>
                        <td className={`${td} max-w-[260px] text-slate-400`}>
                          {loan.borrow_remarks || loan.return_remarks ? <>
                            {loan.borrow_remarks && <div><span className="text-slate-600">Borrow: </span>{loan.borrow_remarks}</div>}
                            {loan.return_remarks && <div className="mt-0.5"><span className="text-slate-600">Return: </span>{loan.return_remarks}</div>}
                          </> : <span className="text-slate-600">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[11px] text-slate-600">{rows.length.toLocaleString()} of {loans.length.toLocaleString()} loans</p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
