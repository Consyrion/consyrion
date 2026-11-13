"use server";

import { createAuthorizationCode, resolveActor, type ActorContext } from "@consyrium/db";
import { requireActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";
import { readAuthorizeRequest, redirectWith } from "@/lib/server/oauth";
import { rateLimit } from "@/lib/server/rate-limit";

export interface ConsentState {
  /** Where the browser goes next: the client's registered redirect URI with `code` or `error=access_denied`. */
  redirectTo: string | null;
  error: "invalid" | "session" | "failed" | null;
}

/**
 * Allow or deny on the consent page (`/oauth/authorize`). A server action: Next.js refuses it unless the request comes
 * from this origin, so another site cannot press "Allow" with the visitor's session. Nothing from the form is trusted –
 * the authorization request is validated again exactly like on the page, the session is read again (a session, never
 * an API token), and the workspace must be one the user is a member of. The redirect target is always the URI the
 * client registered, never a value from the form.
 */
export async function decideAuthorization(_previous: ConsentState, formData: FormData): Promise<ConsentState> {
  const field = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const db = await getDb();
  // The same parameters the page validated, as one query string; a repeated parameter stays a list and is refused.
  const query = new URLSearchParams(field("query"));
  const params: Record<string, string | string[]> = {};
  for (const key of new Set(query.keys())) {
    const values = query.getAll(key);
    params[key] = values.length > 1 ? values : values[0]!;
  }
  const parsed = await readAuthorizeRequest(db, params);
  if (!parsed.ok) return { redirectTo: null, error: "invalid" };
  const { client, redirectUri, codeChallenge, state, tokenScope } = parsed.request;

  let actor: ActorContext;
  try {
    const signedIn = await requireActor({ sessionOnly: true });
    // The workspace that was shown on the page; membership is checked again.
    actor = await resolveActor(db, signedIn.userId, field("organization_id"));
  } catch {
    return { redirectTo: null, error: "session" };
  }

  const decision = field("decision");
  if (decision === "deny") return { redirectTo: redirectWith(redirectUri, { error: "access_denied" }, state), error: null };
  if (decision !== "allow") return { redirectTo: null, error: "invalid" };
  try {
    rateLimit(`oauth-authorize:${actor.userId}`, 20, 60_000);
    const { code } = await createAuthorizationCode(db, actor, { clientId: client.clientId, redirectUri, codeChallenge, scope: tokenScope });
    return { redirectTo: redirectWith(redirectUri, { code }, state), error: null };
  } catch {
    return { redirectTo: null, error: "failed" };
  }
}
