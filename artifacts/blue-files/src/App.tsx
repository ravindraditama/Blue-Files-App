import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetBlueFilesSummaryQueryKey,
  getListBlueFileAuditLogQueryKey,
  getListBlueFileLoansQueryKey,
  getListBlueFilesQueryKey,
  useBorrowBlueFile,
  useCompleteBlueFileTransit,
  useCreateBlueFile,
  useDeleteBlueFile,
  useGetBlueFilesSummary,
  useImportBlueFiles,
  useListBlueFileAuditLog,
  useListBlueFileLoans,
  useListBlueFiles,
  useMoveBlueFile,
  useReturnBlueFile,
  useStartBlueFileTransit,
  useUpdateBlueFile,
  type BlueFileBorrowInput,
  type BlueFileLoan,
  type BlueFileRecord,
  type BlueFileRecordInput,
  type BlueFileReturnInput,
  type BlueFileTransitCompleteInput,
  type BlueFileTransitInput,
} from '@workspace/api-client-react';
import * as XLSX from 'xlsx';
import {
  AlertCircle, AlertTriangle, ArrowDownToLine, CalendarDays, Check,
  CheckCircle2, ChevronDown, ChevronRight, Clock3, FileSpreadsheet, FileText,
  FolderTree, Hash, Layers3, MapPin, Move, Package, PackageCheck, Plus,
  Search, Trash2, TrendingUp, Truck, Undo2, UploadCloud, UserRound, X,
  History, LogOut,
} from 'lucide-react';
import {
  BorrowDialog, BorrowedPage, HistoryPage, ReturnDialog, STATUS_META, StatusBadge, StatusCards, formatDateTime, formatDuration, minutesSince,
} from '@/components/borrowing';
import { CompleteTransitDialog, TransitDialog, TransitPage } from '@/components/transit';
import { POSITIONS, TRANSIT_PLACE, parsePlace, type Place } from '@/lib/place';

type SearchType = 'wo' | 'place' | 'pic';
type ToastState = { message: string; type: 'success' | 'error' } | null;
// A record that sits in a rack slot (files in TRANSIT have no rack location).
type Shelved = BlueFileRecord & { area: string; rack: number; position: 'L' | 'M' | 'R'; slot: number };

function placeInput(input: {
  no: string | number | null;
  wo: string;
  complete: string | null;
  place: string;
  date_in: string | null;
  time_in: string | null;
  pic: string | null;
}): BlueFileRecordInput | null {
  const parsed = parsePlace(input.place);
  if (!parsed || !input.wo.trim()) return null;
  return {
    no: input.no === '' ? null : typeof input.no === 'number' ? input.no : Number(input.no) || null,
    wo: input.wo.trim().toUpperCase(),
    complete: input.complete?.trim() || null,
    place: parsed.place,
    area: parsed.area,
    rack: parsed.rack,
    position: parsed.position,
    slot: parsed.slot,
    date_in: input.date_in?.trim() || null,
    time_in: input.time_in?.trim() || null,
    pic: input.pic?.trim() || null,
  };
}

