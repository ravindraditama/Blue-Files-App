import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db, blueFileRecordsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/admin";
import {
  BlueFileRecordInput,
  CreateBlueFileBody,
  CreateBlueFileResponse,
  DeleteBlueFileParams,
  GetBlueFilesSummaryResponse,
  ImportBlueFilesBody,
  ImportBlueFilesResponse,
  ListBlueFilesResponse,
  MoveBlueFileBody,
  MoveBlueFileParams,
  MoveBlueFileResponse,
  UpdateBlueFileBody,
  UpdateBlueFileParams,
  UpdateBlueFileResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

type CanonicalBlueFileInput = {
  no: number | null;
  wo: string;
  complete: string | null;
  place: string;
  area: string;
  rack: number;
  position: "L" | "M" | "R";
  slot: number;
  dateIn: string | null;
  timeIn: string | null;
  pic: string | null;
};

class InputConflictError extends Error {}

function parsePlace(value: string) {
  const match = value.trim().toUpperCase().replace(/\s+/g, "").match(/^([A-Z]+)(\d+)([LMR])-(\d+)$/);
  if (!match) return null;

  const area = match[1];
  const rack = Number.parseInt(match[2], 10);
  const position = match[3] as "L" | "M" | "R";
  const slot = Number.parseInt(match[4], 10);
  if (!Number.isSafeInteger(rack) || rack < 1 || !Number.isSafeInteger(slot) || slot < 1) {
    return null;
  }

  return {
    area,
    rack,
    position,
    slot,
    place: `${area}${rack}${position}-${String(slot).padStart(3, "0")}`,
  };
}

function canonicalizeInput(
  input: BlueFileRecordInput,
): CanonicalBlueFileInput {
  const location = parsePlace(input.place);
  if (!location) {
    throw new InputConflictError("Invalid place. Use a code such as A16R-001.");
  }
  if (
    input.area.trim().toUpperCase() !== location.area ||
    input.rack !== location.rack ||
    input.position.toUpperCase() !== location.position ||
    input.slot !== location.slot
  ) {
    throw new InputConflictError("The place code does not match its location fields.");
  }
  if (!input.wo.trim()) {
    throw new InputConflictError("Work order is required.");
  }

  return {
    no: input.no ?? null,
    wo: input.wo.trim().toUpperCase(),
    complete: input.complete?.trim() || null,
    place: location.place,
    area: location.area,
    rack: location.rack,
    position: location.position,
    slot: location.slot,
    dateIn: input.date_in?.trim() || null,
    timeIn: input.time_in?.trim() || null,
    pic: input.pic?.trim() || null,
  };
}

function serializeRecord(record: typeof blueFileRecordsTable.$inferSelect) {
  return {
    id: record.id,
    no: record.no,
    wo: record.wo,
    complete: record.complete,
    place: record.place,
    area: record.area,
    rack: record.rack,
    position: record.position,
    slot: record.slot,
    date_in: record.dateIn,
    time_in: record.timeIn,
    pic: record.pic,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

// drizzle wraps driver errors in DrizzleQueryError (original on .cause)
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "ER_DUP_ENTRY") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}

// MySQL has no RETURNING; re-select the row after a write.
async function findRecord(id: string) {
  const [row] = await db
    .select()
    .from(blueFileRecordsTable)
    .where(eq(blueFileRecordsTable.id, id));
  return row;
}

function errorBody(message: string) {
  return { error: message };
}

function sendConflict(res: Response, message: string) {
  res.status(409).json(errorBody(message));
}

router.get("/blue-file-records", async (_req, res): Promise<void> => {
  const records = await db
    .select()
    .from(blueFileRecordsTable)
    .orderBy(
      asc(blueFileRecordsTable.area),
      asc(blueFileRecordsTable.rack),
      asc(blueFileRecordsTable.position),
      asc(blueFileRecordsTable.slot),
    );
  res.json(ListBlueFilesResponse.parse(records.map(serializeRecord)));
});

router.get("/blue-file-records/summary", async (_req, res): Promise<void> => {
  const records = await db
    .select({
      area: blueFileRecordsTable.area,
      rack: blueFileRecordsTable.rack,
      slot: blueFileRecordsTable.slot,
    })
    .from(blueFileRecordsTable);
  const areaMap = new Map<
    string,
    { occupied: number; racks: Set<number>; maxRack: number; maxSlot: number }
  >();

  for (const record of records) {
    const current = areaMap.get(record.area) ?? {
      occupied: 0,
      racks: new Set<number>(),
      maxRack: 0,
      maxSlot: 0,
    };
    current.occupied += 1;
    current.racks.add(record.rack);
    current.maxRack = Math.max(current.maxRack, record.rack);
    current.maxSlot = Math.max(current.maxSlot, record.slot);
    areaMap.set(record.area, current);
  }

  const areas = Array.from(areaMap, ([area, value]) => ({
    area,
    occupied: value.occupied,
    racks: value.racks.size,
    max_rack: value.maxRack,
    max_slot: value.maxSlot,
    capacity: value.maxRack * 3 * value.maxSlot,
  })).sort((a, b) => a.area.localeCompare(b.area));
  const occupied = records.length;
  const totalCapacity = areas.reduce((total, area) => total + area.capacity, 0);

  res.json(
    GetBlueFilesSummaryResponse.parse({
      total_capacity: totalCapacity,
      occupied,
      empty: Math.max(0, totalCapacity - occupied),
      utilization: totalCapacity > 0 ? (occupied / totalCapacity) * 100 : 0,
      areas,
    }),
  );
});

// Admin login check for the /admin screen (requireAdmin does the work).
router.post("/admin/verify", requireAdmin, (_req, res): void => {
  res.json({ ok: true });
});

router.post("/blue-file-records", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateBlueFileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(errorBody(parsed.error.message));
    return;
  }

  let input: CanonicalBlueFileInput;
  try {
    input = canonicalizeInput(parsed.data);
  } catch (error) {
    res.status(400).json(
      errorBody(error instanceof Error ? error.message : "Invalid record."),
    );
    return;
  }

  try {
    const id = randomUUID();
    await db.insert(blueFileRecordsTable).values({ id, ...input });
    const created = (await findRecord(id))!;
    res.status(201).json(CreateBlueFileResponse.parse(serializeRecord(created)));
  } catch (error) {
    if (isUniqueViolation(error)) {
      sendConflict(res, "That work order or storage place is already in use.");
      return;
    }
    throw error;
  }
});

