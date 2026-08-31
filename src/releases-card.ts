import { escapeHtml } from "./helpers.js";
import { makeLocalize, type LocalizeFunc } from "./localize.js";
import { STYLES } from "./styles.js";
import { hydrateTileInfo, renderTileHeader } from "./tile-header.js";
import type {
  HaAlertElement,
  HaFormElement,
  HaFormFieldSchema,
  HaFormSchema,
  HomeAssistant,
  MeshcoreReleaseSort,
  MeshcoreReleaseSourceConfig,
  MeshcoreReleasesCardConfig,
} from "./types.js";

const SENSOR_ENTITY_RE = /^sensor\.[a-z0-9_]+$/;
const AGE_REFRESH_MS = 60_000;
const UNAVAILABLE_STATES = new Set(["", "unknown", "unavailable"]);

const RELEASES_STYLES = `
  ha-card.releases-card {
    display: flex;
    min-height: 120px;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
  }

  ha-card.releases-card.grid-rows { height: 100%; }

  .releases-content {
    min-height: 0;
    padding: 0 var(--mush-spacing, 10px) var(--mush-spacing, 10px);
  }

  .grid-rows .releases-content {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .release-list {
    display: flex;
    flex-direction: column;
  }

  .release-row {
    position: relative;
    display: grid;
    min-height: 52px;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--mush-spacing, 10px);
    padding: 5px 2px;
    border-top: 1px solid var(--mushroom-meshcore-border-color);
    color: var(--primary-text-color);
    text-decoration: none;
  }

  .release-row.linked {
    margin: 0 -2px;
    padding-right: 4px;
    padding-left: 4px;
    border-radius: var(--mushroom-meshcore-control-radius);
    cursor: pointer;
    overflow: hidden;
  }

  .release-row.linked > ha-ripple {
    position: absolute;
    inset: 0;
  }

  .release-row.linked:hover {
    background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.04);
  }

  .release-row.linked:focus-visible {
    outline: 2px solid var(--primary-color, var(--mushroom-meshcore-info-color));
    outline-offset: -2px;
  }

  .release-row.unavailable { opacity: 0.62; }

  .release-copy { min-width: 0; }

  .release-name {
    overflow-wrap: anywhere;
    font-size: var(--mushroom-meshcore-primary-font-size);
    font-weight: var(--mushroom-meshcore-primary-font-weight);
    letter-spacing: var(--mushroom-meshcore-primary-letter-spacing);
    line-height: var(--mushroom-meshcore-primary-line-height);
  }

  .release-meta {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
  }

  .release-tag { overflow-wrap: anywhere; }

  .release-prerelease {
    display: inline-flex;
    min-height: 20px;
    align-items: center;
    padding: 0 7px;
    border-radius: var(--ha-border-radius-pill, 999px);
    background: rgba(var(--rgb-warning, 255, 152, 0), 0.14);
    color: var(--warning-color, #f57c00);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.2px;
    line-height: 16px;
  }

  .release-trailing {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
    white-space: nowrap;
  }

  .release-trailing ha-icon {
    display: flex;
    --mdc-icon-size: 16px;
  }

  .releases-state {
    display: flex;
    min-height: 88px;
    align-items: center;
    justify-content: center;
    padding: 16px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    line-height: var(--mushroom-meshcore-secondary-line-height);
    text-align: center;
  }

  @media (max-width: 360px) {
    .release-row { grid-template-columns: minmax(0, 1fr); gap: 2px; }
    .release-trailing { justify-self: start; }
  }

  @media (prefers-reduced-motion: reduce) {
    .release-row { scroll-behavior: auto; }
  }
`;

const EDITOR_STYLES = `
  .meshcore-editor { display: flex; flex-direction: column; gap: 8px; }
  ha-alert { display: block; margin: 8px 0; }
  .source-organizer { border-top: 1px solid var(--divider-color); border-bottom: 1px solid var(--divider-color); }
  .source-organizer summary { padding: 14px 4px; cursor: pointer; font-weight: 500; }
  .source-organizer-body { display: grid; gap: 10px; padding: 0 4px 14px; }
  .source-help { margin: 0; color: var(--secondary-text-color); font-size: 12px; }
  ha-sortable { display: block; min-height: 30px; }
  .source-sortable-list { display: flex; min-height: 30px; flex-direction: column; gap: 8px; }
  .source-editor-item { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 6px; padding: 8px 6px; border-radius: 12px; background: var(--secondary-background-color); }
  .source-fields { min-width: 0; }
  .source-drag, .source-order, .source-remove { min-width: 32px; min-height: 32px; padding: 4px 6px; border: 0; background: transparent; color: var(--secondary-text-color); cursor: pointer; }
  .source-drag { cursor: grab; }
  .source-actions { display: flex; flex-direction: column; }
  .source-remove { color: var(--error-color, #db4437); }
  .source-add-title { margin: 4px 0 0; color: var(--secondary-text-color); font-size: 12px; font-weight: 500; }
`;

