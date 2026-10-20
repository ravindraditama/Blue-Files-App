import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, blueFileRecordsTable, blueFileLoansTable } from "@workspace/db";
import { readAccess, requireAdmin } from "../middlewares/admin";
import {
  BlueFileRecordInput,
  BorrowBlueFileBody,
  BorrowBlueFileParams,
  BorrowBlueFileResponse,
  CreateBlueFileBody,
  CreateBlueFileResponse,
  DeleteBlueFileParams,
  GetBlueFilesSummaryResponse,
  ImportBlueFilesBody,
  ImportBlueFilesResponse,
  ListBlueFileLoansResponse,
  ListBlueFilesResponse,
  MoveBlueFileBody,
  MoveBlueFileParams,
  MoveBlueFileResponse,
  ReturnBlueFileBody,
  ReturnBlueFileParams,
  ReturnBlueFileResponse,
  SetBlueFileStatusBody,
  SetBlueFileStatusParams,
  SetBlueFileStatusResponse,
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
  if (record.status === "in_transit") return "Transit Area";
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
    position: record.position,
    slot: record.slot,
    date_in: record.dateIn,
    time_in: record.timeIn,
    pic: record.pic,
    status: record.status as "available" | "borrowed" | "in_transit",
    current_location: currentLocation(record, openLoan),
    borrower_name: openLoan?.borrowerName ?? null,
    borrowed_at: openLoan?.borrowedAt ?? null,
    borrow_remarks: openLoan?.borrowRemarks ?? null,
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

/** Parses an optional ISO timestamp. Returns null when invalid or in the future. */
function resolveTimestamp(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // Allow a few minutes of clock skew between browser and server.
  if (date.getTime() > Date.now() + 5 * 60 * 1000) return null;
  return date;
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

router.get("/blue-file-records", readAccess, async (_req, res): Promise<void> => {
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

router.get("/blue-file-records/summary", readAccess, async (_req, res): Promise<void> => {
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
      total_files: records.length,
      available_files: records.length - borrowedFiles - inTransitFiles,
      borrowed_files: borrowedFiles,
      in_transit_files: inTransitFiles,
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

router.patch("/blue-file-records/:id", requireAdmin, async (req, res): Promise<void> => {
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
    res.json(UpdateBlueFileResponse.parse(await serializeWithLoan(updated)));
  } catch (error) {
    if (isUniqueViolation(error)) {
      sendConflict(res, "That work order or storage place is already in use.");
      return;
    }
    throw error;
  }
});

router.patch("/blue-file-records/:id/move", requireAdmin, async (req, res): Promise<void> => {
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
    const current = await findRecord(params.data.id);
    if (current?.status === "borrowed") {
      // documented rule: a borrowed file must be returned before it can be moved
      sendConflict(res, "This blue file is borrowed. Return it before moving it.");
      return;
    }
    await db
      .update(blueFileRecordsTable)
      .set({
        place: location.place,
        area: location.area,
        rack: location.rack,
        position: location.position,
        slot: location.slot,
      })
      .where(
        and(
          eq(blueFileRecordsTable.id, params.data.id),
          ne(blueFileRecordsTable.status, "borrowed"),
        ),
      );
    const updated = await findRecord(params.data.id);
    if (!updated) {
      res.status(404).json(errorBody("Record not found."));
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

router.delete("/blue-file-records/:id", requireAdmin, async (req, res): Promise<void> => {
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
    );
  if (deleted.affectedRows === 0) {
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

// --- Custody: Transit Area, borrowing and returning -------------------------

router.post("/blue-file-records/:id/status", requireAdmin, async (req, res): Promise<void> => {
  const params = SetBlueFileStatusParams.safeParse(req.params);
  const body = SetBlueFileStatusBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json(errorBody("Invalid request."));
    return;
  }

  // MySQL: no RETURNING, and UPDATE reports 0 rows when nothing changed, so look the row up instead of counting.
  const existing = await findRecord(params.data.id);
  if (!existing) {
    res.status(404).json(errorBody("Record not found."));
    return;
  }
  if (existing.status === "borrowed") {
    sendConflict(res, "This blue file is borrowed. Use Return to bring it back first.");
    return;
  }
  await db
    .update(blueFileRecordsTable)
    .set({ status: body.data.status })
    .where(
      and(
        eq(blueFileRecordsTable.id, params.data.id),
        ne(blueFileRecordsTable.status, "borrowed"),
      ),
    );
  const updated = await findRecord(params.data.id);
  if (!updated || updated.status !== body.data.status) {
    // raced with a borrow between the check and the update
    sendConflict(res, "This blue file is borrowed. Use Return to bring it back first.");
    return;
  }
  res.json(SetBlueFileStatusResponse.parse(serializeRecord(updated)));
});

router.post("/blue-file-records/:id/borrow", requireAdmin, async (req, res): Promise<void> => {
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
    type BorrowOutcome =
      | { kind: "missing" }
      | { kind: "already" }
      | { kind: "ok"; record: RecordRow; loan: LoanRow };
    const result = await db.transaction(async (tx): Promise<BorrowOutcome> => {
      // FOR UPDATE row lock: concurrent borrows of the same file queue up, so only one can win.
      const [rec] = await tx
        .select()
        .from(blueFileRecordsTable)
        .where(eq(blueFileRecordsTable.id, params.data.id))
        .for("update");
      if (!rec) return { kind: "missing" };
      if (rec.status === "borrowed") return { kind: "already" };
      const loanId = randomUUID();
      await tx.insert(blueFileLoansTable).values({
        id: loanId,
        recordId: rec.id,
        wo: rec.wo,
        no: rec.no,
        place: rec.place,
        borrowerName,
        borrowedAt,
        borrowRemarks: body.data.remarks?.trim() || null,
      });
      await tx
        .update(blueFileRecordsTable)
        .set({ status: "borrowed" })
        .where(eq(blueFileRecordsTable.id, rec.id));
      const [record] = await tx
        .select()
        .from(blueFileRecordsTable)
        .where(eq(blueFileRecordsTable.id, rec.id));
      const [loan] = await tx
        .select()
        .from(blueFileLoansTable)
        .where(eq(blueFileLoansTable.id, loanId));
      return { kind: "ok", record: record!, loan: loan! };
    });

    if (result.kind === "missing") {
      res.status(404).json(errorBody("Record not found."));
      return;
    }
    if (result.kind === "already") {
      sendConflict(res, "This blue file is already borrowed.");
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

class ReturnError extends Error {
  constructor(
    readonly statusCode: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

router.post("/blue-file-records/:id/return", requireAdmin, async (req, res): Promise<void> => {
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
      if (!existing) throw new ReturnError(404, "Record not found.");

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
        throw new ReturnError(409, "This blue file is not currently borrowed.");
      }
      if (returnedAt.getTime() < loan.borrowedAt.getTime()) {
        throw new ReturnError(400, "The return date cannot be before the borrow date.");
      }

      await tx
        .update(blueFileLoansTable)
        .set({
          returnedAt,
          returnedTo: body.data.return_to,
          returnRemarks: body.data.remarks?.trim() || null,
        })
        .where(eq(blueFileLoansTable.id, loan.id));
      await tx
        .update(blueFileRecordsTable)
        .set({ status: body.data.return_to })
        .where(eq(blueFileRecordsTable.id, existing.id));
      const [updated] = await tx
        .select()
        .from(blueFileRecordsTable)
        .where(eq(blueFileRecordsTable.id, existing.id));
      return updated;
    });
    res.json(ReturnBlueFileResponse.parse(serializeRecord(record)));
  } catch (error) {
    if (error instanceof ReturnError) {
      res.status(error.statusCode).json(errorBody(error.message));
      return;
    }
    throw error;
  }
});

router.get("/blue-file-loans", readAccess, async (_req, res): Promise<void> => {
  const loans = await db
    .select()
    .from(blueFileLoansTable)
    .orderBy(desc(blueFileLoansTable.borrowedAt));
  const now = new Date();
  res.json(ListBlueFileLoansResponse.parse(loans.map((loan) => serializeLoan(loan, now))));
});

export default router;