router.post("/blue-file-records/import", requireAdmin, async (req, res): Promise<void> => {
  const parsed = ImportBlueFilesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(errorBody(parsed.error.message));
    return;
  }

  let records: CanonicalBlueFileInput[];
  try {
    records = parsed.data.records.map(canonicalizeInput);
    const seenWorkOrders = new Set<string>();
    const seenPlaces = new Set<string>();
    for (const record of records) {
      if (seenWorkOrders.has(record.wo)) {
        throw new InputConflictError(`Duplicate work order in import: ${record.wo}.`);
      }
      if (seenPlaces.has(record.place)) {
        throw new InputConflictError(`Duplicate storage place in import: ${record.place}.`);
      }
      seenWorkOrders.add(record.wo);
      seenPlaces.add(record.place);
    }
  } catch (error) {
    res.status(400).json(
      errorBody(error instanceof Error ? error.message : "Invalid import data."),
    );
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const workOrders = records.map((record) => record.wo);
      const places = records.map((record) => record.place);
      const existingWorkOrders = await tx
        .select({ id: blueFileRecordsTable.id, wo: blueFileRecordsTable.wo })
        .from(blueFileRecordsTable)
        .where(inArray(blueFileRecordsTable.wo, workOrders));
      const existingPlaces = await tx
        .select({ id: blueFileRecordsTable.id, wo: blueFileRecordsTable.wo, place: blueFileRecordsTable.place })
        .from(blueFileRecordsTable)
        .where(inArray(blueFileRecordsTable.place, places));
      const existingByWo = new Map(existingWorkOrders.map((record) => [record.wo, record]));
      const existingByPlace = new Map(existingPlaces.map((record) => [record.place, record]));

      for (const record of records) {
        const existing = existingByWo.get(record.wo);
        const placeOwner = existingByPlace.get(record.place);
        if (placeOwner && placeOwner.id !== existing?.id) {
          throw new InputConflictError(
            `Storage place ${record.place} is assigned to another work order.`,
          );
        }
      }

      const batchSize = 500;
      for (let index = 0; index < records.length; index += batchSize) {
        const batch = records.slice(index, index + batchSize);
        await tx
          .insert(blueFileRecordsTable)
          .values(batch)
          .onDuplicateKeyUpdate({
            set: {
              no: sql`values(${blueFileRecordsTable.no})`,
              complete: sql`values(${blueFileRecordsTable.complete})`,
              place: sql`values(${blueFileRecordsTable.place})`,
              area: sql`values(${blueFileRecordsTable.area})`,
              rack: sql`values(${blueFileRecordsTable.rack})`,
              position: sql`values(${blueFileRecordsTable.position})`,
              slot: sql`values(${blueFileRecordsTable.slot})`,
              dateIn: sql`values(${blueFileRecordsTable.dateIn})`,
              timeIn: sql`values(${blueFileRecordsTable.timeIn})`,
              pic: sql`values(${blueFileRecordsTable.pic})`,
              updatedAt: sql`now()`,
            },
          });
      }

      return {
        inserted: records.length - existingByWo.size,
        updated: existingByWo.size,
      };
    });

    res.json(ImportBlueFilesResponse.parse(result));
  } catch (error) {
    if (error instanceof InputConflictError) {
      sendConflict(res, error.message);
      return;
    }
    if (isUniqueViolation(error)) {
      sendConflict(res, "That work order or storage place is already in use.");
      return;
    }
    throw error;
  }
});

