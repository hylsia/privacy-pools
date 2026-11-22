import { Redirect } from "wouter";

/**
 * /privacy was the standalone vault page. The vault now lives in the Pools
 * dashboard at /pools/vault; old links keep working through this redirect,
 * which replaces the history entry and keeps the query string and hash.
 */
export default function Privacy() {
  const { search, hash } = window.location;
  return <Redirect to={`/pools/vault${search}${hash}`} replace />;
}
