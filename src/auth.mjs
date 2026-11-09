import { createHash, createHmac, timingSafeEqual } from "node:crypto";

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

function signingKey() {
  if (!passwordConfigured()) return null;
  return createHash("sha256").update(`shaw-gardens-session:${process.env.MAINTENANCE_PASSWORD}`, "utf8").digest();
}

export function sealSession() {
  const key = signingKey();
  if (!key) return null;
  const body = String(Date.now() + FOURTEEN_DAYS);
  const mac = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function sessionValid(token) {
  const key = signingKey();
  if (!key || !token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac("sha256", key).update(body).digest("base64url");
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return false;
  const exp = Number(body);
  return Number.isFinite(exp) && Date.now() < exp;
}

export function readSession(req) {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return sessionValid(decodeURIComponent(rest.join("=")));
  }
  return false;
}

export function sessionCookie(token, req) {
  const secure = req.headers["x-forwarded-proto"] === "https";
  const bits = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${Math.floor(FOURTEEN_DAYS / 1000)}`,
  ];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

export function clearCookie(req) {
  const secure = req.headers["x-forwarded-proto"] === "https";
  const bits = [`${COOKIE}=`, "HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=0"];
  if (secure) bits.push("Secure");
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

export function loginAllowed(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.reset < now) return true;
  return entry.count < 8;
}

export function loginFailed(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.reset < now) {
    attempts.set(ip, { count: 1, reset: now + 15 * 60 * 1000 });
    return;
  }
  entry.count += 1;
}
