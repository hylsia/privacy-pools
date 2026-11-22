import type { RequestHandler } from "express";

/** Custom RPC/relayer selection permits HTTPS endpoints; localhost HTTP is for explicitly selected local nodes. */
export function securityHeaders(production: boolean): RequestHandler {
  return (_req, res, next) => {
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()"
    );
    if (production)
      res.setHeader(
        "Content-Security-Policy",
        [
          "default-src 'self'",
          "script-src 'self' 'wasm-unsafe-eval'",
          "worker-src 'self' blob:",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com data:",
          "img-src 'self' data: https:",
          "connect-src 'self' https: http://localhost:* http://127.0.0.1:* http://[::1]:*",
          "object-src 'none'",
          "base-uri 'self'",
          "frame-ancestors 'none'",
          "form-action 'self'",
        ].join("; ")
      );
    next();
  };
}
