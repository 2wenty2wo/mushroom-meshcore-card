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
import { escapeHtml } from "./helpers.js";
import type { LocalizeFunc } from "./localize.js";

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

/** Styles for the hop list, shared by the card body and the dialog.
 *
 *  Mirrors the `neighbors.ts` arrangement: the renderer and its styles travel
 *  together so a second surface cannot render the markup unstyled. Two columns,
 *  name first — on a node card the hex is a reference, the name is the point. */
export const ROUTE_STYLES = `
  .route-hops {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: route-hop;
  }
  .route-hop {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr) max-content;
    align-items: baseline;
    gap: 8px;
    counter-increment: route-hop;
  }
  .route-hop::before {
    content: counter(route-hop) ".";
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-variant-numeric: tabular-nums;
  }
  .route-hop-name {
    min-width: 0;
    overflow-wrap: anywhere;
    text-align: left;
  }
  .route-hop-hash {
    direction: ltr;
    unicode-bidi: isolate;
    color: var(--secondary-text-color, #727272);
    font-family: var(--code-font-family, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-variant-numeric: tabular-nums;
  }
  .route-hop-unresolved {
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
  }
  .route-hop-candidates {
    grid-column: 2 / -1;
    margin: 2px 0 0;
    padding-inline-start: 18px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
  }
`;

/** Render resolved hops as a numbered list.
 *
 *  A resolved hop carries `data-entity`, so the card's existing delegate opens
 *  that repeater's more-info with no extra wiring. Hops are numbered but carry
 *  no direction: which end of `out_path` is nearest the hub is not established,
 *  and an arrow would assert something the data does not support. */
export function renderRouteHops(
  hops: readonly RouteHop[],
  t: LocalizeFunc
): string {
  if (!hops.length) return "";
  const items = hops.map((hop) => {
    const hash = `<bdi class="route-hop-hash" dir="ltr">${escapeHtml(hop.token)}</bdi>`;
    if (hop.kind === "resolved") {
      const name = `<bdi>${escapeHtml(hop.name)}</bdi>`;
      const body = hop.entityId
        ? `<button type="button" class="route-hop-name chip clickable" data-entity="${escapeHtml(
          hop.entityId
        )}" aria-label="${escapeHtml(hop.name)}">${name}</button>`
        : `<span class="route-hop-name">${name}</span>`;
      return `<li class="route-hop">${body}${hash}</li>`;
    }
    if (hop.kind === "unknown") {
      return `<li class="route-hop"><span class="route-hop-name route-hop-unresolved">${escapeHtml(
        t("card.channel_unknown_repeater")
      )}</span>${hash}</li>`;
    }
    const listed = hop.candidates.map(
      (name) => `<li><bdi>${escapeHtml(name)}</bdi></li>`
    );
    const remaining = hop.total - hop.candidates.length;
    if (remaining > 0) {
      listed.push(
        `<li>${escapeHtml(t("card.channel_candidates_more", { n: remaining }))}</li>`
      );
    }
    return `<li class="route-hop"><span class="route-hop-name route-hop-unresolved">${escapeHtml(
      t("card.channel_ambiguous_repeaters", { n: hop.total })
    )}</span>${hash}<ul class="route-hop-candidates">${listed.join("")}</ul></li>`;
  });
  return `<ol class="route-hops">${items.join("")}</ol>`;
}