router.patch("/blue-file-records/:id", async (req, res): Promise<void> => {
  const params = UpdateBlueFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(errorBody(params.error.message));
    return;
  }
  const parsed = UpdateBlueFileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(errorBody(parsed.error.message));
    return;
  }

  let input: CanonicalBlueFileInput;
  try {
    input = canonicalizeInput(parsed.data);
  } catch (error) {
    res.status(400).json(
      errorBody(error instanceof Error ? error.message : "Invalid record."),
    );
    return;
  }

  try {
    await db
      .update(blueFileRecordsTable)
      .set(input)
      .where(eq(blueFileRecordsTable.id, params.data.id));
    const updated = await findRecord(params.data.id);
    if (!updated) {
      res.status(404).json(errorBody("Record not found."));
      return;
    }
    res.json(UpdateBlueFileResponse.parse(serializeRecord(updated)));
  } catch (error) {
    if (isUniqueViolation(error)) {
      sendConflict(res, "That work order or storage place is already in use.");
      return;
    }
    throw error;
  }
});

router.patch("/blue-file-records/:id/move", async (req, res): Promise<void> => {
  const params = MoveBlueFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(errorBody(params.error.message));
    return;
  }
  const parsed = MoveBlueFileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(errorBody(parsed.error.message));
    return;
  }
  const location = parsePlace(parsed.data.place);
  if (!location) {
    res.status(400).json(errorBody("Invalid place. Use a code such as A16R-001."));
    return;
  }

  try {
    await db
      .update(blueFileRecordsTable)
      .set({
        place: location.place,
        area: location.area,
        rack: location.rack,
        position: location.position,
        slot: location.slot,
      })
      .where(eq(blueFileRecordsTable.id, params.data.id));
    const updated = await findRecord(params.data.id);
    if (!updated) {
      res.status(404).json(errorBody("Record not found."));
      return;
    }
    res.json(MoveBlueFileResponse.parse(serializeRecord(updated)));
  } catch (error) {
    if (isUniqueViolation(error)) {
      sendConflict(res, "That storage place is already in use.");
      return;
    }
    throw error;
  }
});

router.delete("/blue-file-records/:id", async (req, res): Promise<void> => {
  const params = DeleteBlueFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(errorBody(params.error.message));
    return;
  }
  const [deleted] = await db
    .delete(blueFileRecordsTable)
    .where(eq(blueFileRecordsTable.id, params.data.id));
  if (deleted.affectedRows === 0) {
    res.status(404).json(errorBody("Record not found."));
    return;
  }
  res.sendStatus(204);
});

export default router;