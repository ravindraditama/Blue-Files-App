import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { blueFileRecordsTable } from "./blue-file-records";

/**
 * Append-only audit trail for the Transit workflow. wo / no are snapshots so
 * the trail survives deletion of the blue file record.
 *
 *   moved_to_transit      source = previous rack place, destination = intended place
 *   delivered_from_transit source = TRANSIT,            destination = place it was delivered to
 */
export const blueFileAuditLogTable = pgTable(
  "blue_file_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordId: uuid("record_id").references(() => blueFileRecordsTable.id, {
      onDelete: "set null",
    }),
    wo: text("wo").notNull(),
    no: integer("no"),
    eventType: text("event_type").notNull(),
    sourcePlace: text("source_place").notNull(),
    destinationPlace: text("destination_place").notNull(),
    performedBy: text("performed_by").notNull(),
    remarks: text("remarks"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("blue_file_audit_log_record_idx").on(table.recordId),
    index("blue_file_audit_log_occurred_idx").on(table.occurredAt),
    check(
      "blue_file_audit_log_event_check",
      sql`${table.eventType} IN ('moved_to_transit', 'delivered_from_transit')`,
    ),
  ],
);

export type BlueFileAuditRow = typeof blueFileAuditLogTable.$inferSelect;
