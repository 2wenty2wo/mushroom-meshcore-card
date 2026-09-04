import type {
  HassDeviceRegistryEntry,
  HassEntityRegistryEntry,
  HomeAssistant,
  HubInfo,
  NodeInfo,
} from "./types.js";
import {
  asRecord,
  longestCommonPrefix,
  longestCommonSuffix,
  slugifyName,
} from "./helpers.js";

/** A contact advert reduced to the identity fields the cards match on. */
export interface ContactIdentity {
  /** Uppercase hex, even length. Full public key when the advert carried one. */
  publicKey: string;
  name: string;
  /** True when the key came from a prefix rather than a complete public key. */
  keyIsPrefix?: boolean;
}

/** A contact identity plus the entity that published it, so a card can open it. */
export interface DiscoveredContact extends ContactIdentity {
  entityId: string;
}

const MAX_CONTACT_KEY_CHARACTERS = 128;
const MAX_CONTACT_NAME_CHARACTERS = 512;
const MAX_DISCOVERED_CONTACTS = 1_000;
/** Control characters plus the bidi overrides that can visually reorder a name
 *  around the markup it sits in. Advert names are chosen by whoever operates a
 *  radio in range, so they are stripped before the name reaches any template. */
const CONTROL_AND_BIDI =
  /[\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

export function normalizedContactName(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_CONTACT_NAME_CHARACTERS) {
    return undefined;
  }
  const name = value.replace(CONTROL_AND_BIDI, " ").replace(/\s+/g, " ").trim();
  return name || undefined;
}

export function normalizedContactKey(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_CONTACT_KEY_CHARACTERS) {
    return undefined;
  }
  const key = value.trim().toUpperCase();
  return key.length >= 2 && key.length % 2 === 0 && /^[0-9A-F]+$/.test(key)
    ? key
    : undefined;
}

/** Whether a contact's type field describes a repeater.
 *
 *  An absent type counts as one: this integration publishes no type field at
 *  all, so requiring it would discard every contact. */
export function isRepeaterContact(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (value === 2) return true;
  return typeof value === "string" &&
    (value.trim() === "2" || value.trim().toLowerCase() === "repeater");
}

/** Reduce one contact advert — an entity's attributes, or a `get_contacts`
 *  response item — to the identity fields, or null when it carries neither a
 *  usable key nor a usable name. */
export function normalizeContactRecord(value: unknown): ContactIdentity | null {
  const contact = asRecord(value);
  if (!contact) return null;
  if (
    !isRepeaterContact(
      contact["type"] ?? contact["contact_type"] ?? contact["node_type"]
    )
  ) {
    return null;
  }
  const completePublicKey = normalizedContactKey(contact["public_key"]);
  const publicKey = completePublicKey ?? normalizedContactKey(
    contact["pubkey_prefix"] ?? contact["adv_id"]
  );
  const name = normalizedContactName(
    contact["adv_name"] ?? contact["name"] ?? contact["display_name"]
  );
  return publicKey && name
    ? {
      publicKey,
      name,
      ...(!completePublicKey ? { keyIsPrefix: true } : {}),
    }
    : null;
}

/** Dedupe key. Two prefix-keyed contacts sharing a prefix are different
 *  repeaters, so the name has to take part; a full key stands alone. */
export function contactIdentityKey(contact: ContactIdentity): string {
  return contact.keyIsPrefix
    ? `${contact.publicKey}\u0000${contact.name}`
    : contact.publicKey;
}

/** Every contact advert published beneath one hub.
 *
 *  Route data is hub-relative, so a card resolving a path must only consider
 *  the hub it is looking through — `isDeviceOnHub` covers the hub device itself
 *  and anything filed beneath it. */
