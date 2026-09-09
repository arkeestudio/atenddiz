import { getRequest } from "@tanstack/react-start/server";

export function getRequestInstance(): Request {
  return getRequest();
}

export function getRequestOrigin(): string {
  try {
    const req = getRequest();
    if (!req?.url) return "";
    const u = new URL(req.url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

export function getHeaderFromRequest(name: string): string | null {
  try {
    const req = getRequest();
    return req?.headers?.get(name) ?? null;
  } catch {
    return null;
  }
}
