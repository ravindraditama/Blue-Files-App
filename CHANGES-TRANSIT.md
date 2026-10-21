# Transit workflow (TRANSIT place, monitoring, audit trail)

## What changed
- **TRANSIT is now a real system place.** A file moved to transit is stored in the place `TRANSIT`
  (it leaves its rack slot, which becomes free). Many files can be in TRANSIT at once.
- Moving a file to transit records: previous place, destination place, transit date and who moved it.
- **Complete Transit** moves the file from TRANSIT to its destination (the destination can be changed
  if it was taken in the meantime), sets it back to Active, and records the received date and who received it.
- New **Transit Monitoring** menu/page: all files in transit with file number, name, previous place,
  destination place, transit date, transit by, live duration in transit and status, plus filters
  (file number, file name, previous place, destination place, transit date) and an **Audit trail** tab.
- Dashboard card "Files in Transit" (Storage Map and Borrowed pages).
- **Audit trail** (`blue_file_audit_log`): "moved to transit" and "delivered from transit" with timestamp,
  user, source place and destination place. Rows are never deleted.
- The old "In Transit Area" tab on the Borrowed page was removed (it now lives on Transit Monitoring).

## Rules
- Active file -> Move to TRANSIT. Borrowed file -> must be returned first (it can be returned straight to TRANSIT).
- A file in transit cannot be borrowed, edited, moved or re-imported until Complete Transit is done.
- Status names: Active (`available` in the database), Borrowed, Transit (`in_transit`).
- The app has no login, so "by" is a typed name (the last one used is remembered in the browser).

## Upgrade steps (in this order)
1. `pnpm install`
2. `pnpm --filter @workspace/db run push`   (new columns, audit table, rack columns become nullable, new unique index)
3. Run `lib/db/migrate-transit.sql` once. It moves any file that was only flagged "in transit" in the old
   version into the TRANSIT place and writes an audit entry for it.
4. Run `lib/db/normalize-places.sql` once if you have not already (fixes `A1L-001` -> `A01L-001`).

## API
- POST /api/blue-file-records/:id/transit           {destination_place, transit_by, remarks?}
- POST /api/blue-file-records/:id/transit/complete  {received_by, destination_place?, received_at?, remarks?}
- POST /api/blue-file-records/:id/return            now also accepts {transit_by, destination_place} when return_to = in_transit
- GET  /api/blue-file-audit-log
- Removed: POST /api/blue-file-records/:id/status (replaced by /transit and /transit/complete)