export function hubContacts(
  hass: Pick<HomeAssistant, "states" | "entities" | "devices">,
  hubDeviceId: string | null | undefined
): DiscoveredContact[] {
  if (!hubDeviceId) return [];
  const contacts: DiscoveredContact[] = [];
  const seen = new Set<string>();
  for (const [entityId, registryEntry] of Object.entries(hass.entities ?? {})) {
    if (
      !isDeviceOnHub(hass, registryEntry.device_id, hubDeviceId) ||
      registryEntry.platform !== "meshcore" ||
      !entityId.startsWith("binary_sensor.")
    ) {
      continue;
    }
    const state = hass.states?.[entityId];
    if (!state) continue;
    const contact = normalizeContactRecord(state.attributes);
    if (!contact) continue;
    const identity = contactIdentityKey(contact);
    if (seen.has(identity)) continue;
    seen.add(identity);
    contacts.push({ entityId, ...contact });
    if (contacts.length >= MAX_DISCOVERED_CONTACTS) break;
  }
  return contacts;
}

/** The pubkey prefixes of every repeater this node has heard directly.
 *
 *  Read from the raw `_neighbor_<hex>` entity IDs rather than from the rendered
 *  neighbour list, which is filtered to the last 48 hours and to neighbours
 *  carrying a numeric SNR. A repeater on the active path is adjacent whether or
 *  not its SNR sensor happens to be readable this minute.
 *
 *  Lowercase, matching the entity IDs; callers comparing against contact keys
 *  must normalise, since those are uppercased. */
export function nodeNeighborIds(
  hass: Pick<HomeAssistant, "entities">,
  deviceId: string
): string[] {
  const ids = new Set<string>();
  for (const [entityId, info] of Object.entries(hass.entities ?? {})) {
    if (info.device_id !== deviceId) continue;
    const match = entityId.match(/_neighbor_([0-9a-f]+)(?:_seen)?$/);
    if (match) ids.add(match[1]!);
  }
  return [...ids];
}

/** Whether a registry device is the selected hub or one of its direct children. */
export function isDeviceOnHub(
  hass: Pick<HomeAssistant, "devices">,
  deviceId: string | null | undefined,
  hubDeviceId: string
): boolean {
  if (!deviceId) return false;
  return deviceId === hubDeviceId ||
    hass.devices[deviceId]?.via_device_id === hubDeviceId;
}

/** The node's pubkey prefix, read back out of its own entity IDs.
 *
 *  Device names drift away from the advertised name in normal use: the
 *  integration prefixes them ("MeshCore Repeater: …"), appends the pubkey
 *  ("… (d47609)"), and a UI rename replaces the lot. The pubkey embedded in the
 *  entity IDs survives all of that, so it is the identity worth matching a
 *  contact on.
 *
 *  Integrations publish this token at several widths — four hex is the shortest
 *  seen. Narrowness is not enforced here; `findNodeContact` requires the match
 *  to be unique instead, which is what actually makes a short token safe. */
export function nodePubkey(
  hass: Pick<HomeAssistant, "entities">,
  deviceId: string
): string | null {
  for (const [entityId, info] of Object.entries(hass.entities ?? {})) {
    if (info.device_id !== deviceId) continue;
    const match = entityId.match(/^[a-z_]+\.meshcore_([0-9a-f]{4,})_/);
    if (match) return match[1]!;
  }
  return null;
}

const CONTACT_ENTITY_RE = /^binary_sensor\.meshcore_.*_contact$/;

/** Find the contact `binary_sensor` advertising for one node.
 *
 *  Matches on the pubkey shared by the node's entity IDs and the contact's
 *  `pubkey_prefix`. Comparing the advertised name is kept as a fallback for
 *  integrations that publish no pubkey, but it only lands when the device name
 *  happens to equal `adv_name` — which it does not once the device has been
 *  renamed or carries the integration's own prefix and suffix.
 *
 *  Either identity must be unambiguous to be used. A four-hex token has only
 *  65k values against the hundreds of contacts a busy mesh carries, and two
 *  hubs publishing the same radio give contacts sharing both pubkey and name.
 *  Route data is hub-relative, so answering with the wrong contact would show
 *  another hub's route as this node's — worse than showing none. */
