-- One-time fix: older rows were saved by the server with an unpadded rack (A1L-001).
-- This rewrites them to the padded format used everywhere else (A01L-001).
-- Rows in TRANSIT have no rack and are left alone.
UPDATE blue_file_records
SET place = area || lpad(rack::text, 2, '0') || position || '-' || lpad(slot::text, 3, '0')
WHERE area IS NOT NULL
  AND place <> area || lpad(rack::text, 2, '0') || position || '-' || lpad(slot::text, 3, '0');
