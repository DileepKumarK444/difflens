import { NextResponse, type NextRequest } from "next/server";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  isAllowedHost,
  isAllowedOrigin,
  cspHeader,
  isValidCsrf,
  newCsrfToken,
} from "@/lib/security";

function deny(status: number, reason: string) {
  return new NextResponse(JSON.stringify({ error: reason }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function proxy(req: NextRequest) {
  const host = req.headers.get("host");
  if (!isAllowedHost(host)) return deny(403, "Host not allowed");
  if (!isAllowedOrigin(req.method, req.headers.get("origin"), host)) {
    return deny(403, "Cross-origin request rejected");
  }
  const cookie = req.cookies.get(CSRF_COOKIE)?.value;
  if (!isValidCsrf(req.method, cookie, req.headers.get(CSRF_HEADER))) {
    return deny(403, "Invalid CSRF token");
  }

  const res = NextResponse.next();
  if (!cookie) {
    res.cookies.set(CSRF_COOKIE, newCsrfToken(), {
      sameSite: "strict",
      path: "/",
      httpOnly: false, // the page must read it to echo it in the header
      secure: false, // plain http on loopback
    });
  }
  res.headers.set("Content-Security-Policy", cspHeader(process.env.NODE_ENV !== "production"));
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