export function findNodeContact(
  hass: Pick<HomeAssistant, "states" | "entities" | "devices">,
  nodeName: string,
  deviceId?: string
): string | null {
  const pubkey = deviceId ? nodePubkey(hass, deviceId) : null;
  // Only this node's own hub can answer for it, so exclude contacts published
  // by any other. `isDeviceOnHub` covers the hub itself as well as anything
  // filed beneath it, including the node device and a contact given a device of
  // its own. A node with no `via_device_id` cannot be scoped at all, which is
  // why the uniqueness rules below have to carry that case.
  const hubDeviceId = deviceId
    ? hass.devices?.[deviceId]?.via_device_id ?? null
    : null;
  let byName: string | null = null;
  let nameMatches = 0;
  let byPubkey: string | null = null;
  let pubkeyMatches = 0;
  for (const [id, state] of Object.entries(hass.states ?? {})) {
    if (!CONTACT_ENTITY_RE.test(id)) continue;
    if (hubDeviceId && !isDeviceOnHub(hass, hass.entities?.[id]?.device_id, hubDeviceId)) {
      continue;
    }
    if (pubkey) {
      const prefix = String(state.attributes["pubkey_prefix"] ?? "").toLowerCase();
      // Either side may be the shorter form, so compare on the overlap.
      if (prefix.length >= 4 && (prefix.startsWith(pubkey) || pubkey.startsWith(prefix))) {
        byPubkey = id;
        pubkeyMatches++;
      }
    }
    if (String(state.attributes["adv_name"] ?? "") === nodeName) {
      if (byName === null) byName = id;
      nameMatches++;
    }
  }
  if (pubkeyMatches === 1) return byPubkey;
  if (nameMatches === 1) return byName;
  return null;
}

// Longest suffix shared by at least half of the strings.
//
// Why: a node device's entities mostly end with `_<adv_name_slug>`
// (e.g. `_yuba_crest_repeater`), but a few outliers — like
// `_neighbor_<hex>` and `_neighbor_<hex>_seen` — don't, which makes the
// strict longest-common-suffix collapse to "". A 50%-threshold suffix
// stays robust against those outliers while still being conservative
// enough to avoid false matches on small devices.
function majoritySuffix(strs: string[]): string {
  if (strs.length <= 1) return longestCommonSuffix(strs);
  const half = Math.ceil(strs.length / 2);
  let best = "";
  for (const candidate of strs) {
    // Walk down candidate's possible suffixes from longest. Only check
    // suffixes longer than `best` to avoid wasted work.
    for (let len = candidate.length; len > best.length; len--) {
      const suffix = candidate.slice(-len);
      let count = 0;
      for (const s of strs) if (s.endsWith(suffix)) count++;
      if (count >= half) {
        best = suffix;
        break;
      }
    }
  }
  return best;
}

/** Every metric core this entity could have, one per candidate suffix it ends
 *  with. A device renamed after some of its entities were created carries more
 *  than one name slug, so no single suffix describes it — and `majoritySuffix`
 *  can over-reach into the metric name on a small pool, so the longest match is
 *  not reliably the right one either. Trying them all lets a correct candidate
 *  win without having to rank them.
 *
 *  With no discovered suffix, the prefix-stripped base remains the only core,
 *  preserving exact-before-compatibility matching for suffix-less legacy IDs.
 *  Otherwise, returns empty when nothing matches and leaves such entities to
 *  the legacy raw-ID pass. The length guard keeps a core from being stripped
 *  away entirely on devices small enough for `majoritySuffix` to return a whole
 *  entity ID. */
function metricCores(
  entityId: string,
  ePrefix: string,
  eSuffixes: readonly string[]
): string[] {
  const base =
    ePrefix && entityId.startsWith(ePrefix)
      ? entityId.slice(ePrefix.length)
      : entityId;
  if (eSuffixes.length === 0) return [base];
  return eSuffixes
    .filter((suffix) => base.endsWith(suffix) && base.length > suffix.length)
    .map((suffix) => base.slice(0, -suffix.length));
}

/** A suffix derived from anything other than the majority vote is a guess, so
 *  it must look like a name slug and actually be shared. `majoritySuffix`
 *  returns the whole input string when given one or two entities (`half` is 1,
 *  so the first candidate's full-length suffix wins immediately), which would
 *  otherwise strip an entity down to nothing. */