function App() {
  const queryClient = useQueryClient();
  const recordsQuery = useListBlueFiles();
  const summaryQuery = useGetBlueFilesSummary();
  const createMutation = useCreateBlueFile();
  const updateMutation = useUpdateBlueFile();
  const moveMutation = useMoveBlueFile();
  const deleteMutation = useDeleteBlueFile();
  const importMutation = useImportBlueFiles();
  const startTransitMutation = useStartBlueFileTransit();
  const completeTransitMutation = useCompleteBlueFileTransit();
  const borrowMutation = useBorrowBlueFile();
  const returnMutation = useReturnBlueFile();
  const loansQuery = useListBlueFileLoans();
  const loans = loansQuery.data ?? [];
  const auditQuery = useListBlueFileAuditLog();
  const audit = auditQuery.data ?? [];
  const records = recordsQuery.data ?? [];
  const summary = summaryQuery.data;

  const [searchType, setSearchType] = useState<SearchType>('wo');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArea, setSelectedArea] = useState('');
  const [openRack, setOpenRack] = useState<number | null>(null);
  const [highlightPlace, setHighlightPlace] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<BlueFileRecord | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [addPlace, setAddPlace] = useState('');
  const [toast, setToast] = useState<ToastState>(null);
  const [view, setView] = useState<'map' | 'borrowed' | 'transit' | 'history'>('map');
  const [actionDialog, setActionDialog] = useState<{ type: 'borrow' | 'return' | 'transit' | 'complete'; record: BlueFileRecord } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3600);
  };
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListBlueFilesQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetBlueFilesSummaryQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListBlueFileLoansQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListBlueFileAuditLogQueryKey() }),
    ]);
  };

  const shelved = useMemo(
    () => records.filter((row): row is Shelved => row.area !== null && row.rack !== null && row.position !== null && row.slot !== null),
    [records],
  );
  const areaInfo = useMemo(
    () => [...(summary?.areas ?? [])].sort((a, b) => a.area.localeCompare(b.area)),
    [summary?.areas],
  );
  const areas = useMemo(() => {
    const known = areaInfo.map((area) => area.area);
    for (const row of shelved) if (!known.includes(row.area)) known.push(row.area);
    return known.sort((a, b) => a.localeCompare(b));
  }, [areaInfo, shelved]);

  // Keep the selected area valid (initial load, or after its last record is deleted).
  useEffect(() => {
    if (areas.length && !areas.includes(selectedArea)) setSelectedArea(areas[0]);
  }, [areas, selectedArea]);

  const activeAreaSummary = areaInfo.find((a) => a.area === selectedArea);
  const areaRows = shelved.filter((row) => row.area === selectedArea);
  const maxRack = activeAreaSummary?.max_rack ?? Math.max(0, ...areaRows.map((row) => row.rack));
  const maxSlot = activeAreaSummary?.max_slot ?? Math.max(0, ...areaRows.map((row) => row.slot));
  const rackNumbers = Array.from({ length: maxRack }, (_, i) => i + 1);
  const rackRecords = useMemo(() => {
    const map = new Map<string, BlueFileRecord>();
    for (const row of areaRows) map.set(`${row.rack}-${row.position}-${row.slot}`, row);
    return map;
  }, [areaRows]);

  const openAdd = (place = '') => {
    setAddPlace(place);
    setShowAdd(true);
  };

  // Opens a file. Files in TRANSIT have no rack slot, so there is nothing to show on the map.
  const focusRecord = (match: BlueFileRecord) => {
    if (match.area !== null && match.rack !== null) {
      setSelectedArea(match.area);
      setOpenRack(match.rack);
      setHighlightPlace(match.place);
    }
    setSelectedRecord(match);
  };

  const handleSearch = () => {
    const query = searchQuery.trim();
    if (!query) {
      setHighlightPlace('');
      return;
    }
    if (searchType === 'wo') {
      const matches = records.filter((row) => row.wo.toUpperCase().includes(query.toUpperCase()));
      if (!matches.length) return showToast(`No records found for WO "${query}"`, 'error');
      const match = matches[0];
      focusRecord(match);
      showToast(matches.length > 1 ? `Found ${matches.length} work orders matching "${query}"` : `Found ${match.wo} at ${match.place}`);
    } else if (searchType === 'place') {
      if (query.toUpperCase() === TRANSIT_PLACE) {
        setView('transit');
        return;
      }
      const place = parsePlace(query);
      if (!place) return showToast('Invalid place format. Use a code such as A16R-001.', 'error');
      const match = records.find((row) => row.place.toUpperCase() === place.place);
      setSelectedArea(place.area);
      setOpenRack(place.rack);
      setHighlightPlace(place.place);
      if (!match) {
        const incoming = records.find((row) => row.status === 'in_transit' && row.destination_place === place.place);
        return showToast(incoming ? `${place.place} is empty (${incoming.wo} is in transit to it)` : `${place.place} is empty`, 'error');
      }
      setSelectedRecord(match);
      showToast(`Found ${match.wo} at ${place.place}`);
    } else {
      const matches = records.filter((row) => (row.pic ?? '').toUpperCase().includes(query.toUpperCase()));
      if (!matches.length) return showToast(`No records found for PIC "${query}"`, 'error');
      focusRecord(matches[0]);
      showToast(`Found ${matches.length} record${matches.length === 1 ? '' : 's'} for PIC "${query}"`);
    }
  };

  const saveRecord = async (input: BlueFileRecordInput, id?: string) => {
    try {
      if (id) await updateMutation.mutateAsync({ id, data: input });
      else await createMutation.mutateAsync({ data: input });
      await refresh();
      showToast(id ? 'Record updated successfully' : 'File added successfully');
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save this record.', 'error');
      return false;
    }
  };

  const doDelete = async (id: string) => {
    try {
      await deleteMutation.mutateAsync({ id });
      await refresh();
      setSelectedRecord(null);
      showToast('Record removed — slot is now empty');
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to remove this record.', 'error');
      return false;
    }
  };

  const doMove = async (record: BlueFileRecord, place: Place) => {
    try {
      await moveMutation.mutateAsync({ id: record.id, data: { place: place.place } });
      await refresh();
      setSelectedRecord(null);
      setSelectedArea(place.area);
      setOpenRack(place.rack);
      setHighlightPlace(place.place);
      showToast(`File moved to ${place.place}`);
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to move this record.', 'error');
      return false;
    }
  };

  const doStartTransit = async (record: BlueFileRecord, data: BlueFileTransitInput) => {
    try {
      await startTransitMutation.mutateAsync({ id: record.id, data });
      await refresh();
      setActionDialog(null);
      showToast(`${record.wo} moved to ${TRANSIT_PLACE}`);
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to move this file to Transit.', 'error');
      return false;
    }
  };

  const doCompleteTransit = async (record: BlueFileRecord, data: BlueFileTransitCompleteInput) => {
    try {
      const updated = await completeTransitMutation.mutateAsync({ id: record.id, data });
      await refresh();
      setActionDialog(null);
      showToast(`${record.wo} delivered to ${updated.place}`);
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to complete this transit.', 'error');
      return false;
    }
  };

  const doBorrow = async (record: BlueFileRecord, data: BlueFileBorrowInput) => {
    try {
      await borrowMutation.mutateAsync({ id: record.id, data });
      await refresh();
      setActionDialog(null);
      showToast(`${record.wo} borrowed by ${data.borrower_name}`);
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to record this loan.', 'error');
      return false;
    }
  };

  const doReturn = async (record: BlueFileRecord, data: BlueFileReturnInput) => {
    try {
      await returnMutation.mutateAsync({ id: record.id, data });
      await refresh();
      setActionDialog(null);
      showToast(`${record.wo} returned ${data.return_to === 'in_transit' ? `to ${TRANSIT_PLACE}` : `to rack ${record.place}`}`);
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to return this file.', 'error');
      return false;
    }
  };

  const borrowedCount = records.filter((row) => row.status === 'borrowed').length;
  const transitCount = records.filter((row) => row.status === 'in_transit').length;
  const isLoading = recordsQuery.isLoading || summaryQuery.isLoading;
  const queryError = recordsQuery.error || summaryQuery.error;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-[#0d1420]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500 shadow-lg shadow-sky-950/60">
              <FolderTree className="h-[19px] w-[19px] text-slate-950" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[16px] font-bold tracking-[-.025em] text-slate-100 sm:text-[18px]">Blue File Management</h1>
              <p className="hidden text-[11px] tracking-[.055em] text-slate-500 sm:block">STORAGE MONITORING &amp; TRACKING SYSTEM</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button data-testid="button-import" onClick={() => setShowImport(true)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-800/80 px-3 text-sm font-semibold text-slate-300 transition hover:bg-slate-700">
              <UploadCloud className="h-4 w-4" /><span className="hidden sm:inline">Import Excel</span><span className="sm:hidden">Import</span>
            </button>
            <button data-testid="button-add-file" onClick={() => openAdd()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-sky-500 px-3.5 text-sm font-bold text-slate-950 transition hover:bg-sky-400 sm:px-4">
              <Plus className="h-4 w-4" /><span className="hidden sm:inline">Add File</span><span className="sm:hidden">Add</span>
            </button>
          </div>
        </div>
      </header>

      <nav aria-label="Sections" className="border-b border-slate-800/75 bg-[#0d1420]">
        <div className="mx-auto flex max-w-[1440px] gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8">
          {([
            ['map', 'Storage Map', Layers3],
            ['borrowed', 'Borrowed Blue Files', Package],
            ['transit', 'Transit Monitoring', Truck],
            ['history', 'Borrowing History', History],
          ] as const).map(([key, label, Icon]) => (
            <button key={key} data-testid={`nav-${key}`} onClick={() => setView(key)} aria-current={view === key ? 'page' : undefined} className={`inline-flex h-11 shrink-0 items-center gap-2 border-b-2 px-3.5 text-[13px] font-semibold transition ${view === key ? 'border-sky-400 text-sky-300' : 'border-transparent text-slate-500 hover:text-slate-200'}`}>
              <Icon className="h-4 w-4" />{label}
              {key === 'transit' && transitCount > 0 && <span data-testid="badge-transit-count" className="mono rounded-full bg-amber-500/20 px-1.5 py-px text-[10px] font-medium text-amber-300">{transitCount}</span>}
              {key === 'borrowed' && borrowedCount > 0 && <span data-testid="badge-borrowed-count" className="mono rounded-full bg-violet-500/20 px-1.5 py-px text-[10px] font-medium text-violet-300">{borrowedCount}</span>}
            </button>
          ))}
        </div>
      </nav>

      {view === 'map' && <section className="sticky top-[72px] z-20 border-b border-slate-800/75 bg-[#101927]/95 shadow-[0_10px_22px_rgba(0,0,0,.13)] backdrop-blur-xl">
        <form className="mx-auto flex max-w-[1440px] flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:px-6 lg:px-8" onSubmit={(event) => { event.preventDefault(); handleSearch(); }}>
          <div className="flex h-10 shrink-0 items-center rounded-lg border border-slate-700/80 bg-[#0c1420] p-1">
            {([
              ['wo', 'WO', FileText], ['place', 'Place', MapPin], ['pic', 'PIC', UserRound],
            ] as const).map(([type, label, Icon]) => (
              <button key={type} data-testid={`button-search-type-${type}`} type="button" onClick={() => setSearchType(type)} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] font-semibold transition ${searchType === type ? 'bg-sky-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-100'}`}>
                <Icon className="h-3.5 w-3.5" />{label}
              </button>
            ))}
          </div>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input data-testid="input-search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={searchType === 'wo' ? 'Search work order…' : searchType === 'place' ? 'Search storage place…' : 'Search person in charge…'} className="h-10 w-full rounded-lg border border-slate-700/80 bg-[#0c1420] pl-10 pr-10 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-500/70 focus:ring-2 focus:ring-sky-500/15" />
            {searchQuery && <button data-testid="button-clear-search" type="button" aria-label="Clear search" onClick={() => { setSearchQuery(''); setHighlightPlace(''); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200"><X className="h-4 w-4" /></button>}
          </div>
          <button data-testid="button-search" type="submit" className="h-10 shrink-0 rounded-lg bg-sky-500 px-6 text-sm font-bold text-slate-950 transition hover:bg-sky-400">Search</button>
        </form>
      </section>}

      <main className="mx-auto max-w-[1440px] px-4 pb-14 pt-6 sm:px-6 lg:px-8">
        {queryError && <div data-testid="status-query-error" className="mb-5 flex items-center justify-between gap-4 rounded-xl border border-red-500/30 bg-red-500/[.08] px-4 py-3 text-sm text-red-200"><span className="flex items-center gap-2"><AlertCircle className="h-4 w-4 shrink-0" />Inventory data could not be loaded. Check your connection and retry.</span><button data-testid="button-retry" onClick={() => { void recordsQuery.refetch(); void summaryQuery.refetch(); }} className="rounded-md bg-red-500/10 px-3 py-1.5 font-semibold hover:bg-red-500/20">Retry</button></div>}

        {view === 'borrowed' && <BorrowedPage records={records} summary={summary} loading={isLoading} onOpen={setSelectedRecord} onReturn={(record) => setActionDialog({ type: 'return', record })} />}
        {view === 'transit' && <TransitPage records={records} loading={recordsQuery.isLoading} audit={audit} auditLoading={auditQuery.isLoading} auditError={Boolean(auditQuery.error)} onRetryAudit={() => void auditQuery.refetch()} onOpen={setSelectedRecord} onComplete={(record) => setActionDialog({ type: 'complete', record })} />}
        {view === 'history' && <HistoryPage loans={loans} loading={loansQuery.isLoading} error={Boolean(loansQuery.error)} onRetry={() => void loansQuery.refetch()} />}

        {view === 'map' && (<>
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-[10px] font-bold tracking-[.18em] text-sky-400">INVENTORY OVERVIEW</p>
            <h2 className="text-[22px] font-bold tracking-[-.035em] text-slate-100 sm:text-[26px]">Storage at a glance</h2>
          </div>
          {!isLoading && !queryError && <div data-testid="text-record-count" className="hidden items-center gap-2 rounded-full border border-slate-800 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-400 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{records.length.toLocaleString()} active records</div>}
        </div>
        <StatusCards summary={summary} loading={isLoading} />
        <div className="mt-3" />
        <Stats summary={summary} loading={isLoading} recordCount={records.length} />

        {isLoading ? <LoadingMap /> : queryError ? null : records.length === 0 ? (
          <div className="mt-7 rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 px-6 py-14 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-700 bg-slate-800/70"><FileSpreadsheet className="h-6 w-6 text-slate-400" /></div>
            <h3 className="mt-4 text-lg font-bold text-slate-200">No blue file records yet</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Add a file manually or import your existing spreadsheet to start mapping storage locations.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button data-testid="button-empty-import" onClick={() => setShowImport(true)} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-700"><FileSpreadsheet className="h-4 w-4" />Import Excel</button>
              <button data-testid="button-empty-add" onClick={() => openAdd()} className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-sky-400"><Plus className="h-4 w-4" />Add File Manually</button>
            </div>
          </div>
        ) : (
          <section className="mt-7 rounded-2xl border border-slate-800 bg-[#111a28] p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.16em] text-slate-500"><Layers3 className="h-3.5 w-3.5 text-sky-400" />Rack map <span className="text-slate-700">/</span> Select an area</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {areas.map((area) => {
                    const info = areaInfo.find((entry) => entry.area === area);
                    const occupied = info?.occupied ?? records.filter((row) => row.area === area).length;
                    return <button key={area} data-testid={`button-area-${area}`} onClick={() => { setSelectedArea(area); setOpenRack(null); setHighlightPlace(''); }} className={`relative flex min-w-[58px] items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-bold transition ${selectedArea === area ? 'border-sky-400/70 bg-sky-500 text-slate-950 shadow-[0_5px_14px_rgba(14,165,233,.18)]' : 'border-slate-700 bg-slate-800/70 text-slate-300 hover:border-slate-600 hover:bg-slate-800'}`}><span>{area}</span><span className={`mono text-[10px] ${selectedArea === area ? 'text-slate-900/70' : 'text-slate-500'}`}>{occupied}</span></button>;
                  })}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-500">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-red-500" />In rack</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-violet-500" />Borrowed</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-emerald-500/20 ring-1 ring-inset ring-emerald-500/40" />Available</span>
                <span className="hidden text-slate-700 sm:block">|</span>
                <span className="flex items-center gap-1.5"><MapPin className="h-3 w-3 text-sky-400" />Click a slot to view</span>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-800/80 pt-4">
              <span className="text-lg font-bold text-slate-100">Area {selectedArea}</span>
              <span className="rounded-md bg-slate-800 px-2 py-1 text-[11px] text-slate-400">{maxRack} racks</span>
              <span className="rounded-md bg-slate-800 px-2 py-1 text-[11px] text-slate-400">max {maxSlot} slots</span>
              <span className="rounded-md bg-slate-800 px-2 py-1 text-[11px] text-slate-400">3 positions · L / M / R</span>
            </div>

            <div className="mt-3 rounded-xl border border-slate-800/90 bg-[#0d1521] p-3 sm:p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">Rack number <span className="font-normal normal-case tracking-normal text-slate-600">· choose to expand</span></div>
                {openRack !== null && <button data-testid="button-collapse-rack" onClick={() => setOpenRack(null)} className="text-[11px] font-semibold text-sky-400 hover:text-sky-300">Collapse rack</button>}
              </div>
              <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 xl:grid-cols-16">
                {rackNumbers.map((rack) => {
                  const count = areaRows.filter((row) => row.rack === rack).length;
                  return <button key={rack} data-testid={`button-rack-${selectedArea}-${rack}`} onClick={() => setOpenRack(openRack === rack ? null : rack)} className={`flex min-h-[54px] flex-col items-center justify-center rounded-lg border transition ${openRack === rack ? 'border-sky-400/60 bg-sky-500 text-slate-950 shadow-sm' : 'border-slate-800 bg-slate-800/60 text-slate-300 hover:border-slate-600 hover:bg-slate-800'}`}><span className="mono text-[13px] font-medium">{String(rack).padStart(2, '0')}</span><span className={`mt-0.5 text-[9px] ${openRack === rack ? 'text-slate-900/70' : count ? 'text-slate-500' : 'text-slate-700'}`}>{count} file{count === 1 ? '' : 's'}</span></button>;
                })}
              </div>
              {openRack !== null && (
                <div className="rise-in mt-4 border-t border-slate-800 pt-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="rounded-md border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-xs font-semibold text-sky-300">{selectedArea}{String(openRack).padStart(2, '0')}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
                    <span className="text-[11px] text-slate-500">L / M / R</span>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-700" />
                    <span className="text-[11px] text-slate-500">{maxSlot} slots each</span>
                    <div className="h-px flex-1 bg-slate-800" />
                  </div>
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                    {POSITIONS.map((position) => {
                      const occupied = Array.from({ length: maxSlot }, (_, i) => rackRecords.get(`${openRack}-${position}-${i + 1}`)).filter(Boolean).length;
                      return <div key={position} className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/55 p-3">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-800 text-xs font-bold text-sky-300">{position}</span><span className="text-xs font-semibold text-slate-300">Position {position}</span></div>
                          <div className="mono flex items-center gap-2.5 text-[10px]"><span className="text-red-400">{occupied} used</span><span className="text-emerald-500/80">{Math.max(0, maxSlot - occupied)} free</span></div>
                        </div>
                        <div className="grid grid-cols-5 gap-1.5 min-[520px]:grid-cols-8 lg:grid-cols-5 xl:grid-cols-8">
                          {Array.from({ length: maxSlot }, (_, i) => {
                            const slot = i + 1;
                            const record = rackRecords.get(`${openRack}-${position}-${slot}`);
                            const slotPlace = record?.place ?? `${selectedArea}${String(openRack).padStart(2, '0')}${position}-${String(slot).padStart(3, '0')}`;
                            return <button key={slot} data-testid={`button-slot-${selectedArea}-${openRack}-${position}-${slot}`} title={record ? `${record.wo} · ${slotPlace} · ${STATUS_META[record.status].label}` : `Available · ${slotPlace}`} onClick={() => record ? setSelectedRecord(record) : openAdd(slotPlace)} className={`mono flex aspect-square min-w-0 items-center justify-center rounded-md text-[9px] font-medium transition hover:-translate-y-px ${record ? (record.status === 'in_transit' ? 'bg-amber-500 text-slate-950 shadow-sm hover:bg-amber-400' : record.status === 'borrowed' ? 'bg-violet-500 text-white shadow-sm hover:bg-violet-400' : 'bg-red-500 text-white shadow-sm shadow-red-950/40 hover:bg-red-400') : 'bg-emerald-500/[.09] text-emerald-500/70 ring-1 ring-inset ring-emerald-500/20 hover:bg-emerald-500/20 hover:text-emerald-300'} ${highlightPlace === slotPlace ? 'z-10 outline outline-2 outline-sky-400 outline-offset-2' : ''}`}><span>{String(slot).padStart(3, '0')}</span></button>;
                          })}
                        </div>
                      </div>;
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
        </>)}
        <footer className="mt-7 flex flex-col gap-2 border-t border-slate-800/80 py-4 text-[10px] text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <span>Blue File Management <span className="px-1 text-slate-700">/</span> Inventory monitoring</span>
          <span>Area → Rack → L / M / R → Slot</span>
        </footer>
      </main>

      {showAdd && <RecordModal key="new-record" mode="add" defaultPlace={addPlace} records={records} onClose={() => setShowAdd(false)} onSave={async (input) => { const ok = await saveRecord(input); if (ok) setShowAdd(false); return ok; }} />}
      {selectedRecord && <RecordModal key={selectedRecord.id} mode="detail" record={selectedRecord} records={records} onClose={() => setSelectedRecord(null)} onSave={async (input) => { const ok = await saveRecord(input, selectedRecord.id); if (ok) setSelectedRecord(null); return ok; }} onDelete={() => doDelete(selectedRecord.id)} onMove={(place) => doMove(selectedRecord, place)} loans={loans} onTransit={() => { const record = selectedRecord; setSelectedRecord(null); setActionDialog({ type: 'transit', record }); }} onCompleteTransit={() => { const record = selectedRecord; setSelectedRecord(null); setActionDialog({ type: 'complete', record }); }} onBorrow={() => { const record = selectedRecord; setSelectedRecord(null); setActionDialog({ type: 'borrow', record }); }} onReturn={() => { const record = selectedRecord; setSelectedRecord(null); setActionDialog({ type: 'return', record }); }} />}
      {showImport && <ImportDialog records={records} pending={importMutation.isPending} onClose={() => setShowImport(false)} onImport={async (importRows) => {
        try {
          const result = await importMutation.mutateAsync({ data: { records: importRows } });
          await refresh();
          return result;
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : 'Import failed.');
        }
      }} />}
      {actionDialog?.type === 'borrow' && <BorrowDialog key={actionDialog.record.id} record={actionDialog.record} onClose={() => setActionDialog(null)} onSubmit={(data) => doBorrow(actionDialog.record, data)} />}
      {actionDialog?.type === 'return' && <ReturnDialog key={actionDialog.record.id} record={actionDialog.record} records={records} onClose={() => setActionDialog(null)} onSubmit={(data) => doReturn(actionDialog.record, data)} />}
      {actionDialog?.type === 'transit' && <TransitDialog key={actionDialog.record.id} record={actionDialog.record} records={records} onClose={() => setActionDialog(null)} onSubmit={(data) => doStartTransit(actionDialog.record, data)} />}
      {actionDialog?.type === 'complete' && <CompleteTransitDialog key={actionDialog.record.id} record={actionDialog.record} records={records} onClose={() => setActionDialog(null)} onSubmit={(data) => doCompleteTransit(actionDialog.record, data)} />}
      {toast && <div role="status" data-testid="status-toast" className={`fixed bottom-5 left-1/2 z-[70] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl border px-4 py-3 shadow-2xl ${toast.type === 'success' ? 'border-emerald-500/30 bg-[#14251f] text-emerald-100' : 'border-red-500/30 bg-[#29191c] text-red-100'}`}><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${toast.type === 'success' ? 'bg-emerald-500/15' : 'bg-red-500/15'}`}>{toast.type === 'success' ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <AlertCircle className="h-4 w-4 text-red-400" />}</span><span className="text-sm font-medium">{toast.message}</span><button data-testid="button-dismiss-toast" aria-label="Dismiss notification" onClick={() => setToast(null)} className="ml-1 text-current/50 hover:text-current"><X className="h-4 w-4" /></button></div>}
    </div>
  );
}

function Stats({ summary, loading, recordCount }: { summary?: { total_capacity: number; occupied: number; empty: number; utilization: number }; loading: boolean; recordCount: number }) {
  const stats = [
    { label: 'Total Capacity', value: summary?.total_capacity ?? 0, icon: Layers3, color: 'sky', accent: 'text-sky-300', iconBg: 'bg-sky-500/10', border: 'border-sky-500/20', hint: 'All rack positions' },
    { label: 'Occupied Places', value: summary?.occupied ?? recordCount, icon: Package, color: 'red', accent: 'text-red-300', iconBg: 'bg-red-500/10', border: 'border-red-500/20', hint: 'Files in storage' },
    { label: 'Empty Places', value: summary?.empty ?? Math.max(0, (summary?.total_capacity ?? 0) - recordCount), icon: PackageCheck, color: 'green', accent: 'text-emerald-300', iconBg: 'bg-emerald-500/10', border: 'border-emerald-500/20', hint: 'Slots available' },
  ];
  const utilization = summary?.utilization ?? 0;
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    {stats.map((item) => {
      const Icon = item.icon;
      return <div key={item.label} data-testid={`card-stat-${item.color}`} className={`flex min-h-[88px] items-center gap-3 rounded-xl border ${item.border} bg-[#111a28] px-3.5 py-3.5 sm:px-4`}>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${item.iconBg} ${item.accent}`}><Icon className="h-[18px] w-[18px]" /></span>
        <span className="min-w-0"><span className="block truncate text-[11px] font-medium text-slate-500">{item.label}</span><span data-testid={`text-stat-${item.color}`} className={`mt-0.5 block text-[20px] font-bold tracking-[-.03em] ${item.accent}`}>{loading ? <span className="inline-block h-6 w-16 animate-pulse rounded bg-slate-800" /> : item.value.toLocaleString()}</span><span className="block text-[9px] text-slate-600">{item.hint}</span></span>
      </div>;
    })}
    <div data-testid="card-stat-utilization" className="col-span-2 flex min-h-[88px] flex-col justify-center rounded-xl border border-slate-800 bg-[#111a28] px-4 py-3.5 lg:col-span-1">
      <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-[11px] font-medium text-slate-500"><TrendingUp className="h-3.5 w-3.5 text-sky-400" />Utilization Rate</div><span data-testid="text-stat-utilization" className="mono text-[17px] font-medium text-slate-200">{loading ? '—' : `${Number(utilization).toFixed(1)}%`}</span></div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-sky-400 transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(0, utilization))}%` }} /></div>
      <div className="mt-1.5 text-[9px] text-slate-600">Current capacity in use</div>
    </div>
  </div>;
}

function LoadingMap() {
  return <section aria-label="Loading rack map" className="mt-7 rounded-2xl border border-slate-800 bg-[#111a28] p-5">
    <div className="h-3 w-32 animate-pulse rounded bg-slate-800" /><div className="mt-4 flex gap-2">{[1, 2, 3, 4].map((n) => <div key={n} className="h-10 w-14 animate-pulse rounded-lg bg-slate-800/80" />)}</div>
    <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">{Array.from({ length: 16 }, (_, n) => <div key={n} className="h-12 animate-pulse rounded-lg bg-slate-800/60" />)}</div>
    <div className="mt-6 grid gap-3 lg:grid-cols-3">{[1, 2, 3].map((n) => <div key={n} className="h-36 animate-pulse rounded-xl bg-slate-800/50" />)}</div>
  </section>;
}

function RecordModal({ mode, record, records, defaultPlace = '', loans = [], onClose, onSave, onDelete, onMove, onTransit, onCompleteTransit, onBorrow, onReturn }: {
  mode: 'add' | 'detail';
  record?: BlueFileRecord;
  records: BlueFileRecord[];
  defaultPlace?: string;
  onClose: () => void;
  onSave: (input: BlueFileRecordInput) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
  onMove?: (place: Place) => Promise<boolean>;
  loans?: BlueFileLoan[];
  onTransit?: () => void;
  onCompleteTransit?: () => void;
  onBorrow?: () => void;
  onReturn?: () => void;
}) {
  const [view, setView] = useState<'view' | 'edit' | 'move' | 'delete'>(mode === 'add' ? 'edit' : 'view');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    no: record?.no?.toString() ?? '',
    wo: record?.wo ?? '',
    complete: record?.complete ?? '',
    place: record?.place ?? defaultPlace,
    date_in: record?.date_in ?? '',
    time_in: record?.time_in ?? '',
    pic: record?.pic ?? '',
  });
  const parsed = parsePlace(form.place);
  const normalizedPlace = parsed?.place ?? '';
  const otherRecords = records.filter((row) => row.id !== record?.id);
  const duplicateWo = otherRecords.some((row) => row.wo.toUpperCase() === form.wo.trim().toUpperCase());
  const duplicatePlace = otherRecords.some((row) => row.place.toUpperCase() === normalizedPlace.toUpperCase());
  const canSave = Boolean(form.wo.trim() && parsed && !duplicateWo && !duplicatePlace);

  const recordLoans = record ? loans.filter((loan) => loan.record_id === record.id).slice(0, 3) : [];

  const submitSave = async () => {
    if (!canSave) return;
    const input = placeInput({ ...form, no: form.no });
    if (!input) return;
    setSaving(true);
    const ok = await onSave(input);
    setSaving(false);
    if (ok) setView('view');
  };

  const field = (label: string, key: keyof typeof form, props: { required?: boolean; mono?: boolean; type?: string; placeholder?: string } = {}) => (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[11px] font-semibold text-slate-400">{label}{props.required && <span className="ml-1 text-red-400">*</span>}</span>
      <input data-testid={`input-record-${key}`} type={props.type ?? 'text'} value={form[key]} placeholder={props.placeholder} onChange={(event) => setForm({ ...form, [key]: key === 'wo' || key === 'place' ? event.target.value.toUpperCase() : event.target.value })} className={`h-10 w-full rounded-lg border border-slate-700 bg-[#0d1521] px-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-500/70 focus:ring-2 focus:ring-sky-500/10 ${props.mono ? 'mono' : ''}`} />
    </label>
  );

  const headerTitle = mode === 'add' ? 'Add Blue File' : record?.wo ?? 'Blue File Record';
  return <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="modal-title" data-testid="dialog-record" className="modal-panel my-auto w-full max-w-[540px] overflow-hidden rounded-2xl border border-slate-700 bg-[#131d2b] shadow-2xl">
      <header className="flex items-start justify-between border-b border-slate-800 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${mode === 'add' ? 'bg-sky-500/10 text-sky-300' : 'bg-red-500/10 text-red-300'}`}><FileText className="h-5 w-5" /></span>
          <div><h2 id="modal-title" className="font-bold text-slate-100">{headerTitle}</h2><p className="mt-0.5 text-[11px] text-slate-500">{mode === 'add' ? 'Manually create a new record' : `${view === 'view' ? 'Blue file record' : view === 'edit' ? 'Edit record details' : view === 'move' ? 'Move to a new location' : 'Confirm record removal'}`}</p></div>
        </div>
        <button data-testid="button-close-record" aria-label="Close dialog" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"><X className="h-5 w-5" /></button>
      </header>

      <div className="max-h-[min(68vh,650px)] overflow-y-auto px-5 py-5 sm:px-6">
        {(view === 'edit') && <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">{field('No', 'no', { type: 'number', placeholder: 'Optional' })}{field('WO', 'wo', { required: true, placeholder: 'e.g. WO-2024-001' })}</div>
          {duplicateWo && <p className="-mt-3 text-[11px] text-red-400">This work order already exists.</p>}
          {field('Place', 'place', { required: true, mono: true, placeholder: 'e.g. A16R-001' })}
          {form.place && !parsed && <p className="-mt-3 text-[11px] text-red-400">Invalid format. Use a place code such as A16R-001.</p>}
          {duplicatePlace && <p className="-mt-3 text-[11px] text-red-400">This place is already assigned.</p>}
          {parsed && <div className="-mt-2 flex flex-wrap gap-1.5 text-[10px] text-slate-500"><span className="rounded bg-slate-800 px-2 py-1">Area {parsed.area}</span><span className="rounded bg-slate-800 px-2 py-1">Rack {parsed.rack}</span><span className="rounded bg-slate-800 px-2 py-1">Position {parsed.position}</span><span className="rounded bg-slate-800 px-2 py-1">Slot {parsed.slot}</span></div>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{field('Complete', 'complete', { placeholder: 'Optional' })}{field('Date In', 'date_in', { placeholder: 'Optional' })}{field('Time In', 'time_in', { placeholder: 'Optional' })}</div>
          {field('PIC', 'pic', { placeholder: 'Person in charge' })}
        </div>}
        {view === 'view' && record && <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-sky-500/15 bg-sky-500/[.06] p-3.5"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300"><MapPin className="h-4 w-4" /></span><div className="min-w-0 flex-1"><div className="text-[10px] font-semibold uppercase tracking-[.12em] text-slate-500">Current location</div><div data-testid="text-record-current-location" className="mt-0.5 truncate text-[14px] font-medium text-sky-300">{record.current_location}</div><div className="mt-0.5 text-[11px] text-slate-500">{record.status === 'in_transit' ? 'System place' : 'Rack slot'} <span data-testid="text-record-place" className="mono text-slate-400">{record.place}</span></div></div><StatusBadge status={record.status} /></div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-4">
            <DetailItem icon={Hash} label="No" value={record.no ?? '—'} testId="text-record-number" />
            <DetailItem icon={FileText} label="Complete" value={record.complete || '—'} testId="text-record-complete" />
            <DetailItem icon={CalendarDays} label="Date In" value={record.date_in || '—'} testId="text-record-date" />
            <DetailItem icon={Clock3} label="Time In" value={record.time_in || '—'} testId="text-record-time" />
            <DetailItem icon={UserRound} label="PIC" value={record.pic || '—'} testId="text-record-pic" />
          </div>
          {mode === 'detail' && onTransit && <div className="space-y-3 border-t border-slate-800 pt-4">
            {record.status === 'borrowed' && <div data-testid="panel-borrowed" className="rounded-xl border border-violet-500/20 bg-violet-500/[.06] p-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-[10px] uppercase tracking-[.12em] text-slate-500">Borrower</div><div data-testid="text-record-borrower" className="mt-0.5 font-semibold text-slate-100">{record.borrower_name}</div></div>
                <div><div className="text-[10px] uppercase tracking-[.12em] text-slate-500">Borrowed on</div><div className="mt-0.5 font-semibold text-slate-100">{formatDateTime(record.borrowed_at)}</div></div>
              </div>
              {record.borrow_remarks && <p className="mt-2.5 text-slate-400"><span className="text-slate-500">Remarks: </span>{record.borrow_remarks}</p>}
            </div>}
            {record.status === 'in_transit' && <div data-testid="panel-transit" className="rounded-xl border border-amber-500/20 bg-amber-500/[.06] p-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-[10px] uppercase tracking-[.12em] text-slate-500">Previous place</div><div data-testid="text-record-previous-place" className="mono mt-0.5 font-semibold text-slate-100">{record.previous_place ?? '—'}</div></div>
                <div><div className="text-[10px] uppercase tracking-[.12em] text-slate-500">Destination place</div><div data-testid="text-record-destination" className="mono mt-0.5 font-semibold text-slate-100">{record.destination_place ?? '—'}</div></div>
                <div><div className="text-[10px] uppercase tracking-[.12em] text-slate-500">Transit date</div><div className="mt-0.5 font-semibold text-slate-100">{formatDateTime(record.transit_at)}</div></div>
                <div><div className="text-[10px] uppercase tracking-[.12em] text-slate-500">Transit by</div><div className="mt-0.5 font-semibold text-slate-100">{record.transit_by ?? '—'}</div></div>
              </div>
              <p className="mt-2.5 text-slate-400">In transit for <span className="font-semibold text-amber-300">{formatDuration(minutesSince(record.transit_at))}</span></p>
            </div>}
            {record.status === 'available' && record.received_at && <p className="text-[11px] text-slate-500">Last delivered from {TRANSIT_PLACE} on {formatDateTime(record.received_at)} by {record.received_by ?? '—'}.</p>}
            <div className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-500">Move file</div>
            <div className="flex flex-wrap gap-2">
              {record.status === 'borrowed' && <button data-testid="button-return-record" onClick={onReturn} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 text-xs font-bold text-slate-950 hover:bg-sky-400"><Undo2 className="h-3.5 w-3.5" />Return file</button>}
              {record.status === 'available' && <>
                <button data-testid="button-to-transit" onClick={onTransit} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/20"><Truck className="h-3.5 w-3.5" />Move to TRANSIT</button>
                <button data-testid="button-borrow-record" onClick={onBorrow} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3.5 text-xs font-semibold text-violet-200 hover:bg-violet-500/20"><LogOut className="h-3.5 w-3.5" />Borrow</button>
              </>}
              {record.status === 'in_transit' && <button data-testid="button-complete-transit" onClick={onCompleteTransit} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"><PackageCheck className="h-3.5 w-3.5" />Complete Transit</button>}
            </div>
            {recordLoans.length > 0 && <div data-testid="list-record-history" className="rounded-xl border border-slate-800 bg-[#0d1521] p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-slate-500"><History className="h-3 w-3" />Recent borrowing history</div>
              <ul className="space-y-1.5">{recordLoans.map((loan) => <li key={loan.id} className="flex flex-wrap items-center justify-between gap-x-3 text-[11px]"><span className="font-medium text-slate-300">{loan.borrower_name}</span><span className="text-slate-500">{formatDateTime(loan.borrowed_at)} → {loan.returned_at ? formatDateTime(loan.returned_at) : 'not returned'} · {formatDuration(loan.duration_minutes)}</span></li>)}</ul>
            </div>}
          </div>}
        </div>}
        {view === 'move' && record && <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-[#0d1521] p-3"><p className="text-[10px] font-semibold uppercase tracking-[.12em] text-slate-500">Current location</p><p className="mono mt-1 text-sm text-sky-300">{record.place}</p></div>
          <label className="block"><span className="mb-1.5 block text-[11px] font-semibold text-slate-400">New location <span className="text-slate-600">(e.g. B05L-003)</span></span><input data-testid="input-move-place" autoFocus value={form.place} onChange={(event) => setForm({ ...form, place: event.target.value.toUpperCase().replace(/\s+/g, '') })} placeholder="Enter a new place code" className="mono h-10 w-full rounded-lg border border-slate-700 bg-[#0d1521] px-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-500/70 focus:ring-2 focus:ring-sky-500/10" /></label>
          {form.place && !parsed && <p className="-mt-3 text-[11px] text-red-400">Invalid format. Use a code like A16R-001.</p>}
          {parsed && duplicatePlace && <p className="-mt-3 text-[11px] text-red-400">This location is already occupied.</p>}
          {parsed && parsed.place === record.place && <p className="-mt-3 text-[11px] text-amber-400">This is already the current location.</p>}
          {parsed && !duplicatePlace && parsed.place !== record.place && <p className="-mt-3 text-[11px] text-emerald-400">{parsed.place} is available.</p>}
        </div>}
        {view === 'delete' && record && <div className="flex flex-col items-center py-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10 text-red-300"><AlertTriangle className="h-6 w-6" /></div>
          <h3 className="mt-4 text-lg font-bold text-slate-100">Remove this record?</h3>
          <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">WO <span className="font-semibold text-slate-200">“{record.wo}”</span> at <span className="mono text-sky-300">{record.place}</span> will be permanently deleted. Its slot will become available.</p>
        </div>}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-[#101926] px-5 py-4 sm:px-6">
        {mode === 'detail' && view === 'view' ? <div className="flex items-center gap-1.5">
          <button data-testid="button-delete-record" disabled={record?.status === 'borrowed'} title={record?.status === 'borrowed' ? 'Return this file before removing it' : undefined} onClick={() => setView('delete')} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" />Remove</button>
          <button data-testid="button-move-record" disabled={record?.status === 'in_transit'} title={record?.status === 'in_transit' ? 'Complete the transit first' : undefined} onClick={() => { setForm({ ...form, place: '' }); setView('move'); }} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-sky-300 transition hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-40"><Move className="h-3.5 w-3.5" />Move</button>
        </div> : <span />}
        <div className="ml-auto flex items-center gap-2">
          {(view !== 'view' || mode === 'add') && <button data-testid="button-cancel-record" onClick={() => mode === 'add' ? onClose() : setView('view')} className="h-9 rounded-lg border border-slate-700 px-4 text-xs font-semibold text-slate-300 hover:bg-slate-800">Cancel</button>}
          {view === 'view' && mode === 'detail' && <button data-testid="button-edit-record" disabled={record?.status === 'in_transit'} title={record?.status === 'in_transit' ? 'Complete the transit first' : undefined} onClick={() => setView('edit')} className="inline-flex h-9 items-center gap-2 rounded-lg bg-sky-500 px-4 text-xs font-bold text-slate-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"><FileText className="h-3.5 w-3.5" />Edit record</button>}
          {view === 'edit' && <button data-testid="button-save-record" disabled={!canSave || saving} onClick={() => void submitSave()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-sky-500 px-4 text-xs font-bold text-slate-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-45">{saving ? 'Saving…' : <><Check className="h-3.5 w-3.5" />{mode === 'add' ? 'Add File' : 'Save Changes'}</>}</button>}
          {view === 'move' && <button data-testid="button-confirm-move" disabled={!parsed || duplicatePlace || parsed.place === record?.place || saving} onClick={async () => { if (!parsed || !onMove) return; setSaving(true); const ok = await onMove(parsed); setSaving(false); if (ok) setView('view'); }} className="inline-flex h-9 items-center gap-2 rounded-lg bg-sky-500 px-4 text-xs font-bold text-slate-950 hover:bg-sky-400 disabled:opacity-45">{saving ? 'Moving…' : <><Move className="h-3.5 w-3.5" />Move File</>}</button>}
          {view === 'delete' && <button data-testid="button-confirm-delete" disabled={saving} onClick={async () => { if (!onDelete) return; setSaving(true); await onDelete(); setSaving(false); }} className="inline-flex h-9 items-center gap-2 rounded-lg bg-red-500 px-4 text-xs font-bold text-white hover:bg-red-400 disabled:opacity-50">{saving ? 'Removing…' : <><Trash2 className="h-3.5 w-3.5" />Remove File</>}</button>}
        </div>
      </footer>
    </section>
  </div>;
}

function DetailItem({ icon: Icon, label, value, testId }: { icon: typeof Hash; label: string; value: string | number; testId: string }) {
  return <div className="flex min-w-0 items-center gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800/80 text-slate-500"><Icon className="h-3.5 w-3.5" /></span><span className="min-w-0"><span className="block text-[10px] text-slate-500">{label}</span><span data-testid={testId} className="mt-0.5 block truncate text-xs font-medium text-slate-200">{value}</span></span></div>;
}

type ImportRow = { no?: number | null; wo: string; complete?: string | null; place: string; area: string; rack: number; position: BlueFileRecord['position']; slot: number; date_in?: string | null; time_in?: string | null; pic?: string | null };
type ImportResult = { inserted: number; updated: number };

function ImportDialog({ records, pending, onClose, onImport }: { records: BlueFileRecord[]; pending: boolean; onClose: () => void; onImport: (rows: ImportRow[]) => Promise<ImportResult> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [invalidRows, setInvalidRows] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  const handleFile = async (file: File) => {
    setError('');
    setResult(null);
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext ?? '')) {
      setError('Unsupported file type. Choose an .xlsx, .xls or .csv file.');
      return;
    }
    setFileName(file.name);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('The spreadsheet has no worksheets.');
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      const cleaned: Record<string, string>[] = raw.map((row: Record<string, unknown>) => {
        const normalized: Record<string, string> = {};
        for (const [key, value] of Object.entries(row)) normalized[key.toLowerCase().replace(/\s+/g, '')] = value == null ? '' : String(value).trim();
        return normalized;
      });
      const parsedRows: ImportRow[] = [];
      const invalid: string[] = [];
      const seenWo = new Set<string>();
      const seenPlace = new Set<string>();
      cleaned.forEach((row, index) => {
        const get = (...keys: string[]) => {
          for (const key of keys) if (row[key.toLowerCase().replace(/\s+/g, '')] !== undefined) return row[key.toLowerCase().replace(/\s+/g, '')];
          return '';
        };
        const noValue = get('No', 'No.');
        const parsedNo = noValue ? Number.parseInt(noValue, 10) : null;
        const wo = get('WO').toUpperCase();
        const place = get('Place').toUpperCase().replace(/\s+/g, '');
        const complete = get('Complete');
        const dateIn = get('DateIn', 'Date In', 'Date');
        const timeIn = get('TimeIn', 'Time In', 'Time');
        const pic = get('PIC');
        if (!wo && !place) return;
        const rowLabel = `Row ${index + 2}`;
        const parsedPlace = parsePlace(place);
        if (!parsedPlace) { invalid.push(`${rowLabel}: Invalid place "${place}"`); return; }
        if (!wo) { invalid.push(`${rowLabel}: Missing WO`); return; }
        if (seenWo.has(wo)) { invalid.push(`${rowLabel}: Duplicate WO "${wo}" within file`); return; }
        if (seenPlace.has(parsedPlace.place)) { invalid.push(`${rowLabel}: Duplicate Place "${parsedPlace.place}" within file`); return; }
        seenWo.add(wo);
        seenPlace.add(parsedPlace.place);
        parsedRows.push({ no: Number.isNaN(parsedNo) ? null : parsedNo, wo, complete: complete || null, place: parsedPlace.place, area: parsedPlace.area, rack: parsedPlace.rack, position: parsedPlace.position, slot: parsedPlace.slot, date_in: dateIn || null, time_in: timeIn || null, pic: pic || null });
      });
      setRows(parsedRows);
      setInvalidRows(invalid);
      if (!parsedRows.length && !invalid.length) setError('No work orders or places were found in the first worksheet.');
    } catch (readError) {
      setError(readError instanceof Error ? `Could not read this spreadsheet: ${readError.message}` : 'Failed to read the Excel file. Please check the format.');
      setRows(null);
    }
  };

  const handleImport = async () => {
    if (!rows?.length) return;
    setWorking(true);
    setError('');
    try {
      const answer = await onImport(rows);
      setResult(answer);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Import failed. Please try again.');
    } finally {
      setWorking(false);
    }
  };

  const resetFile = () => { setRows(null); setInvalidRows([]); setFileName(''); setResult(null); setError(''); };
  const busy = pending || working;
  const expectedUpdates = rows?.filter((row) => records.some((record) => record.wo.toUpperCase() === row.wo || record.place.toUpperCase() === row.place)).length ?? 0;
  return <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="import-title" data-testid="dialog-import" className="modal-panel my-auto w-full max-w-[690px] overflow-hidden rounded-2xl border border-slate-700 bg-[#131d2b] shadow-2xl">
      <header className="flex items-start justify-between border-b border-slate-800 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300"><FileSpreadsheet className="h-5 w-5" /></span><div><h2 id="import-title" className="font-bold text-slate-100">Import from Excel</h2><p className="mt-0.5 text-[11px] text-slate-500">Columns: No, WO, Complete, Place, Date In, Time In, PIC</p></div></div>
        <button data-testid="button-close-import" aria-label="Close import dialog" onClick={onClose} disabled={busy} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40"><X className="h-5 w-5" /></button>
      </header>
      <div className="max-h-[min(68vh,620px)] overflow-y-auto p-5 sm:p-6">
        {result ? <div className="py-3">
          <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[.07] p-4"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300"><CheckCircle2 className="h-5 w-5" /></span><div><h3 className="text-sm font-bold text-emerald-100">Import complete</h3><p className="mt-1 text-xs text-emerald-100/60">Your inventory records have been processed.</p></div></div>
          <div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl border border-slate-800 bg-[#0d1521] p-4"><div className="text-[10px] uppercase tracking-[.14em] text-slate-500">Inserted</div><div data-testid="text-import-inserted" className="mt-1 text-2xl font-bold text-sky-300">{result.inserted}</div></div><div className="rounded-xl border border-slate-800 bg-[#0d1521] p-4"><div className="text-[10px] uppercase tracking-[.14em] text-slate-500">Updated</div><div data-testid="text-import-updated" className="mt-1 text-2xl font-bold text-emerald-300">{result.updated}</div></div></div>
          {!!invalidRows.length && <InvalidRows rows={invalidRows} />}
        </div> : !rows ? <div>
          <div data-testid="dropzone-import" onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) void handleFile(file); }} onClick={() => inputRef.current?.click()} className={`flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-8 text-center transition ${dragging ? 'border-emerald-400 bg-emerald-500/[.07]' : 'border-slate-700 bg-[#0d1521]/70 hover:border-slate-500 hover:bg-slate-900/60'}`}>
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-700 bg-slate-800/80 text-slate-400"><UploadCloud className="h-5 w-5" /></span>
            <p className="mt-4 text-sm font-semibold text-slate-200">Drop your spreadsheet here or <span className="text-emerald-300">browse</span></p>
            <p className="mt-1.5 text-[11px] text-slate-500">Supports .xlsx, .xls and .csv · existing records update automatically</p>
            <input ref={inputRef} data-testid="input-import-file" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleFile(file); event.currentTarget.value = ''; }} className="hidden" />
          </div>
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-slate-800 bg-[#0e1723] p-3 text-[11px] leading-5 text-slate-500"><FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600" /><p>Use a header row with <span className="text-slate-300">No, WO, Complete, Place, Date In, Time In, PIC</span>. Place format: <span className="mono text-slate-300">A16R-001</span>.</p></div>
        </div> : <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-[#0d1521] p-3.5"><div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300"><FileSpreadsheet className="h-4 w-4" /></span><span className="min-w-0"><span className="block truncate text-xs font-semibold text-slate-200">{fileName}</span><span className="mt-0.5 block text-[10px] text-slate-500">{rows.length} valid row{rows.length === 1 ? '' : 's'} · {invalidRows.length} skipped</span></span></div><button data-testid="button-change-import-file" onClick={resetFile} className="text-[11px] font-semibold text-sky-300 hover:text-sky-200">Choose another</button></div>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-sky-500/15 bg-sky-500/[.05] px-3 py-2.5 text-[11px] text-sky-100/70"><ArrowDownToLine className="h-3.5 w-3.5 text-sky-300" />{rows.length} records ready · {expectedUpdates} matching existing record{expectedUpdates === 1 ? '' : 's'} will be updated.</div>
          {invalidRows.length > 0 && <InvalidRows rows={invalidRows} />}
          {rows.length > 0 && <div className="mt-4 overflow-hidden rounded-xl border border-slate-800"><div className="flex items-center justify-between bg-[#0d1521] px-3.5 py-2.5"><span className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-500">Preview · first {Math.min(rows.length, 6)} rows</span><span className="text-[10px] text-slate-600">{rows.length} total</span></div><div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-[11px]"><thead><tr className="border-y border-slate-800 bg-slate-900/60 text-slate-500"><th className="px-3 py-2 font-semibold">No</th><th className="px-3 py-2 font-semibold">WO</th><th className="px-3 py-2 font-semibold">Place</th><th className="px-3 py-2 font-semibold">Date In</th><th className="px-3 py-2 font-semibold">PIC</th></tr></thead><tbody>{rows.slice(0, 6).map((row, index) => <tr data-testid={`row-import-preview-${index}`} key={`${row.wo}-${index}`} className="border-b border-slate-800/80 last:border-0"><td className="px-3 py-2 text-slate-500">{row.no ?? '—'}</td><td className="px-3 py-2 font-semibold text-slate-200">{row.wo}</td><td className="mono px-3 py-2 text-sky-300">{row.place}</td><td className="px-3 py-2 text-slate-400">{row.date_in || '—'}</td><td className="px-3 py-2 text-slate-400">{row.pic || '—'}</td></tr>)}</tbody></table></div></div>}
        </>}
        {error && <div data-testid="status-import-error" className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/[.07] px-3 py-2.5 text-xs text-red-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />{error}</div>}
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-slate-800 bg-[#101926] px-5 py-4 sm:px-6">
        <span className="text-[10px] text-slate-600">{!result && rows ? `${rows.length} ready · ${invalidRows.length} skipped` : 'Spreadsheet import'}</span>
        <div className="flex gap-2">{result ? <button data-testid="button-finish-import" onClick={onClose} className="h-9 rounded-lg bg-sky-500 px-4 text-xs font-bold text-slate-950 hover:bg-sky-400">Done</button> : <><button data-testid="button-cancel-import" onClick={onClose} disabled={busy} className="h-9 rounded-lg border border-slate-700 px-4 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-40">Cancel</button>{rows && <button data-testid="button-confirm-import" onClick={() => void handleImport()} disabled={busy || rows.length === 0} className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-500 px-4 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-45">{busy ? 'Importing…' : <><UploadCloud className="h-3.5 w-3.5" />Import {rows.length} files</>}</button>}</>}</div>
      </footer>
    </section>
  </div>;
}

function InvalidRows({ rows }: { rows: string[] }) {
  return <details className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/[.04]">
    <summary data-testid="button-invalid-rows" className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-[11px] font-semibold text-amber-200"><AlertTriangle className="h-3.5 w-3.5 text-amber-400" />{rows.length} invalid or duplicate row{rows.length === 1 ? '' : 's'} skipped<ChevronDown className="ml-auto h-3.5 w-3.5 text-amber-500/70" /></summary>
    <ul className="max-h-36 space-y-1 overflow-y-auto border-t border-amber-500/10 px-4 py-2.5 text-[10px] leading-4 text-amber-100/60">{rows.map((row, index) => <li key={`${row}-${index}`} data-testid={`text-invalid-row-${index}`}>{row}</li>)}</ul>
  </details>;
}

export default App;