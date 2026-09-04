// Turning a node's `out_path` into repeater names.
//
// MeshCore records each hop as the leading byte(s) of that repeater's public
// key, so a hop is a prefix of a contact rather than an identifier. One byte has
// 256 values against the hundreds of contacts a busy mesh carries, which makes
// a naive lookup ambiguous roughly three times out of three.
//
// What resolves it is the node's own neighbour list: a repeater the node has
// heard directly is a far smaller set than every contact on the hub. Crucially
// neighbours only ever *narrow* a candidate set the contact pass already
// produced — they never supply a name of their own — so a coincidental prefix
// collision cannot invent an answer, only fail to remove one.
import type { DiscoveredContact } from "./discovery.js";

/** How many candidate names an ambiguous hop lists before eliding the rest. */
const MAX_LISTED_CANDIDATES = 3;

export type RouteHop =
  | { token: string; kind: "resolved"; name: string; entityId: string | null }
  | { token: string; kind: "ambiguous"; candidates: string[]; total: number }
  | { token: string; kind: "unknown" };

/** Contacts whose public key begins with this hop's token.
 *
 *  A prefix test, never a substring one: `ff28aa` contains `28` but is not
 *  reached through it. */
function candidatesFor(
  token: string,
  contacts: readonly DiscoveredContact[]
): DiscoveredContact[] {
  return contacts.filter(
    (contact) =>
      contact.publicKey.length >= token.length &&
      contact.publicKey.slice(0, token.length) === token
  );
}

/** Resolve each hop of a path to a repeater name where the evidence allows it.
 *
 *  `tokens` come from `splitRoutePath`, so they are uppercase hex. `neighborIds`
 *  are lowercase entity-ID fragments and are uppercased here — comparing the two
 *  raw would silently match nothing, which looks exactly like a mesh that has no
 *  ambiguous hops.
 *
 *  Neighbours are consulted only for terminal hops. `out_path` ordering
 *  (hub-first or node-first) is not established, so the hop adjacent to this
 *  node is at one end or the other; treating both ends as terminal is
 *  direction-agnostic. An interior hop is adjacent to some other node, where
 *  this node's neighbours say nothing, so it stays ambiguous rather than being
 *  narrowed on a coincidence. */
export function resolveRouteHops(
  tokens: readonly string[],
  contacts: readonly DiscoveredContact[],
  neighborIds: readonly string[]
): RouteHop[] {
  const neighbors = new Set(neighborIds.map((id) => id.toUpperCase()));
  const lastIndex = tokens.length - 1;
  return tokens.map((token, index) => {
    const candidates = candidatesFor(token, contacts);

    if (candidates.length === 1) {
      const contact = candidates[0]!;
      return {
        token,
        kind: "resolved",
        name: contact.name,
        entityId: contact.entityId,
      };
    }

    if (candidates.length > 1 && (index === 0 || index === lastIndex)) {
      const adjacent = candidates.filter((contact) =>
        [...neighbors].some(
          (neighbor) =>
            neighbor.startsWith(contact.publicKey) ||
            contact.publicKey.startsWith(neighbor)
        )
      );
      if (adjacent.length === 1) {
        const contact = adjacent[0]!;
        return {
          token,
          kind: "resolved",
          name: contact.name,
          entityId: contact.entityId,
        };
      }
    }

    if (candidates.length > 1) {
      return {
        token,
        kind: "ambiguous",
        candidates: candidates
          .slice(0, MAX_LISTED_CANDIDATES)
          .map((contact) => contact.name),
        total: candidates.length,
      };
    }

    return { token, kind: "unknown" };
  });
}