function plausibleSlugSuffix(
  suffix: string,
  pool: readonly string[],
  minShared: number
): boolean {
  return (
    suffix.startsWith("_") &&
    pool.filter((id) => id.endsWith(suffix)).length >= minShared &&
    pool.every((id) => id.length > suffix.length)
  );
}

/** Every underscore-aligned suffix of the strict shared tail.
 *
 *  Two entities can share domain or metric fragments before the node slug, so
 *  their raw common suffix may be `_online_<node_slug>` rather than just
 *  `_<node_slug>`. Offering every delimiter boundary lets metric matching find
 *  the true slug without discovery having to guess which segment belongs to
 *  the metric. */
function commonDelimitedSuffixes(pool: readonly string[]): string[] {
  const common = longestCommonSuffix([...pool]);
  const suffixes: string[] = [];
  for (
    let delimiter = common.indexOf("_");
    delimiter >= 0;
    delimiter = common.indexOf("_", delimiter + 1)
  ) {
    suffixes.push(common.slice(delimiter));
  }
  return suffixes;
}

/** Entity-ID suffix candidates for one device, longest first and de-duplicated.
 *
 *  Home Assistant never rewrites existing entity IDs when a device is renamed,
 *  so a renamed device can end up with entities from multiple eras: existing
 *  entities keep their old slug while later entities carry newer ones. Matching
 *  on a single suffix silently loses all but one of those groups. */
export function nodeSuffixCandidates(
  device: Pick<HassDeviceRegistryEntry, "name" | "name_by_user">,
  suffixSource: readonly string[]
): string[] {
  const candidates: string[] = [];
  // The majority vote is the only candidate that survives a rename untouched,
  // so it is never subjected to the slug guard the derived candidates get. The
  // one thing worth dropping is a candidate no entity is longer than: on a
  // one- or two-entity device `majoritySuffix` returns a whole entity ID, which
  // `metricCores` can never strip anyway.
  const majority = majoritySuffix([...suffixSource]);
  if (majority && suffixSource.some((id) => id.length > majority.length)) {
    candidates.push(majority);
  }

  // A UI rename leaves the integration-reported `name` behind, so both name
  // sources are worth predicting. HA device names are often prefixed with the
  // integration ("MeshCore Mount Annan 2") while the entity slug is not, so
  // offer the stripped form too. A candidate nothing ends with costs nothing.
  for (const source of [device.name_by_user, device.name]) {
    const slug = slugifyName(source);
    if (!slug) continue;
    for (const variant of [slug, slug.replace(/^meshcore_/, "")]) {
      const suffix = `_${variant}`;
      if (plausibleSlugSuffix(suffix, suffixSource, 1)) candidates.push(suffix);
    }
  }

  // Whatever the majority vote left behind may carry another era's slug.
  const leftovers = suffixSource.filter((id) => !id.endsWith(majority));
  if (leftovers.length >= 2) {
    // A two-item pool cannot produce a meaningful 50% vote: one entity alone
    // satisfies it. Offer every delimiter boundary of both entities' strict
    // common tail there; larger pools retain the outlier-tolerant majority.
    const secondaryCandidates =
      leftovers.length === 2
        ? commonDelimitedSuffixes(leftovers)
        : [majoritySuffix(leftovers)];
    for (const secondary of secondaryCandidates) {
      if (secondary && plausibleSlugSuffix(secondary, leftovers, 2)) {
        candidates.push(secondary);
      }
    }
  }

  return [...new Set(candidates)].sort((a, b) => b.length - a.length);
}

/** Resolve one metric entity among a device's registry entities, using the
 *  entity-ID prefix/suffixes discovered for that device. */
