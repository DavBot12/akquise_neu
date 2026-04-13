import { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { user_sessions } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../storage";

/**
 * Authenticated user attached to request by auth middleware
 */
export interface AuthenticatedUser {
  id: number;
  username: string;
  is_admin: boolean;
  sessionId: number;
}

// Extend Express Request to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Middleware: Requires a valid session (x-session-id header).
 * Rejects with 401 if no valid session is found.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sessionId = req.headers["x-session-id"];

    if (!sessionId) {
      res.status(401).json({ error: "Nicht authentifiziert" });
      return;
    }

    const parsedId = parseInt(sessionId as string);
    if (isNaN(parsedId)) {
      res.status(401).json({ error: "Ungueltige Session" });
      return;
    }

    // Validate session exists and is active
    const [session] = await db
      .select()
      .from(user_sessions)
      .where(eq(user_sessions.id, parsedId));

    if (!session || session.logout_time) {
      res.status(401).json({ error: "Session abgelaufen" });
      return;
    }

    // Get user data
    const user = await storage.getUser(session.user_id);
    if (!user) {
      res.status(401).json({ error: "Benutzer nicht gefunden" });
      return;
    }

    // Check if user is approved (admins are always approved)
    if (!user.is_approved && !user.is_admin) {
      res.status(403).json({ error: "Account wartet auf Freigabe" });
      return;
    }

    // Attach user to request
    req.user = {
      id: user.id,
      username: user.username,
      is_admin: user.is_admin || false,
      sessionId: session.id,
    };

    next();
  } catch (error) {
    console.error("[AUTH] Middleware error:", error);
    res.status(500).json({ error: "Authentifizierungsfehler" });
  }
}

/**
 * Middleware: Requires admin privileges.
 * Must be used AFTER requireAuth.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Nicht authentifiziert" });
    return;
  }

  if (!req.user.is_admin) {
    res.status(403).json({ error: "Keine Admin-Berechtigung" });
    return;
  }

  next();
}