interface ReleaseView {
  source: MeshcoreReleaseSourceConfig;
  sourceIndex: number;
  name: string;
  tag: string | null;
  url: string | null;
  publishedAt: Date | null;
  prerelease: boolean;
  available: boolean;
}

function normalizeSources(
  sources: MeshcoreReleasesCardConfig["sources"]
): MeshcoreReleaseSourceConfig[] {
  if (!Array.isArray(sources)) return [];
  const seen = new Set<string>();
  const normalized: MeshcoreReleaseSourceConfig[] = [];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const entity = typeof source.entity === "string" ? source.entity.trim() : "";
    if (!entity || seen.has(entity)) continue;
    seen.add(entity);
    const name = typeof source.name === "string" ? source.name.trim() : "";
    normalized.push(name ? { entity, name } : { entity });
  }
  return normalized;
}

function safeReleaseUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function parsePublishedAt(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function relativeAge(
  date: Date | null,
  hass: HomeAssistant | undefined,
  t: LocalizeFunc,
  now = new Date()
): string {
  if (!date) return t("card.releases_unknown_age");
  const difference = date.getTime() - now.getTime();
  const absolute = Math.abs(difference);
  if (absolute < 60_000) return t("card.releases_just_now");
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 365 * 24 * 60 * 60 * 1000],
    ["month", 30 * 24 * 60 * 60 * 1000],
    ["day", 24 * 60 * 60 * 1000],
    ["hour", 60 * 60 * 1000],
    ["minute", 60 * 1000],
  ];
  const [unit, milliseconds] = units.find(([, threshold]) => absolute >= threshold)!;
  const magnitude = Math.max(1, Math.floor(absolute / milliseconds));
  const value = difference < 0 ? -magnitude : magnitude;
  const locale = hass?.language ?? hass?.locale?.language ?? "en";
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(
      value,
      unit
    );
  } catch {
    return new Intl.RelativeTimeFormat("en", { numeric: "always" }).format(
      value,
      unit
    );
  }
}

function validSort(value: unknown): MeshcoreReleaseSort {
  return value === "configured" || value === "name" ? value : "newest";
}

export class MeshcoreReleasesCard extends HTMLElement {
  private _hass?: HomeAssistant;
  private _config?: MeshcoreReleasesCardConfig;
  private _stateFingerprint = "";
  private _connected = false;
  private _ageTimer?: number;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback(): void {
    this._connected = true;
    this._startAgeTimer();
    this._render();
  }

  disconnectedCallback(): void {
    this._connected = false;
    this._stopAgeTimer();
  }

  setConfig(config: MeshcoreReleasesCardConfig): void {
    this._config = {
      ...config,
      sources: normalizeSources(config.sources),
    };
    this._stateFingerprint = "";
    this._startAgeTimer();
    this._render();
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    const fingerprint = this._fingerprint();
    if (fingerprint !== this._stateFingerprint) {
      this._stateFingerprint = fingerprint;
      this._render();
    }
  }

  private _localize(): LocalizeFunc {
    return makeLocalize(
      this._hass?.language ?? this._hass?.locale?.language ?? "en"
    );
  }

  private _startAgeTimer(): void {
    if (!this._connected || this._ageTimer !== undefined || !this._config) return;
    this._ageTimer = window.setInterval(() => this._render(), AGE_REFRESH_MS);
  }

  private _stopAgeTimer(): void {
    if (this._ageTimer === undefined) return;
    window.clearInterval(this._ageTimer);
    this._ageTimer = undefined;
  }

  private _fingerprint(): string {
    const hass = this._hass;
    const sources = normalizeSources(this._config?.sources);
    const locale = hass?.language ?? hass?.locale?.language ?? "";
    return [
      locale,
      ...sources.map((source) => {
        const state = hass?.states[source.entity];
        if (!state) return `${source.entity}|missing`;
        return [
          source.entity,
          state.state,
          state.attributes["friendly_name"],
          state.attributes["html_url"],
          state.attributes["published_at"],
          state.attributes["prerelease"],
        ].map(String).join("|");
      }),
    ].join("||");
  }