export function findEntityByDevice(
  entities: Record<string, HassEntityRegistryEntry>,
  deviceId: string,
  metric: string,
  ePrefix: string,
  eSuffixes: readonly string[]
): string | null {
  if (!deviceId) return null;
  // First pass: strip the discovered prefix/suffix and prefer an exact metric
  // core across the whole device. Exact matching must finish before the
  // compatibility suffix pass so `airtime` cannot bind to `rx_airtime`
  // merely because the registry enumerates the RX entity first.
  for (const [entityId, info] of Object.entries(entities)) {
    if (info.device_id !== deviceId) continue;
    const cores = metricCores(entityId, ePrefix, eSuffixes);
    if (cores.includes(metric)) return entityId;
  }
  // Compatibility for names such as `last_rssi` when looking up `rssi`.
  for (const [entityId, info] of Object.entries(entities)) {
    if (info.device_id !== deviceId) continue;
    const cores = metricCores(entityId, ePrefix, eSuffixes);
    if (cores.some((core) => core.endsWith(`_${metric}`))) return entityId;
  }
  // Fallback for older entity-ID formats with no node-name suffix:
  // accept entities whose ID ends exactly in `_<metric>`. We don't
  // also `includes(_<metric>_)` because that over-matches — e.g.
  // `_battery_percentage_*` would falsely satisfy metric "battery".
  for (const [entityId, info] of Object.entries(entities)) {
    if (info.device_id !== deviceId) continue;
    if (entityId.endsWith(`_${metric}`)) return entityId;
  }
  return null;
}

export function discoverHubs(hass: HomeAssistant): HubInfo[] {
  const hubs: Record<string, HubInfo> = {};
  const re = /^sensor\.meshcore_([a-f0-9]+)_node_count(?:_(.+))?$/;
  for (const id of Object.keys(hass.states)) {
    const m = id.match(re);
    if (m && !hubs[m[1]]) {
      hubs[m[1]] = {
        pubkey: m[1],
        name: m[2] || m[1],
        nodeCountEntity: id,
        deviceId: hass.entities?.[id]?.device_id ?? null,
      };
    }
  }
  return Object.values(hubs);
}

export function discoverNodes(hass: HomeAssistant): NodeInfo[] {
  if (!hass.entities || !hass.devices) return [];

  // Map hub device_id → hub pubkey
  const hubDeviceIds = new Set<string>();
  const hubDeviceToPubkey = new Map<string, string>();
  for (const [entityId, info] of Object.entries(hass.entities)) {
    const m = entityId.match(/^sensor\.meshcore_([a-f0-9]+)_node_count/);
    if (m && info.device_id) {
      hubDeviceIds.add(info.device_id);
      hubDeviceToPubkey.set(info.device_id, m[1]);
    }
  }

  // All meshcore devices that are not hub devices
  const meshcoreDeviceIds = new Set<string>();
  for (const [, info] of Object.entries(hass.entities)) {
    if (
      info.platform === "meshcore" &&
      info.device_id &&
      !hubDeviceIds.has(info.device_id)
    ) {
      meshcoreDeviceIds.add(info.device_id);
    }
  }

  const nodes: NodeInfo[] = [];
  for (const deviceId of meshcoreDeviceIds) {
    const device = hass.devices[deviceId];
    if (!device) continue;

    // Resolve parent hub via via_device_id
    const hubPubkey = hubDeviceToPubkey.get(device.via_device_id ?? "") ?? null;

    const deviceEntityIds = Object.entries(hass.entities)
      .filter(([, info]) => info.device_id === deviceId)
      .map(([id]) => id);

    // Neighbor entities (`..._neighbor_<hex>`, `..._neighbor_<hex>_seen`,
    // `..._neighbor_count`) are keyed by the *neighbor's* pubkey, not the
    // node-name slug every other entity shares. A repeater with many
    // neighbors makes these the majority, which defeats majoritySuffix and
    // collapses the majority suffix — so entity lookups fail and the node renders
    // offline. Exclude them when deriving the prefix/suffix; fall back to the
    // full list if a device somehow exposes nothing else.
    const slugEntityIds = deviceEntityIds.filter(
      (id) => !/_neighbor_(?:count$|[0-9a-f]+(?:_seen)?$)/.test(id)
    );
    const suffixSource = slugEntityIds.length ? slugEntityIds : deviceEntityIds;
    nodes.push({
      name: device.name_by_user || device.name || deviceId,
      deviceId,
      hubPubkey,
      ePrefix: longestCommonPrefix(suffixSource),
      eSuffixes: nodeSuffixCandidates(device, suffixSource),
    });
  }
  return nodes;
}
