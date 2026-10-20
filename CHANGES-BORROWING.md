# Borrowing, Transit Area & History

## After pulling these changes
1. `pnpm install`
2. `pnpm --filter @workspace/db run push`
   Adds `blue_file_records.status` (existing rows become `available`) and the new `blue_file_loans` table.
3. Run `lib/db/normalize-places.sql` once (fixes older rows saved as `A1L-001` -> `A01L-001`).
4. Optional: `pnpm --filter @workspace/api-spec run codegen`.
   The generated API files were updated by hand to match `openapi.yaml`; regenerating should give the same result.

## Statuses
- Available: in its rack slot.
- In Transit Area: taken out, not yet placed. The rack slot stays reserved.
- Borrowed: checked out to a person. Must be returned (to Available or Transit Area) before any other move.

## New endpoints
- POST /api/blue-file-records/:id/status  {status: "available" | "in_transit"}
- POST /api/blue-file-records/:id/borrow  {borrower_name, borrowed_at?, remarks?}
- POST /api/blue-file-records/:id/return  {return_to, returned_at?, remarks?}
- GET  /api/blue-file-loans               full borrowing history (never deleted)

Records now include `status`, `current_location`, `borrower_name`, `borrowed_at`, `borrow_remarks`.
Summary now includes `total_files`, `available_files`, `borrowed_files`, `in_transit_files`.
A borrowed file cannot be removed until it is returned.