  private _releaseView(
    source: MeshcoreReleaseSourceConfig,
    sourceIndex: number
  ): ReleaseView {
    const state = this._hass?.states[source.entity];
    const friendlyName = state?.attributes["friendly_name"];
    const name =
      source.name?.trim() ||
      (typeof friendlyName === "string" && friendlyName.trim()
        ? friendlyName.trim()
        : source.entity);
    const rawState = typeof state?.state === "string" ? state.state.trim() : "";
    const available =
      SENSOR_ENTITY_RE.test(source.entity) &&
      !!state &&
      !UNAVAILABLE_STATES.has(rawState.toLowerCase());
    return {
      source,
      sourceIndex,
      name,
      tag: available ? rawState : null,
      url: available ? safeReleaseUrl(state?.attributes["html_url"]) : null,
      publishedAt: available
        ? parsePublishedAt(state?.attributes["published_at"])
        : null,
      prerelease: available && state?.attributes["prerelease"] === true,
      available,
    };
  }

  private _sortedViews(): ReleaseView[] {
    const views = normalizeSources(this._config?.sources).map((source, index) =>
      this._releaseView(source, index)
    );
    const sort = validSort(this._config?.sort);
    if (sort === "configured") return views;
    if (sort === "name") {
      const locale = this._hass?.language ?? this._hass?.locale?.language;
      return views.sort(
        (a, b) =>
          a.name.localeCompare(b.name, locale, { sensitivity: "base" }) ||
          a.sourceIndex - b.sourceIndex
      );
    }
    return views.sort((a, b) => {
      const aTime = a.publishedAt?.getTime();
      const bTime = b.publishedAt?.getTime();
      if (aTime !== undefined && bTime !== undefined) {
        return aTime === bTime
          ? a.sourceIndex - b.sourceIndex
          : bTime - aTime;
      }
      if (aTime !== undefined) return -1;
      if (bTime !== undefined) return 1;
      return a.sourceIndex - b.sourceIndex;
    });
  }

  private _sourceCountLabel(count: number, t: LocalizeFunc): string {
    return count === 1
      ? t("card.releases_source_count_one")
      : t("card.releases_source_count", { n: count });
  }

  private _headerSecondary(views: ReleaseView[], t: LocalizeFunc): string {
    const available = views.filter((view) => view.available).length;
    if (available !== views.length) {
      return t("card.releases_available", {
        available,
        total: views.length,
      });
    }
    const newest = views.find((view) => view.publishedAt)?.publishedAt ?? null;
    if (!this._config?.hide_age && newest) {
      return t("card.releases_summary_age", {
        count: this._sourceCountLabel(views.length, t),
        age: relativeAge(newest, this._hass, t),
      });
    }
    return this._sourceCountLabel(views.length, t);
  }

  private _renderRow(view: ReleaseView, t: LocalizeFunc): string {
    const tag = view.tag ?? t("card.unavailable");
    const age = relativeAge(view.publishedAt, this._hass, t);
    const prerelease = view.prerelease
      ? `<span class="release-prerelease">${escapeHtml(
          t("card.releases_prerelease")
        )}</span>`
      : "";
    const ageText = this._config?.hide_age
      ? ""
      : `<span class="release-age">${escapeHtml(age)}</span>`;
    const externalIcon = view.url
      ? `<ha-icon icon="mdi:open-in-new" aria-hidden="true"></ha-icon>`
      : "";
    const contents = `<span class="release-copy">
      <span class="release-name">${escapeHtml(view.name)}</span>
      <span class="release-meta"><bdi class="release-tag" dir="ltr">${escapeHtml(
        tag
      )}</bdi>${prerelease}</span>
    </span>
    <span class="release-trailing">${ageText}${externalIcon}</span>`;
    const label = t("card.releases_row_label", {
      name: view.name,
      tag,
      age: this._config?.hide_age ? "" : age,
    }).trim();
    if (!view.url) {
      return `<div class="release-row${view.available ? "" : " unavailable"}" role="listitem" aria-label="${escapeHtml(
        label
      )}">${contents}</div>`;
    }
    return `<a class="release-row linked" role="listitem" href="${escapeHtml(
      view.url
    )}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(
      t("card.releases_open", { name: view.name, tag })
    )}"><ha-ripple></ha-ripple>${contents}</a>`;
  }

