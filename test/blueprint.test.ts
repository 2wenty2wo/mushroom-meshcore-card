import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument, type ScalarTag } from "yaml";

const BLUEPRINT_PATH = resolve(
  process.cwd(),
  "blueprints/automation/meshcore/mention_notifications.yaml"
);
const SOURCE_URL =
  "https://github.com/2wenty2wo/mushroom-meshcore-card/blob/main/blueprints/automation/meshcore/mention_notifications.yaml";

interface InputReference {
  input: string;
}

interface BlueprintInput {
  default?: unknown;
  selector: Record<string, unknown>;
}

interface BlueprintSection {
  collapsed?: boolean;
  input: Record<string, BlueprintInput>;
}

interface BlueprintConfig {
  blueprint: {
    name: string;
    domain: string;
    author: string;
    source_url: string;
    homeassistant: { min_version: string };
    input: Record<string, BlueprintSection>;
  };
  mode: string;
  max: number;
  variables: Record<string, unknown>;
  triggers: Array<Record<string, unknown>>;
  conditions: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
}

const inputTag: ScalarTag = {
  tag: "!input",
  resolve: (value) => ({ input: value } satisfies InputReference),
};

const source = readFileSync(BLUEPRINT_PATH, "utf8");
const document = parseDocument(source, { customTags: [inputTag] });
const config = document.toJS() as BlueprintConfig;

function inputReference(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  return (value as Partial<InputReference>).input;
}

describe("MeshCore Mentions blueprint", () => {
  it("is valid YAML with stable blueprint metadata", () => {
    expect(document.errors).toEqual([]);
    expect(document.warnings).toEqual([]);
    expect(config.blueprint).toMatchObject({
      name: "MeshCore Mentions",
      domain: "automation",
      author: "2wenty2wo",
      source_url: SOURCE_URL,
      homeassistant: { min_version: "2026.5.0" },
    });
  });

  it("defines the permanent inputs with the intended selectors", () => {
    const mentionInputs = config.blueprint.input.mention_settings!.input;
    const notificationSection = config.blueprint.input.notification_settings!;
    const companionNames = mentionInputs.companion_names!;
    const todoEntity = mentionInputs.todo_entity!;
    const notificationTargets = notificationSection.input.notification_targets!;

    expect(companionNames.default).toBeUndefined();
    expect(companionNames.selector).toEqual({ text: { multiple: true } });
    expect(todoEntity.default).toBeUndefined();
    expect(todoEntity.selector).toEqual({
      entity: {
        filter: [{ domain: "todo", integration: "local_todo" }],
      },
    });
    expect(notificationSection.collapsed).toBe(true);
    expect(notificationTargets.default).toEqual([]);
    expect(notificationTargets.selector).toEqual({
      entity: {
        filter: [{ domain: "notify" }],
        multiple: true,
      },
    });
  });

  it("exposes every input used by templates and targets", () => {
    expect(inputReference(config.variables.companion_names)).toBe("companion_names");
    expect(inputReference(config.variables.todo_entity)).toBe("todo_entity");
    expect(inputReference(config.variables.notification_targets)).toBe(
      "notification_targets"
    );
  });

  it("listens only for MeshCore channel messages and permits short bursts", () => {
    expect(config.triggers).toEqual([
      {
        trigger: "event",
        event_type: "meshcore_message",
        event_data: { message_type: "channel" },
      },
    ]);
    expect(config.mode).toBe("parallel");
    expect(config.max).toBe(10);
  });

  it("preserves ordered, case-insensitive plain and bracketed tag matching", () => {
    const matcher = String(config.variables.tagged_companion);

    expect(matcher).toContain("for configured_name in companion_names");
    expect(matcher).toContain("configured_name | string | trim");
    expect(matcher).toContain("message_text | lower");
    expect(matcher).toContain('not match.name and name');
    expect(matcher).toContain('("@" ~ lowered_name) in haystack');
    expect(matcher).toContain('("@[" ~ lowered_name ~ "]") in haystack');
    expect(config.conditions).toEqual([
      {
        condition: "template",
        value_template: "{{ tagged_companion | string | length > 0 }}",
      },
    ]);
  });

  it("uses a timezone-aware event timestamp with a current-time fallback", () => {
    const timestamp = String(config.variables.received_at);

    expect(timestamp).toContain("trigger.event.data.timestamp");
    expect(timestamp).toContain("as_datetime(raw_timestamp, none)");
    expect(timestamp).toContain("parsed_timestamp.tzinfo is not none");
    expect(timestamp).toContain("parsed_timestamp.isoformat()");
    expect(timestamp).toContain("now().isoformat()");
  });

  it("keeps deterministic sender and channel fallbacks", () => {
    const sender = String(config.variables.sender_name);
    const channel = String(config.variables.channel_name);

    expect(sender).toContain('sender if sender else "Unknown"');
    expect(channel).toContain("channel {{ trigger.event.data.channel_idx }}");
    expect(channel).toContain("Unknown channel");
  });

  it("writes the card data contract before attempting optional notifications", () => {
    expect(config.variables.summary).toBe(
      "{{ sender_name }} on {{ channel_name }}: {{ message_text }}"
    );

    const todoAction = config.actions[0]!;
    expect(todoAction.action).toBe("todo.add_item");
    expect(inputReference((todoAction.target as Record<string, unknown>).entity_id)).toBe(
      "todo_entity"
    );
    expect(todoAction.data).toEqual({
      item: "{{ summary }}",
      description: "meshcore_received_at: {{ received_at }}",
    });

    const optionalNotification = config.actions[1]!;
    expect(optionalNotification.if).toEqual([
      {
        condition: "template",
        value_template: "{{ notification_targets | length > 0 }}",
      },
    ]);
    const notificationAction = (optionalNotification.then as Array<Record<string, unknown>>)[0]!;
    expect(notificationAction).toMatchObject({
      action: "notify.send_message",
      continue_on_error: true,
      data: {
        title: "📡 MeshCore tag: {{ tagged_companion }}",
        message: "{{ summary }}",
      },
    });
    expect(
      inputReference((notificationAction.target as Record<string, unknown>).entity_id)
    ).toBe("notification_targets");
  });

  it("contains no user-specific automation values outside repository metadata", () => {
    const runtimeConfig = structuredClone(config) as BlueprintConfig;
    runtimeConfig.blueprint.author = "";
    runtimeConfig.blueprint.source_url = "";
    const runtimeSource = JSON.stringify(runtimeConfig).toLowerCase();

    expect(runtimeSource).not.toContain("shaun");
    expect(runtimeSource).not.toContain("2wenty2wo");
    expect(runtimeSource).not.toContain("notify.mobile_app");
    expect(runtimeSource).not.toContain("todo.meshcore_tags");
  });
});
