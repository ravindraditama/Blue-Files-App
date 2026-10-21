export type Position = 'L' | 'M' | 'R';

/** A rack place such as A16R-001. */
export type Place = { place: string; area: string; rack: number; position: Position; slot: number };

/** The system place used for every file in transit. It is not a rack slot. */
export const TRANSIT_PLACE = 'TRANSIT';

export const POSITIONS = ['L', 'M', 'R'] as const;

export function parsePlace(value: string): Place | null {
  const match = value.trim().toUpperCase().replace(/\s+/g, '').match(/^([A-Z]+)(\d+)([LMR])-(\d+)$/);
  if (!match) return null;
  const area = match[1];
  const rack = Number(match[2]);
  const slot = Number(match[4]);
  if (rack < 1 || slot < 1 || !Number.isSafeInteger(rack) || !Number.isSafeInteger(slot)) return null;
  return {
    area,
    rack,
    position: match[3] as Position,
    slot,
    place: `${area}${String(rack).padStart(2, '0')}${match[3]}-${String(slot).padStart(3, '0')}`,
  };
}
