import type { LocalizeFunc } from "./localize.js";
import type { HomeAssistant } from "./types.js";

function formatOptions(hass?: HomeAssistant): {
  locale: string;
  timeZone?: string;
  hour12?: boolean;
} {
  const locale =
    hass?.language ?? hass?.locale?.language ?? navigator.language;
  const zoneMode = hass?.locale?.time_zone;
  const timeZone = zoneMode === "server" ? hass?.config?.time_zone : undefined;
  const timeFormat = hass?.locale?.time_format;
  const hour12 =
    timeFormat === "12" ? true : timeFormat === "24" ? false : undefined;
  return { locale, timeZone, hour12 };
}

function formatter(
  hass: HomeAssistant | undefined,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const format = formatOptions(hass);
  try {
    return new Intl.DateTimeFormat(format.locale, {
      ...options,
      timeZone: format.timeZone,
    });
  } catch {
    return new Intl.DateTimeFormat(undefined, options);
  }
}

export function dateKey(hass: HomeAssistant | undefined, date: Date): string {
  const parts = formatter(hass, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    calendar: "gregory",
    numberingSystem: "latn",
  } as Intl.DateTimeFormatOptions).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function previousDateKey(hass: HomeAssistant | undefined, date: Date): string {
  const [year, month, day] = dateKey(hass, date).split("-").map(Number);
  const previous = new Date(Date.UTC(year!, month! - 1, day! - 1));
  return previous.toISOString().slice(0, 10);
}

export function dateLabel(
  hass: HomeAssistant | undefined,
  date: Date,
  localize: LocalizeFunc,
  now = new Date()
): string {
  const key = dateKey(hass, date);
  const today = dateKey(hass, now);
  const yesterday = previousDateKey(hass, now);
  const dateText = formatter(hass, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
  if (key === today) return `${localize("card.today")} · ${dateText}`;
  if (key === yesterday) {
    return `${localize("card.yesterday")} · ${dateText}`;
  }
  return dateText;
}

export function timeLabel(
  hass: HomeAssistant | undefined,
  date: Date
): string {
  const { hour12 } = formatOptions(hass);
  return formatter(hass, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12,
  }).format(date);
}
