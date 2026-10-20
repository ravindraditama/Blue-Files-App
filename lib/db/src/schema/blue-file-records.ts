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

export const blueFileRecordsTable = pgTable(
  "blue_file_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    no: integer("no"),
    wo: text("wo").notNull(),
    complete: text("complete"),
    place: text("place").notNull(),
    area: text("area").notNull(),
    rack: integer("rack").notNull(),
    position: text("position").notNull(),
    slot: integer("slot").notNull(),
    dateIn: text("date_in"),
    timeIn: text("time_in"),
    pic: text("pic"),
    // available = in its rack slot, in_transit = taken out but not yet placed,
    // borrowed = checked out to a person (see blue_file_loans).
    status: text("status").notNull().default("available"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
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
    check("blue_file_records_area_check", sql`${table.area} ~ '^[A-Z]+$'`),
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