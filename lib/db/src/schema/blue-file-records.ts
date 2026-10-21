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

/**
 * System place used for every file that is in transit. It is not a rack slot:
 * area / rack / position / slot are NULL for records that sit here, and any
 * number of files can be in TRANSIT at the same time.
 */
export const TRANSIT_PLACE = "TRANSIT";

export const blueFileRecordsTable = pgTable(
  "blue_file_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    no: integer("no"),
    wo: text("wo").notNull(),
    complete: text("complete"),
    // Current place: a rack slot such as A16R-001, or TRANSIT.
    place: text("place").notNull(),
    area: text("area"),
    rack: integer("rack"),
    position: text("position"),
    slot: integer("slot"),
    dateIn: text("date_in"),
    timeIn: text("time_in"),
    pic: text("pic"),
    // available = in its rack slot (shown as ACTIVE), borrowed = checked out to a
    // person (see blue_file_loans), in_transit = stored in the TRANSIT place.
    status: text("status").notNull().default("available"),
    // Last transit trip. previous_place / destination_place / transit_* are set
    // when a file enters TRANSIT; received_* when it is delivered. The full
    // history lives in blue_file_audit_log.
    previousPlace: text("previous_place"),
    destinationPlace: text("destination_place"),
    transitAt: timestamp("transit_at", { withTimezone: true }),
    transitBy: text("transit_by"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    receivedBy: text("received_by"),
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
    // Rack slots are unique; the TRANSIT place is shared by many files.
    uniqueIndex("blue_file_records_place_unique")
      .on(table.place)
      .where(sql`${table.place} <> 'TRANSIT'`),
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