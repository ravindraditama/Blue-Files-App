import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

// ponytail: in-memory, per-process failed-attempt limiter keyed by client IP
// (X-Forwarded-For is spoofable; fine for an internal LAN). Upgrade: real rate limiter.
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; resetAt: number }>();

const digest = (value: string) => createHash("sha256").update(value).digest();

function clientKey(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || req.ip || "unknown";
}

// Admin password comes from ADMIN_PASSWORD (api-server/.env), sent as "Authorization: Bearer <password>".
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env["ADMIN_PASSWORD"];
  if (!expected) {
    res.status(503).json({ error: "Admin password is not configured." });
    return;
  }

  const key = clientKey(req);
  const now = Date.now();
  const entry = failures.get(key);
  const active = entry && entry.resetAt > now ? entry : undefined;
  if (active && active.count >= MAX_FAILURES) {
    res.status(429).json({ error: "Too many failed attempts. Try again later." });
    return;
  }

  const supplied = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (timingSafeEqual(digest(supplied), digest(expected))) {
    failures.delete(key);
    next();
    return;
  }

  failures.set(key, { count: (active?.count ?? 0) + 1, resetAt: active?.resetAt ?? now + WINDOW_MS });
  res.status(401).json({ error: "Admin password required." });
}
