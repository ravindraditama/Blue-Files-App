-- Run ONCE, after `pnpm --filter @workspace/db run push`.
--
-- Older versions only flagged a file as in_transit and left it in its rack slot.
-- This moves those files into the dedicated TRANSIT place and writes an audit
-- entry for each, so they show up on the Transit Monitoring page.
BEGIN;

INSERT INTO blue_file_audit_log
  (record_id, wo, no, event_type, source_place, destination_place, performed_by, occurred_at)
SELECT id, wo, no, 'moved_to_transit', place, place, 'Unknown (migrated)', updated_at
FROM blue_file_records
WHERE status = 'in_transit' AND place <> 'TRANSIT';

UPDATE blue_file_records
SET previous_place = place,
    destination_place = place,
    transit_at = updated_at,
    transit_by = 'Unknown (migrated)',
    place = 'TRANSIT',
    area = NULL, rack = NULL, position = NULL, slot = NULL
WHERE status = 'in_transit' AND place <> 'TRANSIT';

COMMIT;
