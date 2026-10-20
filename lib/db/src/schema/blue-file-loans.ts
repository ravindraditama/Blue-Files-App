import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  int,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { blueFileRecordsTable } from "./blue-file-records";

/**
 * One row per time a blue file is borrowed. A row with returned_at = NULL is an
 * open (current) loan. Rows are never deleted, so the history stays traceable
 * even if the blue file record itself is later removed (record_id becomes NULL,
 * the wo / no / place snapshot columns keep the identity).
 */
export const blueFileLoansTable = mysqlTable(
  "blue_file_loans",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    recordId: varchar("record_id", { length: 36 }).references(
      () => blueFileRecordsTable.id,
      { onDelete: "set null" },
    ),
    wo: varchar("wo", { length: 255 }).notNull(),
    no: int("no"),
    place: varchar("place", { length: 32 }).notNull(),
    borrowerName: varchar("borrower_name", { length: 255 }).notNull(),
    borrowedAt: timestamp("borrowed_at", { mode: "date" }).notNull(),
    borrowRemarks: text("borrow_remarks"),
    returnedAt: timestamp("returned_at", { mode: "date" }),
    returnedTo: varchar("returned_to", { length: 16 }),
    returnRemarks: text("return_remarks"),
    createdAt: timestamp("created_at", { mode: "date" })
      .notNull()
      .defaultNow(),
    // MySQL has no partial unique index. This generated column is 1 while the loan
    // is open and NULL once returned; NULLs never collide in a unique index, so
    // (record_id, open_flag) allows many returned loans but only one open one.
    openFlag: int("open_flag").generatedAlwaysAs(
      sql`(case when returned_at is null then 1 else null end)`,
      { mode: "stored" },
    ),
  },
  (table) => [
    // A blue file can have at most one open loan at a time.
    uniqueIndex("blue_file_loans_one_open_per_record").on(
      table.recordId,
      table.openFlag,
    ),
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
