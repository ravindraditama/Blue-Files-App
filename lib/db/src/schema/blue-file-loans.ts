import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { blueFileRecordsTable } from "./blue-file-records";

/**
 * One row per time a blue file is borrowed. A row with returned_at = NULL is an
 * open (current) loan. Rows are never deleted, so the history stays traceable
 * even if the blue file record itself is later removed (record_id becomes NULL,
 * the wo / no / place snapshot columns keep the identity).
 */
export const blueFileLoansTable = pgTable(
  "blue_file_loans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordId: uuid("record_id").references(() => blueFileRecordsTable.id, {
      onDelete: "set null",
    }),
    wo: text("wo").notNull(),
    no: integer("no"),
    place: text("place").notNull(),
    borrowerName: text("borrower_name").notNull(),
    borrowedAt: timestamp("borrowed_at", { withTimezone: true }).notNull(),
    borrowRemarks: text("borrow_remarks"),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    returnedTo: text("returned_to"),
    returnRemarks: text("return_remarks"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // A blue file can have at most one open loan at a time.
    uniqueIndex("blue_file_loans_one_open_per_record")
      .on(table.recordId)
      .where(sql`${table.returnedAt} IS NULL AND ${table.recordId} IS NOT NULL`),
    index("blue_file_loans_record_idx").on(table.recordId),
    index("blue_file_loans_borrowed_at_idx").on(table.borrowedAt),
    check(
      "blue_file_loans_returned_to_check",
      sql`${table.returnedTo} IS NULL OR ${table.returnedTo} IN ('available', 'in_transit')`,
    ),
    check(
      "blue_file_loans_return_after_borrow_check",
      sql`${table.returnedAt} IS NULL OR ${table.returnedAt} >= ${table.borrowedAt}`,
    ),
  ],
);

export type BlueFileLoanRow = typeof blueFileLoansTable.$inferSelect;
