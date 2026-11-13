import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/security";

/** fetch wrapper for mutating calls: echoes the CSRF cookie in a header. */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${CSRF_COOKIE}=`))
    ?.split("=")[1];
  const headers = new Headers(init.headers);
  if (token) headers.set(CSRF_HEADER, token);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(input, { ...init, headers, credentials: "same-origin" });
}
