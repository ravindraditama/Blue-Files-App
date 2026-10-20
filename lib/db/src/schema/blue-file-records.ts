import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  int,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const blueFileRecordsTable = mysqlTable(
  "blue_file_records",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    no: int("no"),
    wo: varchar("wo", { length: 255 }).notNull(),
    complete: varchar("complete", { length: 255 }),
    place: varchar("place", { length: 32 }).notNull(),
    area: varchar("area", { length: 16 }).notNull(),
    rack: int("rack").notNull(),
    position: varchar("position", { length: 1 }).notNull(),
    slot: int("slot").notNull(),
    dateIn: varchar("date_in", { length: 64 }),
    timeIn: varchar("time_in", { length: 64 }),
    pic: varchar("pic", { length: 255 }),
    // available = in its rack slot, in_transit = taken out but not yet placed,
    // borrowed = checked out to a person (see blue_file_loans).
    status: varchar("status", { length: 16 }).notNull().default("available"),
    createdAt: timestamp("created_at", { mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("blue_file_records_wo_unique").on(table.wo),
    uniqueIndex("blue_file_records_place_unique").on(table.place),
    index("blue_file_records_area_idx").on(table.area),
    index("blue_file_records_location_idx").on(
      table.area,
      table.rack,
      table.position,
      table.slot,
    ),
    check("blue_file_records_area_check", sql`regexp_like(${table.area}, '^[A-Z]+$', 'c')`),
    check("blue_file_records_rack_check", sql`${table.rack} > 0`),
    check(
      "blue_file_records_position_check",
      sql`${table.position} IN ('L', 'M', 'R')`,
    ),
    check("blue_file_records_slot_check", sql`${table.slot} > 0`),
    check(
      "blue_file_records_status_check",
      sql`${table.status} IN ('available', 'borrowed', 'in_transit')`,
    ),
    index("blue_file_records_status_idx").on(table.status),
  ],
);

export type BlueFileRecordRow = typeof blueFileRecordsTable.$inferSelect;
