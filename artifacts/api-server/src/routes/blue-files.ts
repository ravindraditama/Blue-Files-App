import { Router, type IRouter, type Response } from "express";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  db,
  TRANSIT_PLACE,
  blueFileAuditLogTable,
  blueFileLoansTable,
  blueFileRecordsTable,
} from "@workspace/db";
import {
  BlueFileRecordInput,
  BorrowBlueFileBody,
  BorrowBlueFileParams,
  BorrowBlueFileResponse,
  CompleteBlueFileTransitBody,
  CompleteBlueFileTransitParams,
  CompleteBlueFileTransitResponse,
  CreateBlueFileBody,
  CreateBlueFileResponse,
  DeleteBlueFileParams,
  GetBlueFilesSummaryResponse,
  ImportBlueFilesBody,
  ImportBlueFilesResponse,
  ListBlueFileAuditLogResponse,
  ListBlueFileLoansResponse,
  ListBlueFilesResponse,
  MoveBlueFileBody,
  MoveBlueFileParams,
  MoveBlueFileResponse,
  ReturnBlueFileBody,
  ReturnBlueFileParams,
  ReturnBlueFileResponse,
  StartBlueFileTransitBody,
  StartBlueFileTransitParams,
  StartBlueFileTransitResponse,
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
    place: `${area}${String(rack).padStart(2, "0")}${position}-${String(slot).padStart(3, "0")}`,
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

type RecordRow = typeof blueFileRecordsTable.$inferSelect;
type LoanRow = typeof blueFileLoansTable.$inferSelect;

function currentLocation(record: RecordRow, loan?: LoanRow): string {
  if (record.status === "in_transit") return TRANSIT_PLACE;
  if (record.status === "borrowed") {
    return `Borrowed by ${loan?.borrowerName ?? "unknown borrower"}`;
  }
  return `Rack ${record.place}`;
}

function serializeRecord(record: RecordRow, loan?: LoanRow) {
  const openLoan = record.status === "borrowed" ? loan : undefined;
  return {
    id: record.id,
    no: record.no,
    wo: record.wo,
    complete: record.complete,
    place: record.place,
    area: record.area,
    rack: record.rack,
    position: record.position as "L" | "M" | "R" | null,
    slot: record.slot,
    date_in: record.dateIn,
    time_in: record.timeIn,
    pic: record.pic,
    status: record.status as "available" | "borrowed" | "in_transit",
    current_location: currentLocation(record, openLoan),
    borrower_name: openLoan?.borrowerName ?? null,
    borrowed_at: openLoan?.borrowedAt ?? null,
    borrow_remarks: openLoan?.borrowRemarks ?? null,
    previous_place: record.previousPlace,
    destination_place: record.destinationPlace,
    transit_at: record.transitAt ? record.transitAt.toISOString() : null,
    transit_by: record.transitBy,
    received_at: record.receivedAt ? record.receivedAt.toISOString() : null,
    received_by: record.receivedBy,
    transit_duration_minutes:
      record.status === "in_transit" && record.transitAt
        ? Math.max(0, Math.floor((Date.now() - record.transitAt.getTime()) / 60000))
        : null,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

async function findOpenLoan(recordId: string): Promise<LoanRow | undefined> {
  const [loan] = await db
    .select()
    .from(blueFileLoansTable)
    .where(
      and(
        eq(blueFileLoansTable.recordId, recordId),
        isNull(blueFileLoansTable.returnedAt),
      ),
    );
  return loan;
}

/** Serialize a single record, loading its open loan when it is borrowed. */
async function serializeWithLoan(record: RecordRow) {
  const loan =
    record.status === "borrowed" ? await findOpenLoan(record.id) : undefined;
  return serializeRecord(record, loan);
}

function serializeLoan(loan: LoanRow, now = new Date()) {
  const end = loan.returnedAt ?? now;
  const minutes = Math.max(
    0,
    Math.floor((end.getTime() - loan.borrowedAt.getTime()) / 60000),
  );
  return {
    id: loan.id,
    record_id: loan.recordId,
    no: loan.no,
    wo: loan.wo,
    place: loan.place,
    borrower_name: loan.borrowerName,
    borrowed_at: loan.borrowedAt.toISOString(),
    borrow_remarks: loan.borrowRemarks,
    returned_at: loan.returnedAt ? loan.returnedAt.toISOString() : null,
    returned_to: loan.returnedTo as "available" | "in_transit" | null,
    return_remarks: loan.returnRemarks,
    duration_minutes: minutes,
    is_active: loan.returnedAt === null,
  };
}

class HttpError extends Error {
  constructor(
    readonly statusCode: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function requireDestination(value: string | null | undefined) {
  const location = parsePlace(value ?? "");
  if (!location) {
    throw new HttpError(400, "Invalid destination. Use a place code such as A16R-001.");
  }
  return location;
}

/** A rack place holds one file. TRANSIT is not a rack place and is never checked here. */
async function assertPlaceFree(tx: Tx, place: string, ignoreId: string) {
  const [owner] = await tx
    .select({ wo: blueFileRecordsTable.wo })
    .from(blueFileRecordsTable)
    .where(and(eq(blueFileRecordsTable.place, place), ne(blueFileRecordsTable.id, ignoreId)));
  if (owner) {
    throw new HttpError(409, `Place ${place} is already used by ${owner.wo}.`);
  }
}

/**
 * The single place where a file enters TRANSIT. Used by the transit endpoint and
 * by "return to Transit", so both follow the same rules: the file leaves its rack
 * slot (which becomes free), is stored in the TRANSIT place, and the move is audited.
 */
async function enterTransit(
  tx: Tx,
  record: RecordRow,
  opts: { destination: string; by: string; at: Date; remarks: string | null },
): Promise<RecordRow> {
  const destination = requireDestination(opts.destination);
  await assertPlaceFree(tx, destination.place, record.id);
  const [updated] = await tx
    .update(blueFileRecordsTable)
    .set({
      previousPlace: record.place,
      destinationPlace: destination.place,
      transitAt: opts.at,
      transitBy: opts.by,
      receivedAt: null,
      receivedBy: null,
      status: "in_transit",
      place: TRANSIT_PLACE,
      area: null,
      rack: null,
      position: null,
      slot: null,
    })
    .where(eq(blueFileRecordsTable.id, record.id))
    .returning();
  await tx.insert(blueFileAuditLogTable).values({
    recordId: record.id,
    wo: record.wo,
    no: record.no,
    eventType: "moved_to_transit",
    sourcePlace: record.place,
    destinationPlace: destination.place,
    performedBy: opts.by,
    remarks: opts.remarks,
    occurredAt: opts.at,
  });
  return updated;
}

function sendHttpError(res: Response, error: unknown): boolean {
  if (error instanceof HttpError) {
    res.status(error.statusCode).json(errorBody(error.message));
    return true;
  }
  if (isUniqueViolation(error)) {
    sendConflict(res, "That storage place is already in use.");
    return true;
  }
  return false;
}

/** Parses an optional ISO timestamp. Returns null when invalid or in the future. */
function resolveTimestamp(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // Allow a few minutes of clock skew between browser and server.
  if (date.getTime() > Date.now() + 5 * 60 * 1000) return null;
  return date;
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

async function sendNotFoundOrInTransit(res: Response, id: string, hint: string) {
  const [existing] = await db
    .select({ id: blueFileRecordsTable.id })
    .from(blueFileRecordsTable)
    .where(eq(blueFileRecordsTable.id, id));
  if (existing) sendConflict(res, `This blue file is in Transit. ${hint}`);
  else res.status(404).json(errorBody("Record not found."));
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
  const openLoans = await db
    .select()
    .from(blueFileLoansTable)
    .where(isNull(blueFileLoansTable.returnedAt));
  const loanByRecord = new Map<string, LoanRow>();
  for (const loan of openLoans) {
    if (loan.recordId) loanByRecord.set(loan.recordId, loan);
  }
  res.json(
    ListBlueFilesResponse.parse(
      records.map((record) => serializeRecord(record, loanByRecord.get(record.id))),
    ),
  );
});

router.get("/blue-file-records/summary", async (_req, res): Promise<void> => {
  const records = await db
    .select({
      area: blueFileRecordsTable.area,
      rack: blueFileRecordsTable.rack,
      slot: blueFileRecordsTable.slot,
      status: blueFileRecordsTable.status,
    })
    .from(blueFileRecordsTable);
  const borrowedFiles = records.filter((r) => r.status === "borrowed").length;
  const inTransitFiles = records.filter((r) => r.status === "in_transit").length;
  const areaMap = new Map<
    string,
    { occupied: number; racks: Set<number>; maxRack: number; maxSlot: number }
  >();

  // Files in TRANSIT have no rack slot, so they do not count towards rack capacity.
  const shelved = records.filter((record) => record.status !== "in_transit");

  for (const record of shelved) {
    if (record.area === null || record.rack === null || record.slot === null) continue;
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
  const occupied = shelved.length;
  const totalCapacity = areas.reduce((total, area) => total + area.capacity, 0);

  res.json(
    GetBlueFilesSummaryResponse.parse({
      total_capacity: totalCapacity,
      occupied,
      empty: Math.max(0, totalCapacity - occupied),
      utilization: totalCapacity > 0 ? (occupied / totalCapacity) * 100 : 0,
      total_files: records.length,
      available_files: records.length - borrowedFiles - inTransitFiles,
      borrowed_files: borrowedFiles,
      in_transit_files: inTransitFiles,
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
        .select({ id: blueFileRecordsTable.id, wo: blueFileRecordsTable.wo, status: blueFileRecordsTable.status })
        .from(blueFileRecordsTable)
        .where(inArray(blueFileRecordsTable.wo, workOrders));
      const inTransit = existingWorkOrders.filter((record) => record.status === "in_transit");
      if (inTransit.length > 0) {
        const shown = inTransit.slice(0, 5).map((record) => record.wo).join(", ");
        const more = inTransit.length > 5 ? ` and ${inTransit.length - 5} more` : "";
        throw new InputConflictError(
          `These files are in Transit: ${shown}${more}. Complete their transit before importing them.`,
        );
      }
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
              no: sql`excluded.no`,
              complete: sql`excluded.complete`,
              place: sql`excluded.place`,
              area: sql`excluded.area`,
              rack: sql`excluded.rack`,
              position: sql`excluded.position`,
              slot: sql`excluded.slot`,
              dateIn: sql`excluded.date_in`,
              timeIn: sql`excluded.time_in`,
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
      .where(and(eq(blueFileRecordsTable.id, params.data.id), ne(blueFileRecordsTable.status, "in_transit")))
      .returning();
    if (!updated) {
      await sendNotFoundOrInTransit(res, params.data.id, "Complete the transit before editing this file.");
      return;
    }
    res.json(UpdateBlueFileResponse.parse(await serializeWithLoan(updated)));
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
    const [updated] = await db
      .update(blueFileRecordsTable)
      .set({
        place: location.place,
        area: location.area,
        rack: location.rack,
        position: location.position,
        slot: location.slot,
      })
      .where(and(eq(blueFileRecordsTable.id, params.data.id), ne(blueFileRecordsTable.status, "in_transit")))
      .returning();
    if (!updated) {
      await sendNotFoundOrInTransit(res, params.data.id, "Complete the transit before moving this file.");
      return;
    }
    res.json(MoveBlueFileResponse.parse(await serializeWithLoan(updated)));
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
  // A borrowed file must be returned first so the loan history stays accurate.
  const [deleted] = await db
    .delete(blueFileRecordsTable)
    .where(
      and(
        eq(blueFileRecordsTable.id, params.data.id),
        ne(blueFileRecordsTable.status, "borrowed"),
      ),
    )
    .returning({ id: blueFileRecordsTable.id });
  if (!deleted) {
    const [existing] = await db
      .select({ id: blueFileRecordsTable.id })
      .from(blueFileRecordsTable)
      .where(eq(blueFileRecordsTable.id, params.data.id));
    if (existing) {
      sendConflict(res, "This blue file is borrowed. Return it before removing it.");
      return;
    }
    res.status(404).json(errorBody("Record not found."));
    return;
  }
  res.sendStatus(204);
});

// --- Custody: Transit workflow, borrowing and returning ---------------------

router.post("/blue-file-records/:id/transit", async (req, res): Promise<void> => {
  const params = StartBlueFileTransitParams.safeParse(req.params);
  const body = StartBlueFileTransitBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json(errorBody("Destination and the name of who is moving the file are required."));
    return;
  }
  const by = body.data.transit_by.trim();
  if (!by) {
    res.status(400).json(errorBody("Enter who is moving the file to Transit."));
    return;
  }

  try {
    const record = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(blueFileRecordsTable)
        .where(eq(blueFileRecordsTable.id, params.data.id))
        .for("update");
      if (!existing) throw new HttpError(404, "Record not found.");
      if (existing.status === "borrowed") {
        throw new HttpError(409, "This blue file is borrowed. Return it before moving it to Transit.");
      }
      if (existing.status === "in_transit") {
        throw new HttpError(409, "This blue file is already in Transit.");
      }
      return enterTransit(tx, existing, {
        destination: body.data.destination_place,
        by,
        at: new Date(),
        remarks: body.data.remarks?.trim() || null,
      });
    });
    res.json(StartBlueFileTransitResponse.parse(serializeRecord(record)));
  } catch (error) {
    if (sendHttpError(res, error)) return;
    throw error;
  }
});

router.post("/blue-file-records/:id/transit/complete", async (req, res): Promise<void> => {
  const params = CompleteBlueFileTransitParams.safeParse(req.params);
  const body = CompleteBlueFileTransitBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json(errorBody("Enter who received the file."));
    return;
  }
  const receivedBy = body.data.received_by.trim();
  if (!receivedBy) {
    res.status(400).json(errorBody("Enter who received the file."));
    return;
  }
  const receivedAt = resolveTimestamp(body.data.received_at);
  if (!receivedAt) {
    res.status(400).json(errorBody("Received date is invalid or in the future."));
    return;
  }

  try {
    const record = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(blueFileRecordsTable)
        .where(eq(blueFileRecordsTable.id, params.data.id))
        .for("update");
      if (!existing) throw new HttpError(404, "Record not found.");
      if (existing.status !== "in_transit") {
        throw new HttpError(409, "This blue file is not in Transit.");
      }
      if (existing.transitAt && receivedAt.getTime() < existing.transitAt.getTime()) {
        throw new HttpError(400, "The received date cannot be before the transit date.");
      }

      const destination = requireDestination(
        body.data.destination_place?.trim() || existing.destinationPlace,
      );
      await assertPlaceFree(tx, destination.place, existing.id);

      const [updated] = await tx
        .update(blueFileRecordsTable)
        .set({
          place: destination.place,
          area: destination.area,
          rack: destination.rack,
          position: destination.position,
          slot: destination.slot,
          destinationPlace: destination.place,
          status: "available",
          receivedAt,
          receivedBy,
        })
        .where(eq(blueFileRecordsTable.id, existing.id))
        .returning();
      await tx.insert(blueFileAuditLogTable).values({
        recordId: existing.id,
        wo: existing.wo,
        no: existing.no,
        eventType: "delivered_from_transit",
        sourcePlace: TRANSIT_PLACE,
        destinationPlace: destination.place,
        performedBy: receivedBy,
        remarks: body.data.remarks?.trim() || null,
        occurredAt: receivedAt,
      });
      return updated;
    });
    res.json(CompleteBlueFileTransitResponse.parse(serializeRecord(record)));
  } catch (error) {
    if (sendHttpError(res, error)) return;
    throw error;
  }
});

router.get("/blue-file-audit-log", async (_req, res): Promise<void> => {
  const entries = await db
    .select()
    .from(blueFileAuditLogTable)
    .orderBy(desc(blueFileAuditLogTable.occurredAt))
    .limit(1000);
  res.json(
    ListBlueFileAuditLogResponse.parse(
      entries.map((entry) => ({
        id: entry.id,
        record_id: entry.recordId,
        no: entry.no,
        wo: entry.wo,
        event_type: entry.eventType as "moved_to_transit" | "delivered_from_transit",
        source_place: entry.sourcePlace,
        destination_place: entry.destinationPlace,
        performed_by: entry.performedBy,
        remarks: entry.remarks,
        occurred_at: entry.occurredAt.toISOString(),
      })),
    ),
  );
});

router.post("/blue-file-records/:id/borrow", async (req, res): Promise<void> => {
  const params = BorrowBlueFileParams.safeParse(req.params);
  const body = BorrowBlueFileBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json(errorBody("Borrower name is required."));
    return;
  }
  const borrowerName = body.data.borrower_name.trim();
  if (!borrowerName) {
    res.status(400).json(errorBody("Borrower name is required."));
    return;
  }
  const borrowedAt = resolveTimestamp(body.data.borrowed_at);
  if (!borrowedAt) {
    res.status(400).json(errorBody("Borrow date is invalid or in the future."));
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      // The status check inside the UPDATE makes borrowing race-safe: only one
      // request can flip a file to "borrowed".
      const [record] = await tx
        .update(blueFileRecordsTable)
        .set({ status: "borrowed" })
        .where(
          and(
            eq(blueFileRecordsTable.id, params.data.id),
            eq(blueFileRecordsTable.status, "available"),
          ),
        )
        .returning();
      if (!record) return null;
      const [loan] = await tx
        .insert(blueFileLoansTable)
        .values({
          recordId: record.id,
          wo: record.wo,
          no: record.no,
          place: record.place,
          borrowerName,
          borrowedAt,
          borrowRemarks: body.data.remarks?.trim() || null,
        })
        .returning();
      return { record, loan };
    });

    if (!result) {
      const [existing] = await db
        .select({ status: blueFileRecordsTable.status })
        .from(blueFileRecordsTable)
        .where(eq(blueFileRecordsTable.id, params.data.id));
      if (!existing) res.status(404).json(errorBody("Record not found."));
      else if (existing.status === "in_transit") sendConflict(res, "This blue file is in Transit. Complete the transit before borrowing it.");
      else sendConflict(res, "This blue file is already borrowed.");
      return;
    }
    res.json(BorrowBlueFileResponse.parse(serializeRecord(result.record, result.loan)));
  } catch (error) {
    if (isUniqueViolation(error)) {
      sendConflict(res, "This blue file is already borrowed.");
      return;
    }
    throw error;
  }
});

