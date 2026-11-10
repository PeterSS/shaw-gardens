import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "./db.mjs";

const COOKIE = "sg_session";
const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;

export function passwordConfigured() {
  return (process.env.MAINTENANCE_PASSWORD ?? "").length > 0;
}

export function passwordMatches(given) {
  const expected = process.env.MAINTENANCE_PASSWORD ?? "";
  const left = createHash("sha256").update(String(given), "utf8").digest();
  const right = createHash("sha256").update(expected, "utf8").digest();
  return expected.length > 0 && timingSafeEqual(left, right);
}

const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;

function sessionId(req) {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== COOKIE) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      return "";
    }
  }
  return "";
}

export async function createSession() {
  const id = randomBytes(32).toString("base64url");
  await sql("delete from sessions where expires_at <= now()");
  await sql(
    "insert into sessions (id, expires_at) values ($1, now() + interval '14 days')",
    [id],
  );
  return id;
}

export async function readSession(req) {
  const id = sessionId(req);
  if (!SESSION_ID.test(id)) return false;
  const rows = await sql("select id from sessions where id = $1 and expires_at > now()", [id]);
  return rows.length === 1;
}

export async function endSession(req) {
  const id = sessionId(req);
  if (!SESSION_ID.test(id)) return;
  await sql("delete from sessions where id = $1", [id]);
}

function cookieFlags(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (proto === "https") return ["SameSite=None", "Secure"];
  return ["SameSite=Lax"];
}

export function sessionCookie(token, req) {
  const bits = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    ...cookieFlags(req),
    "Path=/",
    `Max-Age=${Math.floor(FOURTEEN_DAYS / 1000)}`,
  ];
  return bits.join("; ");
}

export function clearCookie(req) {
  const bits = [`${COOKIE}=`, "HttpOnly", ...cookieFlags(req), "Path=/", "Max-Age=0"];
  return bits.join("; ");
}

function firstHeader(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw ?? "").split(",")[0].trim();
}

function hostIdentity(value) {
  const raw = firstHeader(value);
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).host.toLowerCase();
  } catch {
    return "";
  }
}

function originHost(value) {
  if (!value) return "";
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return "";
  }
}

export function sameOrigin(req) {
  const site = firstHeader(req.headers["sec-fetch-site"]).toLowerCase();
  if (site === "same-origin") return true;
  if (site === "cross-site" || site === "same-site") return false;

  const expected = originHost(req.headers.origin || req.headers.referer);
  if (!expected) return false;
  const candidates = [hostIdentity(req.headers.host), hostIdentity(req.headers["x-forwarded-host"])];
  return candidates.some((host) => host !== "" && host === expected);
}

const attempts = new Map();

function privatePeer(address) {
  const addr = String(address || "").replace(/^::ffff:/i, "").toLowerCase();
  if (addr === "127.0.0.1" || addr === "::1") return true;
  if (addr.startsWith("10.") || addr.startsWith("192.168.") || addr.startsWith("169.254.")) return true;
  const octets = addr.match(/^172\.(\d+)\./);
  if (octets) {
    const second = Number(octets[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return addr.startsWith("fc") || addr.startsWith("fd") || addr.startsWith("fe80:");
}

export function visitorKey(req) {
  const socket = String(req.socket?.remoteAddress || "unknown");
  if (!privatePeer(socket)) return `peer:${socket}`;
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded.join(",") : String(forwarded ?? "");
  const hops = raw.split(",").map((part) => part.trim()).filter(Boolean);
  const client = hops.length ? hops[hops.length - 1] : "";
  const bareSocket = socket.replace(/^::ffff:/i, "");
  if (!client || client === socket || client === bareSocket) return `peer:${socket}`;
  return `client:${client}`;
}

export function loginAllowed(key) {
  const now = Date.now();
  const entry = attempts.get(key || "peer:unknown");
  if (!entry || entry.reset < now) return true;
  return entry.count < 8;
}

export function loginFailed(key) {
  const now = Date.now();
  const name = key || "peer:unknown";
  const entry = attempts.get(name);
  if (!entry || entry.reset < now) {
    attempts.set(name, { count: 1, reset: now + 15 * 60 * 1000 });
    return;
  }
  entry.count += 1;
}