  private _render(): void {
    if (!this._config || !this._hass) return;
    const t = this._localize();
    const views = this._sortedViews();
    if (!views.length) {
      this._setBody(
        `<div class="releases-state config-prompt">${escapeHtml(
          t("card.releases_select_sources")
        )}</div>`,
        false
      );
      return;
    }
    const available = views.filter((view) => view.available).length;
    const headerConfig = {
      name: this._config.name,
      icon: this._config.icon,
      icon_color: this._config.icon_color ?? "primary",
    };
    const header = renderTileHeader(headerConfig, {
      displayName: t("card.releases_title"),
      secondary: this._headerSecondary(views, t),
      icon: "mdi:download",
      active: available > 0,
      primaryEntityId: null,
      inactiveState: "unknown",
      inactiveBadgeIcon: "mdi:alert-circle-outline",
    });
    const rows = views.map((view) => this._renderRow(view, t)).join("");
    this._setBody(
      `${header}<div class="releases-content"><div class="release-list" role="list">${rows}</div></div>`,
      true
    );
  }

  private _setBody(body: string, hydrateHeader: boolean): void {
    const constrained = typeof this._config?.grid_options?.rows === "number";
    const className = constrained ? "releases-card grid-rows" : "releases-card";
    this.shadowRoot!.innerHTML = `<style>${STYLES}${RELEASES_STYLES}</style><ha-card class="${className}">${body}</ha-card>`;
    if (hydrateHeader) hydrateTileInfo(this.shadowRoot!);
  }

  getCardSize(): number {
    const sources = normalizeSources(this._config?.sources).length;
    return Math.max(2, Math.min(8, sources + 1));
  }

  getGridOptions(): {
    columns: "full";
    rows: "auto";
    min_columns: number;
    min_rows: number;
  } {
    return { columns: "full", rows: "auto", min_columns: 6, min_rows: 1 };
  }

  static getConfigElement(): HTMLElement {
    return document.createElement("mushroom-meshcore-releases-card-editor");
  }

  static getStubConfig(): MeshcoreReleasesCardConfig {
    return { sources: [] };
  }
}

export class MeshcoreReleasesCardEditor extends HTMLElement {
  private _hass?: HomeAssistant;
  private _config?: MeshcoreReleasesCardConfig;
  private _discoveryFingerprint = "\u0000";
  private _sourcesOpen = true;

  setConfig(config: MeshcoreReleasesCardConfig): void {
    const next = { ...config, sources: normalizeSources(config.sources) };
    const unchanged =
      this._config !== undefined &&
      JSON.stringify(next) === JSON.stringify(this._config);
    this._config = next;
    if (!unchanged) this._renderEditor();
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    this.querySelectorAll<HaFormElement>("ha-form").forEach((form) => {
      form.hass = hass;
    });
    const fingerprint = this._sensorEntities().join("|");
    if (fingerprint !== this._discoveryFingerprint) {
      this._discoveryFingerprint = fingerprint;
      this._renderEditor();
    }
  }

  connectedCallback(): void {
    this._renderEditor();
  }

  private _localize(): LocalizeFunc {
    return makeLocalize(
      this._hass?.language ?? this._hass?.locale?.language ?? "en"
    );
  }

  private _sensorEntities(): string[] {
    if (!this._hass) return [];
    return Object.keys(this._hass.states)
      .filter((entityId) => SENSOR_ENTITY_RE.test(entityId))
      .sort();
  }

