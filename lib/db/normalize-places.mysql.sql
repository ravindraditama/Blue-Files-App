-- One-time fix (MySQL version of the owner's normalize-places.sql).
-- Rows saved before the borrowing update used an unpadded rack (A1L-001);
-- the new code uses the padded form (A01L-001) everywhere. Run once after the schema push.
-- Guarded so a 3-digit rack/slot is never truncated by LPAD.
UPDATE blue_file_records
SET place = CONCAT(area, LPAD(rack, 2, '0'), position, '-', LPAD(slot, 3, '0'))
WHERE rack < 100 AND slot < 1000
  AND place <> CONCAT(area, LPAD(rack, 2, '0'), position, '-', LPAD(slot, 3, '0'));
