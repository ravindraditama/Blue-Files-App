import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  BlueFileAuditEntry,
  BlueFileRecord,
  BlueFileTransitCompleteInput,
  BlueFileTransitInput,
} from '@workspace/api-client-react';
import { AlertCircle, ArrowRight, CalendarDays, Check, Clock3, History, PackageCheck, Search, Truck, UserRound, X } from 'lucide-react';
import { parsePlace, TRANSIT_PLACE } from '@/lib/place';
import { loadUserName, saveUserName } from '@/lib/user-name';
import {
  DialogShell, EmptyState, RecordSummary, StatusBadge, formatDateTime, formatDuration, fromLocalInputValue,
  inputClass, isFuture, td, th, toLocalInputValue,
} from './borrowing';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Re-renders every `intervalMs` so "time in transit" keeps counting up. */
function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function minutesBetween(from: string | null, now: number): number {
  if (!from) return 0;
  return Math.max(0, Math.floor((now - new Date(from).getTime()) / 60000));
}

/** yyyy-mm-dd in the user's local time, to compare with <input type="date">. */
function localDateKey(value: string): string {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const compactPlace = (value: string) => value.trim().toUpperCase().replace(/\s+/g, '');

function PlaceFlow({ from, to }: { from: string; to: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[.05] p-3 text-xs">
      <span className="mono rounded bg-slate-800 px-2 py-1 text-slate-200">{from}</span>
      <ArrowRight className="h-3.5 w-3.5 text-slate-500" />
      <span className="mono rounded bg-amber-500/15 px-2 py-1 font-semibold text-amber-300">{TRANSIT_PLACE}</span>
      <ArrowRight className="h-3.5 w-3.5 text-slate-500" />
      <span className="mono rounded bg-slate-800 px-2 py-1 text-slate-200">{to}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Move to TRANSIT
// ---------------------------------------------------------------------------

export function TransitDialog({ record, records, onClose, onSubmit }: {
  record: BlueFileRecord;
  records: BlueFileRecord[];
  onClose: () => void;
  onSubmit: (data: BlueFileTransitInput) => Promise<boolean>;
}) {
  const [by, setBy] = useState(() => loadUserName());
  const [destination, setDestination] = useState(record.place);
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const parsed = parsePlace(destination);
  const taken = Boolean(parsed && records.some((row) => row.id !== record.id && row.place.toUpperCase() === parsed.place));
  const canSubmit = Boolean(by.trim() && parsed && !taken);

  const submit = async () => {
    if (!canSubmit || !parsed) return;
    setSaving(true);
    saveUserName(by);
    await onSubmit({ destination_place: parsed.place, transit_by: by.trim(), remarks: remarks.trim() || null });
    setSaving(false);
  };

  return (
    <DialogShell testId="dialog-transit" title="Move to TRANSIT" subtitle="The file leaves its rack and is tracked until delivered" tone="bg-amber-500/10 text-amber-300" icon={<Truck className="h-5 w-5" />} busy={saving} onClose={onClose}
      footer={<>
        <button data-testid="button-cancel-transit" onClick={onClose} disabled={saving} className="h-9 rounded-lg border border-slate-700 px-4 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-40">Cancel</button>
        <button data-testid="button-confirm-transit" onClick={() => void submit()} disabled={!canSubmit || saving} className="inline-flex h-9 items-center gap-2 rounded-lg bg-amber-500 px-4 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-45">{saving ? 'Saving…' : <><Truck className="h-3.5 w-3.5" />Move to TRANSIT</>}</button>
      </>}>
      <RecordSummary record={record} />
      <PlaceFlow from={record.place} to={parsed?.place ?? '—'} />
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold text-slate-400">Moved by<span className="ml-1 text-red-400">*</span></span>
        <input data-testid="input-transit-by" autoFocus value={by} onChange={(event) => setBy(event.target.value)} placeholder="Your name" className={`${inputClass} h-10`} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold text-slate-400">Destination place<span className="ml-1 text-red-400">*</span> <span className="font-normal text-slate-600">(where it will be stored, e.g. B05L-003)</span></span>
        <input data-testid="input-transit-destination" value={destination} onChange={(event) => setDestination(event.target.value.toUpperCase())} className={`${inputClass} mono h-10`} />
        {destination && !parsed && <span className="mt-1.5 block text-[11px] text-red-400">Invalid format. Use a place code such as A16R-001.</span>}
        {taken && <span className="mt-1.5 block text-[11px] text-red-400">{parsed?.place} is already used by another file.</span>}
        {parsed && !taken && <span className="mt-1.5 block text-[11px] text-emerald-400">{parsed.place} is available.</span>}
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold text-slate-400">Remarks <span className="font-normal text-slate-600">(optional)</span></span>
        <textarea data-testid="input-transit-remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={2} placeholder="Reason for the move…" className={`${inputClass} resize-none py-2`} />
      </label>
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// Complete Transit
// ---------------------------------------------------------------------------

export function CompleteTransitDialog({ record, records, onClose, onSubmit }: {
  record: BlueFileRecord;
  records: BlueFileRecord[];
  onClose: () => void;
  onSubmit: (data: BlueFileTransitCompleteInput) => Promise<boolean>;
}) {
  const plannedDestination = record.destination_place ?? '';
  const [by, setBy] = useState(() => loadUserName());
  const [destination, setDestination] = useState(plannedDestination);
  const [receivedAt, setReceivedAt] = useState(() => toLocalInputValue());
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const parsed = parsePlace(destination);
  const taken = Boolean(parsed && records.some((row) => row.id !== record.id && row.place.toUpperCase() === parsed.place));
  const futureDate = receivedAt ? isFuture(receivedAt) : false;
  const beforeTransit = Boolean(record.transit_at && receivedAt && new Date(receivedAt).getTime() < new Date(record.transit_at).getTime());
  const canSubmit = Boolean(by.trim() && parsed && !taken && receivedAt && !futureDate && !beforeTransit);
  const changed = Boolean(parsed && parsed.place !== plannedDestination.toUpperCase());

  const submit = async () => {
    if (!canSubmit || !parsed) return;
    setSaving(true);
    saveUserName(by);
    await onSubmit({
      received_by: by.trim(),
      destination_place: changed ? parsed.place : null,
      received_at: fromLocalInputValue(receivedAt),
      remarks: remarks.trim() || null,
    });
    setSaving(false);
  };

  return (
    <DialogShell testId="dialog-complete-transit" title="Complete Transit" subtitle="Deliver the file from TRANSIT to its place" tone="bg-emerald-500/10 text-emerald-300" icon={<PackageCheck className="h-5 w-5" />} busy={saving} onClose={onClose}
      footer={<>
        <button data-testid="button-cancel-complete" onClick={onClose} disabled={saving} className="h-9 rounded-lg border border-slate-700 px-4 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-40">Cancel</button>
        <button data-testid="button-confirm-complete" onClick={() => void submit()} disabled={!canSubmit || saving} className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-500 px-4 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-45">{saving ? 'Saving…' : <><Check className="h-3.5 w-3.5" />Complete Transit</>}</button>
      </>}>
      <RecordSummary record={record} />
      <PlaceFlow from={record.previous_place ?? '—'} to={parsed?.place ?? '—'} />
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-[#0d1521] p-3 text-xs">
        <div><div className="text-[10px] uppercase tracking-[.12em] text-slate-500">Moved by</div><div className="mt-0.5 font-semibold text-slate-200">{record.transit_by ?? '—'}</div></div>
        <div><div className="text-[10px] uppercase tracking-[.12em] text-slate-500">Transit date</div><div className="mt-0.5 font-semibold text-slate-200">{formatDateTime(record.transit_at)}</div></div>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold text-slate-400">Received by<span className="ml-1 text-red-400">*</span></span>
        <input data-testid="input-received-by" autoFocus value={by} onChange={(event) => setBy(event.target.value)} placeholder="Your name" className={`${inputClass} h-10`} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold text-slate-400">Delivered to<span className="ml-1 text-red-400">*</span></span>
        <input data-testid="input-complete-destination" value={destination} onChange={(event) => setDestination(event.target.value.toUpperCase())} className={`${inputClass} mono h-10`} />
        {destination && !parsed && <span className="mt-1.5 block text-[11px] text-red-400">Invalid format. Use a place code such as A16R-001.</span>}
        {taken && <span className="mt-1.5 block text-[11px] text-red-400">{parsed?.place} is now used by another file. Choose a different place.</span>}
        {changed && !taken && <span className="mt-1.5 block text-[11px] text-amber-400">Different from the planned destination ({plannedDestination || '—'}).</span>}
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold text-slate-400">Received date &amp; time<span className="ml-1 text-red-400">*</span></span>
        <input data-testid="input-received-date" type="datetime-local" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} className={`${inputClass} h-10`} />
        {futureDate && <span className="mt-1.5 block text-[11px] text-red-400">The received date cannot be in the future.</span>}
        {beforeTransit && <span className="mt-1.5 block text-[11px] text-red-400">The received date cannot be before the transit date.</span>}
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold text-slate-400">Remarks <span className="font-normal text-slate-600">(optional)</span></span>
        <textarea data-testid="input-complete-remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={2} className={`${inputClass} resize-none py-2`} />
      </label>
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// Transit Monitoring page
// ---------------------------------------------------------------------------

type Filters = { no: string; name: string; previous: string; destination: string; date: string };
const NO_FILTERS: Filters = { no: '', name: '', previous: '', destination: '', date: '' };

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-[.1em] text-slate-500">{label}</span>{children}</label>;
}

function MetricCard({ label, value, hint, testId }: { label: string; value: string; hint: string; testId: string }) {
  return (
    <div data-testid={testId} className="rounded-xl border border-amber-500/20 bg-[#111a28] px-4 py-3.5">
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className="mt-0.5 text-[22px] font-bold tracking-[-.03em] text-amber-300">{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>
    </div>
  );
}

export function TransitPage({ records, loading, audit, auditLoading, auditError, onRetryAudit, onOpen, onComplete }: {
  records: BlueFileRecord[];
  loading: boolean;
  audit: BlueFileAuditEntry[];
  auditLoading: boolean;
  auditError: boolean;
  onRetryAudit: () => void;
  onOpen: (record: BlueFileRecord) => void;
  onComplete: (record: BlueFileRecord) => void;
}) {
  const now = useNow();
  const [tab, setTab] = useState<'current' | 'audit'>('current');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [auditQuery, setAuditQuery] = useState('');

  const inTransit = useMemo(() => records.filter((row) => row.status === 'in_transit'), [records]);

  const rows = useMemo(() => {
    return inTransit
      .filter((row) => !filters.no.trim() || String(row.no ?? '').includes(filters.no.trim()))
      .filter((row) => !filters.name.trim() || row.wo.toUpperCase().includes(filters.name.trim().toUpperCase()))
      .filter((row) => !filters.previous.trim() || (row.previous_place ?? '').toUpperCase().includes(compactPlace(filters.previous)))
      .filter((row) => !filters.destination.trim() || (row.destination_place ?? '').toUpperCase().includes(compactPlace(filters.destination)))
      .filter((row) => !filters.date || (row.transit_at !== null && localDateKey(row.transit_at) === filters.date))
      // Longest in transit first.
      .sort((a, b) => new Date(a.transit_at ?? a.updated_at).getTime() - new Date(b.transit_at ?? b.updated_at).getTime());
  }, [inTransit, filters]);

  const auditRows = useMemo(() => {
    const q = auditQuery.trim().toUpperCase();
    if (!q) return audit;
    return audit.filter((entry) => [entry.wo, String(entry.no ?? ''), entry.performed_by, entry.source_place, entry.destination_place].some((value) => value.toUpperCase().includes(q)));
  }, [audit, auditQuery]);

  const todayKey = localDateKey(new Date(now).toISOString());
  const longest = inTransit.reduce((max, row) => Math.max(max, minutesBetween(row.transit_at, now)), 0);
  const movedToday = inTransit.filter((row) => row.transit_at !== null && localDateKey(row.transit_at) === todayKey).length;
  const filtersActive = Object.values(filters).some(Boolean);
  const setFilter = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const small = `${inputClass} h-9 text-xs`;

  const tabs = [
    { key: 'current' as const, label: 'Files in transit', count: inTransit.length },
    { key: 'audit' as const, label: 'Audit trail', count: audit.length },
  ];

  return (
    <div data-testid="page-transit">
      <div className="mb-5">
        <p className="mb-1 text-[10px] font-bold tracking-[.18em] text-amber-400">TRANSIT WORKFLOW</p>
        <h2 className="text-[22px] font-bold tracking-[-.035em] text-slate-100 sm:text-[26px]">Transit Monitoring</h2>
        <p className="mt-1 text-sm text-slate-500">Every file currently stored in <span className="mono text-amber-300">{TRANSIT_PLACE}</span>: where it came from, where it is going, who moved it and for how long.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard testId="card-transit-total" label="Total files in transit" value={loading ? '…' : String(inTransit.length)} hint="Currently in TRANSIT" />
        <MetricCard testId="card-transit-longest" label="Longest in transit" value={loading || inTransit.length === 0 ? '—' : formatDuration(longest)} hint="Oldest file still waiting" />
        <MetricCard testId="card-transit-today" label="Moved to transit today" value={loading ? '…' : String(movedToday)} hint="Among files still in transit" />
      </div>

      <section className="mt-6 rounded-2xl border border-slate-800 bg-[#111a28] p-4 sm:p-5">
        <div className="flex gap-1 self-start rounded-lg border border-slate-700/80 bg-[#0c1420] p-1 sm:inline-flex">
          {tabs.map((item) => (
            <button key={item.key} data-testid={`tab-transit-${item.key}`} onClick={() => setTab(item.key)} className={`inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-semibold transition ${tab === item.key ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-slate-100'}`}>
              {item.label}<span className={`mono rounded px-1.5 text-[10px] ${tab === item.key ? 'bg-slate-950/20' : 'bg-slate-800 text-slate-400'}`}>{item.count}</span>
            </button>
          ))}
        </div>

        {tab === 'current' ? (
          <>
            <div data-testid="filters-transit" className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              <FilterField label="File number"><input data-testid="filter-transit-no" value={filters.no} onChange={(event) => setFilter('no', event.target.value)} placeholder="e.g. 1152" className={small} /></FilterField>
              <FilterField label="File name"><input data-testid="filter-transit-name" value={filters.name} onChange={(event) => setFilter('name', event.target.value)} placeholder="Work order" className={small} /></FilterField>
              <FilterField label="Previous place"><input data-testid="filter-transit-previous" value={filters.previous} onChange={(event) => setFilter('previous', event.target.value)} placeholder="e.g. A16R" className={`${small} mono`} /></FilterField>
              <FilterField label="Destination place"><input data-testid="filter-transit-destination" value={filters.destination} onChange={(event) => setFilter('destination', event.target.value)} placeholder="e.g. B05L" className={`${small} mono`} /></FilterField>
              <FilterField label="Transit date"><input data-testid="filter-transit-date" type="date" value={filters.date} onChange={(event) => setFilter('date', event.target.value)} className={small} /></FilterField>
              <div className="flex items-end"><button data-testid="button-clear-transit-filters" onClick={() => setFilters(NO_FILTERS)} disabled={!filtersActive} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"><X className="h-3.5 w-3.5" />Clear filters</button></div>
            </div>

            <div className="mt-4">
              {loading ? (
                <div className="space-y-2">{[1, 2, 3].map((n) => <div key={n} className="h-12 animate-pulse rounded-lg bg-slate-800/50" />)}</div>
              ) : rows.length === 0 ? (
                <EmptyState icon={<Truck className="h-6 w-6" />} title={inTransit.length === 0 ? 'No files in transit' : 'No matching files'} text={inTransit.length === 0 ? 'Files moved to TRANSIT will be listed here until they are delivered to their place.' : 'Try different filters.'} />
              ) : (
                <>
                  <div className="overflow-x-auto rounded-xl border border-slate-800">
                    <table className="w-full min-w-[1080px] text-left text-xs">
                      <thead className="border-b border-slate-800 bg-[#0d1521] text-[10px] uppercase tracking-[.1em] text-slate-500">
                        <tr><th className={th}>File Number</th><th className={th}>File Name</th><th className={th}>Previous Place</th><th className={th}>Destination Place</th><th className={th}>Transit Date</th><th className={th}>Transit By</th><th className={th}>Duration in Transit</th><th className={th}>Status</th><th className={`${th} text-right`}>Action</th></tr>
                      </thead>
                      <tbody>
                        {rows.map((record) => {
                          const minutes = minutesBetween(record.transit_at, now);
                          return (
                            <tr key={record.id} data-testid={`row-transit-${record.id}`} className="border-b border-slate-800/80 last:border-0 hover:bg-slate-900/40">
                              <td className={`${td} mono text-slate-400`}>{record.no ?? '—'}</td>
                              <td className={td}><button onClick={() => onOpen(record)} className="font-semibold text-sky-300 hover:text-sky-200">{record.wo}</button></td>
                              <td className={`${td} mono text-slate-300`}>{record.previous_place ?? '—'}</td>
                              <td className={`${td} mono text-slate-300`}>{record.destination_place ?? '—'}</td>
                              <td className={`${td} text-slate-300`}><span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-slate-500" />{formatDateTime(record.transit_at)}</span></td>
                              <td className={td}><span className="flex items-center gap-1.5 font-medium text-slate-200"><UserRound className="h-3.5 w-3.5 text-slate-500" />{record.transit_by ?? '—'}</span></td>
                              <td className={`${td} whitespace-nowrap`}><span data-testid={`text-transit-duration-${record.id}`} className={`flex items-center gap-1.5 font-medium ${minutes >= 1440 ? 'text-red-300' : 'text-slate-200'}`}><Clock3 className="h-3.5 w-3.5 text-slate-500" />{formatDuration(minutes)}</span></td>
                              <td className={td}><StatusBadge status={record.status} /></td>
                              <td className={`${td} text-right`}><button data-testid={`button-complete-transit-${record.id}`} onClick={() => onComplete(record)} className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md bg-emerald-500 px-3 text-[11px] font-bold text-slate-950 hover:bg-emerald-400"><PackageCheck className="h-3.5 w-3.5" />Complete Transit</button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-[11px] text-slate-600">{rows.length.toLocaleString()} of {inTransit.length.toLocaleString()} files in transit</p>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="mt-4">
            <div className="flex justify-end">
              <div className="relative w-full sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input data-testid="input-audit-search" value={auditQuery} onChange={(event) => setAuditQuery(event.target.value)} placeholder="Search file, user or place…" className={`${inputClass} h-10 pl-9`} />
              </div>
            </div>
            <div className="mt-4">
              {auditError ? (
                <div className="flex items-center justify-between gap-4 rounded-xl border border-red-500/30 bg-red-500/[.08] px-4 py-3 text-sm text-red-200"><span className="flex items-center gap-2"><AlertCircle className="h-4 w-4 shrink-0" />The audit trail could not be loaded.</span><button onClick={onRetryAudit} className="rounded-md bg-red-500/10 px-3 py-1.5 font-semibold hover:bg-red-500/20">Retry</button></div>
              ) : auditLoading ? (
                <div className="space-y-2">{[1, 2, 3].map((n) => <div key={n} className="h-12 animate-pulse rounded-lg bg-slate-800/50" />)}</div>
              ) : auditRows.length === 0 ? (
                <EmptyState icon={<History className="h-6 w-6" />} title={audit.length === 0 ? 'No transit activity yet' : 'No matching entries'} text={audit.length === 0 ? 'Every move into TRANSIT and every delivery is logged here with who did it and when.' : 'Try a different search.'} />
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-800">
                  <table className="w-full min-w-[900px] text-left text-xs">
                    <thead className="border-b border-slate-800 bg-[#0d1521] text-[10px] uppercase tracking-[.1em] text-slate-500">
                      <tr><th className={th}>Date &amp; Time</th><th className={th}>Event</th><th className={th}>File</th><th className={th}>Source Place</th><th className={th}>Destination Place</th><th className={th}>User</th><th className={th}>Remarks</th></tr>
                    </thead>
                    <tbody>
                      {auditRows.map((entry) => (
                        <tr key={entry.id} data-testid={`row-audit-${entry.id}`} className="border-b border-slate-800/80 last:border-0 hover:bg-slate-900/40">
                          <td className={`${td} whitespace-nowrap text-slate-300`}>{formatDateTime(entry.occurred_at)}</td>
                          <td className={td}>
                            {entry.event_type === 'moved_to_transit'
                              ? <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300"><Truck className="h-3 w-3" />Moved to transit</span>
                              : <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300"><PackageCheck className="h-3 w-3" />Delivered from transit</span>}
                          </td>
                          <td className={td}><div className="font-semibold text-slate-200">{entry.wo}</div><div className="mono text-[10px] text-slate-500">No {entry.no ?? '—'}</div></td>
                          <td className={`${td} mono text-slate-300`}>{entry.source_place}</td>
                          <td className={`${td} mono text-slate-300`}>{entry.destination_place}</td>
                          <td className={`${td} font-medium text-slate-200`}>{entry.performed_by}</td>
                          <td className={`${td} max-w-[240px] text-slate-400`}>{entry.remarks ?? <span className="text-slate-600">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