router.post("/blue-file-records/:id/return", async (req, res): Promise<void> => {
  const params = ReturnBlueFileParams.safeParse(req.params);
  const body = ReturnBlueFileBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json(errorBody("Invalid request."));
    return;
  }
  const returnedAt = resolveTimestamp(body.data.returned_at);
  if (!returnedAt) {
    res.status(400).json(errorBody("Return date is invalid or in the future."));
    return;
  }

  try {
    const record = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(blueFileRecordsTable)
        .where(eq(blueFileRecordsTable.id, params.data.id))
        .for("update");
      if (!existing) throw new HttpError(404, "Record not found.");

      const [loan] = await tx
        .select()
        .from(blueFileLoansTable)
        .where(
          and(
            eq(blueFileLoansTable.recordId, existing.id),
            isNull(blueFileLoansTable.returnedAt),
          ),
        );
      if (existing.status !== "borrowed" || !loan) {
        throw new HttpError(409, "This blue file is not currently borrowed.");
      }
      if (returnedAt.getTime() < loan.borrowedAt.getTime()) {
        throw new HttpError(400, "The return date cannot be before the borrow date.");
      }

      await tx
        .update(blueFileLoansTable)
        .set({
          returnedAt,
          returnedTo: body.data.return_to,
          returnRemarks: body.data.remarks?.trim() || null,
        })
        .where(eq(blueFileLoansTable.id, loan.id));
      if (body.data.return_to === "in_transit") {
        const by = body.data.transit_by?.trim();
        if (!by) throw new HttpError(400, "Enter who is moving the file to Transit.");
        return enterTransit(tx, existing, {
          destination: body.data.destination_place?.trim() || existing.place,
          by,
          at: returnedAt,
          remarks: null,
        });
      }
      const [updated] = await tx
        .update(blueFileRecordsTable)
        .set({ status: "available" })
        .where(eq(blueFileRecordsTable.id, existing.id))
        .returning();
      return updated;
    });
    res.json(ReturnBlueFileResponse.parse(serializeRecord(record)));
  } catch (error) {
    if (sendHttpError(res, error)) return;
    throw error;
  }
});

router.get("/blue-file-loans", async (_req, res): Promise<void> => {
  const loans = await db
    .select()
    .from(blueFileLoansTable)
    .orderBy(desc(blueFileLoansTable.borrowedAt));
  const now = new Date();
  res.json(ListBlueFileLoansResponse.parse(loans.map((loan) => serializeLoan(loan, now))));
});

export default router;