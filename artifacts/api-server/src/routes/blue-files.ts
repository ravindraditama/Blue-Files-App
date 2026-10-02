import { Router, type IRouter, type Response } from "express";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db, blueFileRecordsTable } from "@workspace/db";
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
  wo: string;
  place: string;
  pic: string | null;
};

const CONTINUATION_AREAS = ["R", "S", "T", "U", "V", "W"] as const;
const CONTINUATION_AREA_SET = new Set<string>(CONTINUATION_AREAS);
const CONTINUATION_RACKS = 18;
const CONTINUATION_SLOTS = 15;

class InputConflictError extends Error {}

function parsePlace(value: string) {
  const cleaned = value.trim().toUpperCase().replace(/\s+/g, "");
  const numericAreaAlias = cleaned.match(/^0(\d+)([LMR])-(\d+)$/);
  const normalizedInput = numericAreaAlias
    ? `O${numericAreaAlias[1]}${numericAreaAlias[2]}-${numericAreaAlias[3]}`
    : cleaned;
  const match = normalizedInput.match(/^([A-Z]+)(\d+)([LMR])-(\d+)$/);
  if (!match) return null;

  const area = match[1];
  const rack = Number.parseInt(match[2], 10);
  const position = match[3] as "L" | "M" | "R";
  const slot = Number.parseInt(match[4], 10);
  if (!Number.isSafeInteger(rack) || rack < 1 || !Number.isSafeInteger(slot) || slot < 1) {
    return null;
  }
  if (
    CONTINUATION_AREA_SET.has(area) &&
    (rack > CONTINUATION_RACKS || slot > CONTINUATION_SLOTS)
  ) {
    return null;
  }

  return {
    area,
    rack,
    position,
    slot,
    place: `${area}${String(rack).padStart(2, "0")}${position}-${String(slot).padStart(3, "0")}`,
  };
}

function canonicalizeInput(
  input: BlueFileRecordInput,
): CanonicalBlueFileInput {
  const location = parsePlace(input.place);
  if (!location) {
    throw new InputConflictError("Invalid place. Use a code such as A01R-001.");
  }
  if (!input.wo.trim()) {
    throw new InputConflictError("Work order is required.");
  }

  return {
    wo: input.wo.trim().toUpperCase(),
    place: location.place,
    pic: input.pic?.trim() || null,
  };
}

function serializeRecord(record: typeof blueFileRecordsTable.$inferSelect) {
  return {
    id: record.id,
    wo: record.wo,
    place: record.place,
    pic: record.pic,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
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
    .orderBy(asc(blueFileRecordsTable.place));
  res.json(ListBlueFilesResponse.parse(records.map(serializeRecord)));
});

router.get("/blue-file-records/summary", async (_req, res): Promise<void> => {
  const records = await db
    .select({
      place: blueFileRecordsTable.place,
    })
    .from(blueFileRecordsTable);
  const areaMap = new Map<
    string,
    { occupied: number; racks: Set<number>; maxRack: number; maxSlot: number }
  >();

  for (const area of CONTINUATION_AREAS) {
    areaMap.set(area, {
      occupied: 0,
      racks: new Set(
        Array.from({ length: CONTINUATION_RACKS }, (_, index) => index + 1),
      ),
      maxRack: CONTINUATION_RACKS,
      maxSlot: CONTINUATION_SLOTS,
    });
  }

  for (const record of records) {
    const location = parsePlace(record.place);
    if (!location) {
      throw new Error(`Invalid saved place code: ${record.place}`);
    }
    const current = areaMap.get(location.area) ?? {
      occupied: 0,
      racks: new Set<number>(),
      maxRack: 0,
      maxSlot: 0,
    };
    current.occupied += 1;
    current.racks.add(location.rack);
    current.maxRack = Math.max(current.maxRack, location.rack);
    current.maxSlot = Math.max(current.maxSlot, location.slot);
    areaMap.set(location.area, current);
  }

  const areas = Array.from(areaMap, ([area, value]) => ({
    area,
    occupied: value.occupied,
    racks: value.racks.size,
    max_rack: value.maxRack,
    max_slot: value.maxSlot,
    capacity: CONTINUATION_AREA_SET.has(area)
      ? CONTINUATION_RACKS * 3 * CONTINUATION_SLOTS
      : value.maxRack * 3 * value.maxSlot,
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

router.post("/blue-file-records", async (req, res): Promise<void> => {
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
    const [created] = await db
      .insert(blueFileRecordsTable)
      .values(input)
      .returning();
    res.status(201).json(CreateBlueFileResponse.parse(serializeRecord(created)));
  } catch (error) {
    if (isUniqueViolation(error)) {
      sendConflict(res, "That work order or storage place is already in use.");
      return;
    }
    throw error;
  }
});

router.post("/blue-file-records/import", async (req, res): Promise<void> => {
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
          .onConflictDoUpdate({
            target: blueFileRecordsTable.wo,
            set: {
              place: sql`excluded.place`,
              pic: sql`excluded.pic`,
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
    const [updated] = await db
      .update(blueFileRecordsTable)
      .set(input)
      .where(eq(blueFileRecordsTable.id, params.data.id))
      .returning();
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
    res.status(400).json(errorBody("Invalid place. Use a code such as A01R-001."));
    return;
  }

  try {
    const [updated] = await db
      .update(blueFileRecordsTable)
      .set({
        place: location.place,
      })
      .where(eq(blueFileRecordsTable.id, params.data.id))
      .returning();
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
    .where(eq(blueFileRecordsTable.id, params.data.id))
    .returning({ id: blueFileRecordsTable.id });
  if (!deleted) {
    res.status(404).json(errorBody("Record not found."));
    return;
  }
  res.sendStatus(204);
});

export default router;