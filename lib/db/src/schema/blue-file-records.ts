import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const blueFileRecordsTable = pgTable(
  "blue_file_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wo: text("wo").notNull(),
    place: text("place").notNull(),
    pic: text("pic"),
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
  ],
);

export type BlueFileRecordRow = typeof blueFileRecordsTable.$inferSelect;