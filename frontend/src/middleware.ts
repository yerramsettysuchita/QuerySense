import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_ROUTES = ["/", "/login", "/onboarding"];
const AUTH_ROUTES = ["/login"];

export function middleware(request: NextRequest) {
  const token = request.cookies.get("qs_token")?.value
    ?? request.headers.get("authorization")?.replace("Bearer ", "");

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_ROUTES.some((r) => path === r || path.startsWith(r + "/"));
  const isAuthRoute = AUTH_ROUTES.includes(path);

  // Authenticated user hitting login → send to dashboard
  if (isAuthRoute && token) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Unauthenticated user hitting protected route → send to login
  if (!isPublic && !token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.png|.*\\.svg).*)",
  ],
};
