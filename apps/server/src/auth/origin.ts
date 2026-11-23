/** Which origin the server is reached at. Behind a proxy that terminates TLS the server itself
 * sees plain HTTP, so the public origin is configured (PUBLIC_ORIGIN); without it, each
 * request's own origin (its Host header) is used. */
export interface OriginPolicy {
  /** False for a request made by a page on another site (browsers always send Origin then). */
  same(origin: string | null | undefined, requestOrigin: string): boolean;
  /** Whether cookies are marked Secure. */
  secure(requestOrigin: string): boolean;
}

export function originPolicy(publicOrigin: string | null): OriginPolicy {
  const own = (requestOrigin: string) => publicOrigin ?? requestOrigin;
  return {
    same: (origin, requestOrigin) => !origin || origin === own(requestOrigin),
    secure: (requestOrigin) => own(requestOrigin).startsWith('https:'),
  };
}