  private _dispatchConfig(
    config: MeshcoreReleasesCardConfig,
    rerender = false
  ): void {
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config } }));
    if (rerender) this._renderEditor();
  }

  private _sourceForm(
    source: MeshcoreReleaseSourceConfig,
    sourceIndex: number
  ): HaFormElement {
    const t = this._localize();
    const selectedElsewhere = new Set(
      normalizeSources(this._config?.sources)
        .filter((_, index) => index !== sourceIndex)
        .map((entry) => entry.entity)
    );
    const includeEntities = this._sensorEntities().filter(
      (entityId) => !selectedElsewhere.has(entityId) || entityId === source.entity
    );
    const form = document.createElement("ha-form") as HaFormElement;
    form.hass = this._hass!;
    form.computeLabel = (schema) =>
      ("label" in schema ? schema.label : undefined) ?? schema.name;
    form.schema = [
      {
        name: "entity",
        label: t("editor.releases_source_entity"),
        selector: { entity: { domain: "sensor", include_entities: includeEntities } },
      },
      {
        name: "name",
        label: t("editor.releases_source_name"),
        selector: { text: {} },
      },
    ];
    form.data = { entity: source.entity, name: source.name ?? "" };
    form.addEventListener("value-changed", (event: Event) => {
      const value = (
        event as CustomEvent<{ value: Record<string, unknown> }>
      ).detail.value;
      const current = normalizeSources(this._config?.sources);
      const entity =
        typeof value["entity"] === "string" ? value["entity"].trim() : "";
      if (
        !SENSOR_ENTITY_RE.test(entity) ||
        current.some((entry, index) => index !== sourceIndex && entry.entity === entity)
      ) {
        form.data = { entity: source.entity, name: source.name ?? "" };
        return;
      }
      const name = typeof value["name"] === "string" ? value["name"].trim() : "";
      current[sourceIndex] = name ? { entity, name } : { entity };
      form.data = { entity, name };
      this._dispatchConfig({ ...this._config, sources: current }, entity !== source.entity);
    });
    return form;
  }

  private _saveSourceOrder(list: HTMLElement): void {
    const byEntity = new Map(
      normalizeSources(this._config?.sources).map((source) => [source.entity, source])
    );
    const sources = Array.from(
      list.querySelectorAll<HTMLElement>(".source-editor-item")
    )
      .map((item) => byEntity.get(item.dataset["sourceEntity"] ?? ""))
      .filter((source): source is MeshcoreReleaseSourceConfig => !!source);
    this._dispatchConfig({ ...this._config, sources }, true);
  }

  private _sourceOrganizer(): HTMLElement {
    const t = this._localize();
    const sources = normalizeSources(this._config?.sources);
    const details = document.createElement("details");
    details.className = "source-organizer";
    details.open = this._sourcesOpen;
    details.addEventListener("toggle", () => {
      this._sourcesOpen = details.open;
    });
    const summary = document.createElement("summary");
    summary.textContent = t("editor.section_releases_sources");
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "source-organizer-body";
    const help = document.createElement("p");
    help.className = "source-help";
    help.textContent = t("editor.releases_sources_help");
    body.appendChild(help);

    const sortable = document.createElement("ha-sortable") as HTMLElement & {
      group?: string;
      handleSelector?: string;
      draggableSelector?: string;
      rollback?: boolean;
    };
    sortable.group = "meshcore-release-sources";
    sortable.handleSelector = ".source-drag";
    sortable.draggableSelector = ".source-editor-item";
    sortable.rollback = false;
    const list = document.createElement("div");
    list.className = "source-sortable-list";

    sources.forEach((source, index) => {
      const item = document.createElement("div");
      item.className = "source-editor-item";
      item.dataset["sourceEntity"] = source.entity;
      const drag = document.createElement("button");
      drag.type = "button";
      drag.className = "source-drag";
      drag.textContent = "☰";
      drag.setAttribute(
        "aria-label",
        t("editor.releases_source_drag", { name: source.name ?? source.entity })
      );
      item.appendChild(drag);

      const fields = document.createElement("div");
      fields.className = "source-fields";
      fields.appendChild(this._sourceForm(source, index));
      item.appendChild(fields);

      const actions = document.createElement("div");
      actions.className = "source-actions";
      for (const [direction, symbol] of [[-1, "↑"], [1, "↓"]] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "source-order";
        button.textContent = symbol;
        button.setAttribute(
          "aria-label",
          t(
            direction < 0
              ? "editor.releases_source_move_up"
              : "editor.releases_source_move_down",
            { name: source.name ?? source.entity }
          )
        );
        button.addEventListener("click", () => {
          const sibling =
            direction < 0 ? item.previousElementSibling : item.nextElementSibling;
          if (!sibling) return;
          if (direction < 0) list.insertBefore(item, sibling);
          else list.insertBefore(sibling, item);
          this._saveSourceOrder(list);
        });
        actions.appendChild(button);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "source-remove";
      remove.textContent = "×";
      remove.setAttribute(
        "aria-label",
        t("editor.releases_source_remove", { name: source.name ?? source.entity })
      );
      remove.addEventListener("click", () => {
        this._dispatchConfig(
          {
            ...this._config,
            sources: sources.filter((entry) => entry.entity !== source.entity),
          },
          true
        );
      });
      actions.appendChild(remove);
      item.appendChild(actions);
      list.appendChild(item);
    });

    sortable.appendChild(list);
    sortable.addEventListener("item-moved", () => this._saveSourceOrder(list));
    body.appendChild(sortable);

    const used = new Set(sources.map((source) => source.entity));
    const available = this._sensorEntities().filter((entityId) => !used.has(entityId));
    if (available.length) {
      const addTitle = document.createElement("div");
      addTitle.className = "source-add-title";
      addTitle.textContent = t("editor.releases_add_source");
      body.appendChild(addTitle);
      const addForm = document.createElement("ha-form") as HaFormElement;
      addForm.hass = this._hass!;
      addForm.computeLabel = (schema) =>
        ("label" in schema ? schema.label : undefined) ?? schema.name;
      addForm.schema = [
        {
          name: "entity",
          label: t("editor.releases_source_entity"),
          selector: { entity: { domain: "sensor", include_entities: available } },
        },
      ];
      addForm.data = { entity: null };
      addForm.addEventListener("value-changed", (event: Event) => {
        const entity = (
          event as CustomEvent<{ value: Record<string, unknown> }>
        ).detail.value["entity"];
        if (typeof entity !== "string" || !SENSOR_ENTITY_RE.test(entity)) return;
        this._dispatchConfig(
          { ...this._config, sources: [...sources, { entity }] },
          true
        );
      });
      body.appendChild(addForm);
    }
    details.appendChild(body);
    return details;
  }

  private _settingsForm(): HaFormElement {
    const t = this._localize();
    const section = (
      title: string,
      icon: string,
      schema: HaFormFieldSchema[]
    ): HaFormSchema => ({
      type: "expandable",
      name: "",
      flatten: true,
      title,
      icon,
      schema,
    });
    const form = document.createElement("ha-form") as HaFormElement;
    form.hass = this._hass!;
    form.computeLabel = (schema) =>
      ("label" in schema ? schema.label : undefined) ?? schema.name;
    form.schema = [
      section(t("editor.section_appearance"), "mdi:palette", [
        { name: "name", label: t("editor.name_label"), selector: { text: {} } },
        { name: "icon", label: t("editor.icon_label"), selector: { icon: {} } },
        {
          name: "icon_color",
          label: t("editor.icon_color_label"),
          selector: { ui_color: {} },
        },
      ]),
      section(t("editor.section_releases_behavior"), "mdi:sort", [
        {
          name: "sort",
          label: t("editor.releases_sort"),
          selector: {
            select: {
              mode: "dropdown",
              options: [
                { value: "newest", label: t("editor.releases_sort_newest") },
                { value: "configured", label: t("editor.releases_sort_configured") },
                { value: "name", label: t("editor.releases_sort_name") },
              ],
            },
          },
        },
        {
          name: "hide_age",
          label: t("editor.releases_hide_age"),
          selector: { boolean: {} },
        },
      ]),
    ];
    form.data = {
      name: this._config?.name ?? "",
      icon: this._config?.icon ?? null,
      icon_color: this._config?.icon_color ?? null,
      sort: validSort(this._config?.sort),
      hide_age: this._config?.hide_age === true,
    };
    form.addEventListener("value-changed", (event: Event) => {
      const value = (
        event as CustomEvent<{ value: Record<string, unknown> }>
      ).detail.value;
      form.data = value;
      const config: MeshcoreReleasesCardConfig = { ...this._config };
      for (const key of ["name", "icon", "icon_color"] as const) {
        const raw = value[key];
        if (typeof raw === "string" && raw.trim()) config[key] = raw.trim();
        else delete config[key];
      }
      const sort = validSort(value["sort"]);
      if (sort === "newest") delete config.sort;
      else config.sort = sort;
      if (value["hide_age"] === true) config.hide_age = true;
      else delete config.hide_age;
      this._dispatchConfig(config);
    });
    return form;
  }

  private _renderEditor(): void {
    if (!this._config || !this._hass) return;
    while (this.lastChild) this.removeChild(this.lastChild);
    const style = document.createElement("style");
    style.textContent = EDITOR_STYLES;
    this.appendChild(style);
    const container = document.createElement("div");
    container.className = "meshcore-editor";
    if (!this._sensorEntities().length) {
      const alert = document.createElement("ha-alert") as HaAlertElement;
      alert.alertType = "info";
      alert.textContent = this._localize()("editor.releases_no_sensors");
      container.appendChild(alert);
    }
    container.appendChild(this._sourceOrganizer());
    container.appendChild(this._settingsForm());
    this.appendChild(container);
  }
}
