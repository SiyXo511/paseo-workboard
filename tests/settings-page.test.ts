import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  boardSchema,
  newTask,
  settingsSchema,
  type Board,
  type Settings,
} from "../shared/model";
import { strings } from "../client/strings";
import { migrateData } from "../shared/migrations";
import { fixture, workspace, agentEvidence, observed } from "./fixtures";

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useRef: <T>(initial: T) => {
      const index = hooks.cursor++;
      if (index >= hooks.values.length)
        hooks.values[index] = { current: initial };
      return hooks.values[index] as { current: T };
    },
    useState: <T>(initial: T | (() => T)) => {
      const index = hooks.cursor++;
      const values = hooks.values;
      if (index >= hooks.values.length)
        values[index] =
          typeof initial === "function" ? (initial as () => T)() : initial;
      const setValue = (next: T | ((current: T) => T)) => {
        values[index] =
          typeof next === "function"
            ? (next as (current: T) => T)(values[index] as T)
            : next;
      };
      return [values[index] as T, setValue] as const;
    },
  };
});

vi.mock("@getpaseo/plugin/client", () => ({ useRpc: vi.fn() }));
vi.mock("@getpaseo/plugin/client/react-native", () => {
  const component = () => null;
  return {
    Icon: component,
    Modal: component,
    ScrollView: component,
    TextInput: component,
    useToast: vi.fn(),
  };
});
vi.mock("@getpaseo/plugin/client/ui", () => {
  const component = () => null;
  return {
    ExternalLink: component,
    SettingsCard: component,
    SettingsAction: component,
    SettingsInput: component,
    SettingsRow: component,
    SettingsSection: component,
    SettingsSelect: component,
    SettingsSwitch: component,
  };
});

import { ArchivePage, TaskCard, SettingsPage } from "../client/WorkboardScreen";

beforeEach(() => {
  hooks.cursor = 0;
  hooks.values = [];
});

function findElement(
  node: ReactNode,
  matches: (element: ReactElement<Record<string, unknown>>) => boolean,
  description: string,
): ReactElement<Record<string, unknown>> {
  if (!node || typeof node !== "object")
    throw new Error(`${description} not found`);
  const element = node as ReactElement<{
    children?: ReactNode;
    [key: string]: unknown;
  }>;
  if (matches(element)) return element;
  const children = Array.isArray(element.props.children)
    ? element.props.children
    : [element.props.children];
  for (const child of children.flat()) {
    try {
      return findElement(child, matches, description);
    } catch {
      // Keep searching siblings.
    }
  }
  throw new Error(`${description} not found`);
}

const findByTestId = (node: ReactNode, testID: string) =>
  findElement(node, (element) => element.props.testID === testID, testID);

const theme = {
  colors: {
    accent: "#000000",
    accentForeground: "#ffffff",
    foreground: "#111111",
    foregroundMuted: "#777777",
    statusDanger: "#cc0000",
    statusWarning: "#aa7700",
    surface0: "#ffffff",
  },
} as never;
const t = strings("zh");

function renderSettings(
  board: Board,
  mutate: Parameters<typeof SettingsPage>[0]["mutate"],
  localized = t,
) {
  hooks.cursor = 0;
  return SettingsPage({
    board,
    t: localized,
    theme,
    disabled: false,
    saving: false,
    mutate,
    onBack: vi.fn(),
  });
}

function board(
  settings = settingsSchema.parse({}),
  cards: Board["cards"] = [],
) {
  return boardSchema.parse({
    revision: 7,
    serverId: "host",
    version: "0.10.0-beta.1",
    connected: true,
    error: null,
    refreshedAt: null,
    settings,
    cards,
    projects: [],
  });
}

it.each([
  ["automatic archive", "workboard-auto-archive", "autoArchive", true],
  [
    "In progress sidebar pinning",
    "workboard-pin-in-progress",
    "pinInProgressWorkspaces",
    false,
  ],
  [
    "exclusive status labels",
    "workboard-exclusive-status-labels",
    "exclusiveStatusLabels",
    true,
  ],
] as const)(
  "persists %s when its switch changes and keeps it after reopening",
  async (_, testID, key, value) => {
    const settings = settingsSchema.parse({
      autoArchive: false,
      pinInProgressWorkspaces: true,
    });
    const initial = board(settings);
    const saved = {
      ...initial,
      revision: 8,
      settings: { ...settings, [key]: value },
    };
    const mutate = vi.fn().mockResolvedValue(saved);
    const screen = renderSettings(initial, mutate);

    const toggle = findByTestId(screen, testID);
    await (
      toggle.props as { onValueChange(nextValue: boolean): Promise<void> }
    ).onValueChange(value);

    expect(mutate).toHaveBeenCalledWith(
      {
        action: "settings",
        revision: 7,
        expectedSettings: settings,
        settings: { ...settings, [key]: value },
      },
      key === "autoArchive"
        ? "settings:archive"
        : key === "exclusiveStatusLabels"
          ? "settings:exclusive"
          : "settings:pin",
    );
    expect(
      findByTestId(renderSettings(initial, mutate), testID).props.value,
    ).toBe(value);

    hooks.values = [];
    expect(
      findByTestId(renderSettings(saved, mutate), testID).props.value,
    ).toBe(value);
  },
);

it("keeps automatic archive off when saving fails", async () => {
  const initial = board(settingsSchema.parse({ autoArchive: false }));
  const mutate = vi.fn().mockResolvedValue(undefined);
  const toggle = findByTestId(
    renderSettings(initial, mutate),
    "workboard-auto-archive",
  );

  await (
    toggle.props as { onValueChange(nextValue: boolean): Promise<void> }
  ).onValueChange(true);

  expect(
    findByTestId(renderSettings(initial, mutate), "workboard-auto-archive")
      .props.value,
  ).toBe(false);
});

it("adopts a completed save after leaving and reopening while it is pending", async () => {
  const settings = settingsSchema.parse({ autoArchive: false });
  const initial = board(settings);
  const saved = {
    ...initial,
    revision: 8,
    settings: { ...settings, autoArchive: true },
  };
  let finish!: (result: Board) => void;
  const mutate = vi.fn(
    () =>
      new Promise<Board>((resolve) => {
        finish = resolve;
      }),
  );
  const toggle = findByTestId(
    renderSettings(initial, mutate),
    "workboard-auto-archive",
  );

  const pending = (
    toggle.props as { onValueChange(nextValue: boolean): Promise<void> }
  ).onValueChange(true);
  hooks.values = [];
  expect(
    findByTestId(renderSettings(initial, mutate), "workboard-auto-archive")
      .props.value,
  ).toBe(false);

  finish(saved);
  await pending;
  expect(
    findByTestId(renderSettings(saved, mutate), "workboard-auto-archive").props
      .value,
  ).toBe(true);
});

it("requires confirmation before enabling automatic archive with due workspaces", async () => {
  const settings = settingsSchema.parse({ autoArchive: false });
  const timestamp = "2026-01-01T00:00:00.000Z";
  const due = {
    ...newTask("task", "Due task", timestamp, "done"),
    workspaceId: "workspace",
    lastConversationAt: timestamp,
    conversationStatus: "known" as const,
    conversationDisplayEvidence: "exact" as const,
    conversationGateEvidence: "exact" as const,
    conversationGateAt: timestamp,
    stage: "done" as const,
    labels: ["task:done"],
    managedLabels: ["task:done"],
    changeRequest: null,
    changeRequestUnavailable: false,
    activity: "idle" as const,
    pinState: "none" as const,
    dueAt: timestamp,
    agents: [],
  };
  const initial = board(settings, [due]);
  const saved = {
    ...initial,
    revision: 8,
    settings: { ...settings, autoArchive: true },
  };
  const mutate = vi.fn().mockResolvedValue(saved);
  const toggle = findByTestId(
    renderSettings(initial, mutate),
    "workboard-auto-archive",
  );

  await (
    toggle.props as { onValueChange(nextValue: boolean): Promise<void> }
  ).onValueChange(true);
  expect(mutate).not.toHaveBeenCalled();

  const confirmation = findElement(
    renderSettings(initial, mutate),
    (element) => element.props.title === t.enableAutoArchive,
    "automatic archive confirmation",
  );
  await (confirmation.props as { onConfirm(): Promise<boolean> }).onConfirm();

  expect(mutate).toHaveBeenCalledWith(
    {
      action: "settings",
      revision: 7,
      expectedSettings: settings,
      settings: { ...settings, autoArchive: true },
    },
    "settings:archive",
  );
});

it.each(["zh", "en"] as const)(
  "offers both archive resolutions with concurrency fields in %s",
  async (language) => {
    const localized = strings(language);
    const test = board(settingsSchema.parse({}), [
      {
        ...newTask("task", "Task", "2026-08-01T00:00:00Z"),
        stage: "done",
        workspaceId: "w",
        labels: [],
        managedLabels: [],
        agents: [],
        changeRequest: null,
        changeRequestUnavailable: false,
        pinState: "none",
        activity: "idle",
        dueAt: null,
        archived: {
          operationId: "archive-op",
          kind: "automatic",
          status: "uncertain",
          stage: "done",
          group: null,
          startedAt: "2026-08-01T00:00:00Z",
          archivedAt: null,
          lastConversationAt: null,
          detail: "Unknown",
        },
      },
    ]);
    const mutate = vi.fn(async () => test);
    for (const outcome of ["confirm", "restore"] as const) {
      hooks.values = [];
      const render = () => {
        hooks.cursor = 0;
        return ArchivePage({
          board: test,
          cards: test.cards,
          t: localized,
          theme,
          disabled: false,
          mutate,
          onBack: vi.fn(),
        });
      };
      const label =
        outcome === "confirm"
          ? localized.confirmArchived
          : localized.restoreTask;
      const entry = findElement(
        render(),
        (node) => node.props.children === label,
        label,
      );
      expect(entry.props.children).toBe(label);
      const button = findElement(
        render(),
        (node) =>
          node.props.accessibilityRole === "button" &&
          typeof node.props.onPress === "function" &&
          (node.props.children as ReactElement<{ children?: ReactNode }>)?.props
            ?.children === label,
        label,
      );
      (button.props.onPress as () => void)();
      const confirmation = findElement(
        render(),
        (node) => node.props.confirmLabel === label,
        "confirmation",
      );
      await (confirmation.props.onConfirm as () => Promise<boolean>)();
      expect(mutate).toHaveBeenLastCalledWith({
        action: "resolve-archive",
        taskId: "task",
        operationId: "archive-op",
        updatedAt: test.cards[0].updatedAt,
        outcome,
      });
    }
  },
);

it("offers cancel binding on a card and respects disabled writes", () => {
  const test = board(settingsSchema.parse({}), [
    {
      ...newTask("task", "Task", "2026-08-01T00:00:00Z"),
      stage: "todo",
      labels: [],
      managedLabels: [],
      agents: [],
      changeRequest: null,
      changeRequestUnavailable: false,
      pinState: "none",
      activity: "idle",
      dueAt: null,
      binding: {
        operationId: "binding-op",
        workspaceId: null,
        stage: "in-progress",
        target: { kind: "existing", workspaceId: "w" },
      },
    },
  ]);
  const cancel = vi.fn();
  for (const disabled of [false, true]) {
    hooks.cursor = 0;
    const tree = TaskCard({
      card: test.cards[0],
      board: test,
      t,
      theme,
      disabled,
      pending: false,
      onOpen: vi.fn(),
      onEdit: vi.fn(),
      onStart: vi.fn(),
      onStatus: vi.fn(),
      onArchive: vi.fn(),
      onCancelBinding: cancel,
      onDetachDraft: vi.fn(),
    });
    const button = findElement(
      tree,
      (node) => node.props.accessibilityLabel === t.cancelBinding,
      "cancel binding",
    );
    expect(button.props.disabled).toBe(disabled);
    if (!disabled) (button.props.onPress as () => void)();
  }
  expect(cancel).toHaveBeenCalledTimes(1);
});

it.each(["zh", "en"] as const)(
  "saves independent archive rules and both default destinations in %s",
  async (language) => {
    const localized = strings(language);
    const settings = settingsSchema.parse({
      autoArchive: true,
      archiveAfterDays: 14,
      archiveCanceledAfterDays: 7,
      archiveDoneAfterDays: 90,
      archiveCanceledEnabled: true,
      archiveDoneEnabled: false,
    });
    const initial = board(settings);
    const mutate = vi.fn(async (input) => ({
      ...initial,
      revision: 8,
      settings: input.settings,
    }));
    const render = () => {
      hooks.cursor = 0;
      return SettingsPage({
        board: initial,
        t: localized,
        theme,
        disabled: false,
        saving: false,
        mutate,
        onBack: vi.fn(),
      });
    };
    expect(
      findByTestId(render(), "workboard-auto-archive-canceled").props.hint,
    ).toContain(localized.archiveRuleHint.replace("{days}", "7"));
    expect(
      findByTestId(render(), "workboard-auto-archive-done").props.hint,
    ).toBeUndefined();
    expect(
      findByTestId(render(), "workboard-auto-archive-done").props.value,
    ).toBe(false);
    const input = findByTestId(render(), "workboard-archive-canceled-days");
    expect(input.props.value).toBe("7");
    (input.props.onChangeText as (value: string) => void)("0");
    expect(
      findByTestId(render(), "workboard-save-archive-canceled-days").props
        .disabled,
    ).toBe(true);
    (input.props.onChangeText as (value: string) => void)("21");
    await (
      findByTestId(render(), "workboard-save-archive-canceled-days").props
        .onPress as () => Promise<void>
    )();
    expect(mutate).toHaveBeenLastCalledWith(
      {
        action: "settings",
        revision: 7,
        expectedSettings: settings,
        settings: { ...settings, archiveCanceledAfterDays: 21 },
      },
      "settings:canceled-archive-days",
    );
    for (const [testID, key, value] of [
      ["workboard-default-draft", "defaultDraftGroup", "todo"],
      ["workboard-default-workspace", "defaultStartGroup", "review"],
    ] as const) {
      const before = mutate.mock.results.at(-1)
        ? (await mutate.mock.results.at(-1)!.value).settings
        : settings;
      await (
        findByTestId(render(), testID).props.onValueChange as (
          value: string,
        ) => Promise<void>
      )(value);
      expect(mutate).toHaveBeenLastCalledWith(
        {
          action: "settings",
          revision: 8,
          expectedSettings: before,
          settings: { ...before, [key]: value },
        },
        key === "defaultDraftGroup"
          ? "settings:draft-default"
          : "settings:workspace-default",
      );
    }
    for (const kind of ["done", "canceled"] as const) {
      expect(localized.groupTypeHints[kind]).not.toContain("{days}");
    }
  },
);

it.each(["zh", "en"] as const)(
  "enables and disables Done and Canceled archive rules independently in %s",
  async (language) => {
    const localized = strings(language);
    const settings = settingsSchema.parse({
      autoArchive: true,
      archiveCanceledEnabled: true,
      archiveDoneEnabled: false,
    });
    const initial = board(settings);
    const saved = {
      ...initial,
      revision: 8,
      settings: { ...settings, archiveDoneEnabled: true },
    };
    const mutate = vi.fn().mockResolvedValue(saved);
    const toggle = findByTestId(
      SettingsPage({
        board: initial,
        t: localized,
        theme,
        disabled: false,
        saving: false,
        mutate,
        onBack: vi.fn(),
      }),
      "workboard-auto-archive-done",
    );

    await (
      toggle.props as { onValueChange(nextValue: boolean): Promise<void> }
    ).onValueChange(true);

    expect(mutate).toHaveBeenCalledWith(
      {
        action: "settings",
        revision: 7,
        expectedSettings: settings,
        settings: { ...settings, archiveDoneEnabled: true },
      },
      "settings:done-archive",
    );
  },
);

it("offers only restoration for an archived draft and sends its concurrency fields", async () => {
  const test = board(settingsSchema.parse({}), []);
  const task = {
    ...newTask("draft", "Draft", "2026-09-01T00:00:00Z", "canceled"),
    archived: {
      operationId: "archive-draft",
      kind: "draft",
      status: "archived",
      stage: "canceled",
      group: null,
      startedAt: "2026-09-01T00:00:00Z",
      archivedAt: "2026-09-01T00:00:00Z",
      lastConversationAt: null,
      detail: "Archived draft",
    },
    stage: "canceled",
    labels: [],
    managedLabels: [],
    agents: [],
    changeRequest: null,
    changeRequestUnavailable: false,
    pinState: "none",
    activity: "idle",
    dueAt: null,
  };
  test.cards = boardSchema.shape.cards.parse([task]);
  const mutate = vi.fn(async () => test);
  const render = () => {
    hooks.cursor = 0;
    return ArchivePage({
      board: test,
      cards: test.cards,
      t,
      theme,
      disabled: false,
      mutate,
      onBack: vi.fn(),
    });
  };
  const button = findElement(
    render(),
    (node) =>
      node.props.accessibilityRole === "button" &&
      (node.props.children as ReactElement<{ children?: ReactNode }>)?.props
        ?.children === t.restoreTask,
    "restore draft",
  );
  expect(() =>
    findElement(
      render(),
      (node) => node.props.children === t.confirmArchived,
      "confirm archive",
    ),
  ).toThrow();
  (button.props.onPress as () => void)();
  const confirmation = findElement(
    render(),
    (node) => node.props.confirmLabel === t.restoreTask,
    "restore confirmation",
  );
  await (confirmation.props.onConfirm as () => Promise<boolean>)();
  expect(mutate).toHaveBeenCalledWith({
    action: "resolve-archive",
    taskId: "draft",
    operationId: "archive-draft",
    updatedAt: task.updatedAt,
    outcome: "restore",
  });
});

it("offers a separate detach entry for each merged source on the card", () => {
  const source = (draftId: string) => ({
    draftId,
    title: draftId,
    description: "Plan",
    mergedAt: "2026-09-01T00:00:00Z",
    appendedText: `\n\n[${draftId}]\nPlan`,
  });
  const test = board(settingsSchema.parse({}), []);
  test.cards = boardSchema.shape.cards.parse([
    {
      ...newTask("task", "Task", "2026-09-01T00:00:00Z"),
      workspaceId: "w",
      mergedDrafts: [source("one"), source("two")],
      stage: "todo",
      labels: [],
      managedLabels: [],
      agents: [],
      changeRequest: null,
      changeRequestUnavailable: false,
      pinState: "none",
      activity: "idle",
      dueAt: null,
    },
  ]);
  const detach = vi.fn();
  const tree = TaskCard({
    card: test.cards[0],
    board: test,
    t,
    theme,
    disabled: false,
    pending: false,
    onOpen: vi.fn(),
    onEdit: vi.fn(),
    onStart: vi.fn(),
    onStatus: vi.fn(),
    onArchive: vi.fn(),
    onCancelBinding: vi.fn(),
    onDetachDraft: detach,
  });
  for (const id of ["one", "two"])
    (
      findElement(
        tree,
        (node) => node.props.accessibilityLabel === `${t.detachDraft}: ${id}`,
        id,
      ).props.onPress as () => void
    )();
  expect(detach.mock.calls).toEqual([["one"], ["two"]]);
});

it("excludes terminal default destinations and displays safe fallback for an existing terminal choice", () => {
  const initial = board(settingsSchema.parse({ defaultStartGroup: "done" }));
  const select = findByTestId(
    renderSettings(initial, vi.fn()),
    "workboard-default-workspace",
  );
  expect(select.props.value).toBe("");
  expect(
    (select.props.options as Array<{ value: string }>).map(
      (option) => option.value,
    ),
  ).toEqual(["", "inbox", "todo", "in-progress", "review"]);
});

it.each(["zh", "en"] as const)(
  "explains migration-paused archive and requires the existing due-task confirmation in %s",
  async (language) => {
    const localized = strings(language);
    const migrated = migrateData(
      {
        schemaVersion: 6,
        settings: {
          autoArchive: true,
          groups: settingsSchema
            .parse({})
            .groups.filter((g) => g.kind !== "canceled"),
        },
      },
      6,
    );
    const test = fixture(migrated);
    test.inventory.workspaces.push(
      workspace("w", "Existing label", ["task:canceled"]),
    );
    test.inventory.agents.push({
      id: "a",
      workspaceId: "w",
      title: null,
      activity: "idle",
      updatedAt: "2026-08-01T00:00:00Z",
      lastUserMessageAt: "2026-08-01T00:00:00Z",
    });
    test.host.conversation = agentEvidence("2026-08-01T00:00:00Z");
    const time = vi.spyOn(Date, "now").mockReturnValue(test.now());
    try {
      await test.board.start();
      const initial = test.board.snapshot();
      const mutate = vi.fn((input) => test.board.mutate(input));
      const render = () => {
        hooks.cursor = 0;
        return SettingsPage({
          board: initial,
          t: localized,
          theme,
          disabled: false,
          saving: false,
          mutate,
          onBack: vi.fn(),
        });
      };
      const toggle = findByTestId(render(), "workboard-auto-archive");
      expect(toggle.props.value).toBe(false);
      expect(
        elementText(
          findByTestId(render(), "workboard-archive-migration-notice"),
        ),
      ).toContain(localized.autoArchiveMigrationPaused);
      await (toggle.props.onValueChange as (value: boolean) => Promise<void>)(
        true,
      );
      expect(mutate).not.toHaveBeenCalled();
      expect(test.host.archive).not.toHaveBeenCalled();
      const confirmation = findElement(
        render(),
        (node) => node.props.title === localized.enableAutoArchive,
        "due archive confirmation",
      );
      expect(confirmation.props.description).toBe(
        localized.enableAutoArchiveConfirm
          .replace("{count}", "1")
          .replace("{canceled}", "1")
          .replace("{done}", "0"),
      );
      await (confirmation.props.onConfirm as () => Promise<boolean>)();
      await test.board.refresh();
      expect(test.host.archive).toHaveBeenCalledExactlyOnceWith("w");
      expect(test.store.current.settings.archiveMappingNeedsReview).toBe(false);
      expect(() =>
        findByTestId(render(), "workboard-archive-migration-notice"),
      ).toThrow("not found");
    } finally {
      time.mockRestore();
      test.board.dispose();
    }
  },
);

it.each(["zh", "en"] as const)(
  "F05-R01 settings expose only In progress choices and persist an independent default in %s",
  async (language) => {
    const settings = settingsSchema.parse({
      defaultStartGroup: "review",
      groups: [
        ...settingsSchema.parse({}).groups,
        {
          id: "working-two",
          kind: "in-progress",
          name: "Second",
          label: "task:working-two",
        },
      ],
    });
    const initial = board(settings);
    const saved = {
      ...initial,
      revision: 8,
      settings: { ...settings, defaultStartWorkGroup: "working-two" },
    };
    const mutate = vi.fn().mockResolvedValue(saved);
    hooks.cursor = 0;
    const tree = SettingsPage({
      board: initial,
      t: strings(language),
      theme,
      disabled: false,
      saving: false,
      mutate,
      onBack: vi.fn(),
    });
    const select = findByTestId(tree, "workboard-default-start-work");
    expect(select.props.label).toBe(
      strings(language).defaultStartWorkGroupSetting,
    );
    expect(
      (select.props.options as { value: string }[]).map((item) => item.value),
    ).toEqual(["", "in-progress", "working-two"]);
    await (select.props.onValueChange as (value: string) => Promise<void>)(
      "working-two",
    );
    expect(mutate).toHaveBeenCalledWith(
      {
        action: "settings",
        revision: 7,
        expectedSettings: settings,
        settings: saved.settings,
      },
      "settings:start-work-default",
    );
    hooks.values = [];
    expect(
      findByTestId(
        renderSettings(saved, mutate),
        "workboard-default-start-work",
      ).props.value,
    ).toBe("working-two");
    expect(saved.settings.defaultStartGroup).toBe("review");
  },
);
it("F05-R01 displays a safe automatic choice for a persisted invalid start-work default", () => {
  const initial = board(
    settingsSchema.parse({ defaultStartWorkGroup: "done" }),
  );
  const select = findByTestId(
    renderSettings(initial, vi.fn()),
    "workboard-default-start-work",
  );
  expect(select.props.value).toBe("");
});

const archiveFixtures: ReturnType<typeof fixture>[] = [];
afterEach(() => {
  for (const test of archiveFixtures.splice(0)) test.board.dispose();
  vi.restoreAllMocks();
});

async function archiveSettingsFixture(
  settings: Partial<Settings> = {},
  conversationAt = "2026-08-01T00:00:00Z",
) {
  const test = fixture({
    settings: settingsSchema.parse({
      autoArchive: true,
      archiveDoneEnabled: false,
      archiveCanceledEnabled: false,
      ...settings,
    }),
  });
  archiveFixtures.push(test);
  for (const kind of ["done", "canceled"] as const) {
    test.inventory.workspaces.push(workspace(kind, kind, [`task:${kind}`]));
    test.inventory.agents.push({
      id: `${kind}-agent`,
      workspaceId: kind,
      title: null,
      activity: "idle",
      updatedAt: conversationAt,
      lastUserMessageAt: conversationAt,
    });
  }
  test.host.conversation = agentEvidence(conversationAt);
  vi.spyOn(Date, "now").mockReturnValue(test.now());
  await test.board.start();
  let snapshot = test.board.snapshot();
  const mutate = vi.fn<Parameters<typeof SettingsPage>[0]["mutate"]>((input) =>
    test.board.mutate(input),
  );
  const render = () => renderSettings(snapshot, mutate);
  return {
    ...test,
    mutate,
    render,
    refreshView: () => {
      snapshot = test.board.snapshot();
    },
    toggle: async (control: string, value: boolean) =>
      (
        findByTestId(render(), `workboard-${control}`).props.onValueChange as (
          value: boolean,
        ) => Promise<void>
      )(value),
    days: async (kind: string, value: string) => {
      (
        findByTestId(render(), `workboard-archive-${kind}-days`).props
          .onChangeText as (value: string) => void
      )(value);
      await (
        findByTestId(render(), `workboard-save-archive-${kind}-days`).props
          .onPress as () => Promise<void>
      )();
    },
    confirmation: () =>
      findElement(
        render(),
        (element) => element.props.title === t.enableAutoArchive,
        "archive settings confirmation",
      ),
  };
}

it.each(["done", "canceled"] as const)(
  "previews overdue %s under the proposed rule, cancels without writes, then confirms the full settings",
  async (kind) => {
    const test = await archiveSettingsFixture();
    const settings = test.store.current.settings;
    await test.toggle(`auto-archive-${kind}`, true);
    expect(test.mutate).not.toHaveBeenCalled();
    expect(test.store.current.settings).toEqual(settings);
    await test.board.refresh();
    expect(test.host.archive).not.toHaveBeenCalled();
    expect(test.confirmation().props.description).toBe(
      t.enableAutoArchiveConfirm
        .replace("{count}", "1")
        .replace("{done}", kind === "done" ? "1" : "0")
        .replace("{canceled}", kind === "canceled" ? "1" : "0"),
    );
    (test.confirmation().props.onClose as () => void)();
    expect(() => test.confirmation()).toThrow("not found");
    await test.board.refresh();
    expect(test.mutate).not.toHaveBeenCalled();
    expect(test.host.archive).not.toHaveBeenCalled();
    await test.toggle(`auto-archive-${kind}`, true);
    expect(
      await (test.confirmation().props.onConfirm as () => Promise<boolean>)(),
    ).toBe(true);
    const key =
      kind === "done" ? "archiveDoneEnabled" : "archiveCanceledEnabled";
    expect(test.store.current.settings).toEqual({ ...settings, [key]: true });
    await test.board.refresh();
    expect(test.host.archive).toHaveBeenCalledExactlyOnceWith(kind);
  },
);

it.each(["done", "canceled"] as const)(
  "confirms a shorter %s waiting period using its new due count and saves the proposed delay",
  async (kind) => {
    const test = await archiveSettingsFixture({
      archiveDoneEnabled: true,
      archiveCanceledEnabled: true,
      archiveDoneAfterDays: 90,
      archiveCanceledAfterDays: 90,
    });
    const settings = test.store.current.settings;
    await test.days(kind, "30");
    expect(test.mutate).not.toHaveBeenCalled();
    expect(test.confirmation().props.description).toBe(
      t.enableAutoArchiveConfirm
        .replace("{count}", "1")
        .replace("{done}", kind === "done" ? "1" : "0")
        .replace("{canceled}", kind === "canceled" ? "1" : "0"),
    );
    await (test.confirmation().props.onConfirm as () => Promise<boolean>)();
    const key =
      kind === "done" ? "archiveDoneAfterDays" : "archiveCanceledAfterDays";
    expect(test.store.current.settings).toEqual({ ...settings, [key]: 30 });
    await test.board.refresh();
    expect(test.host.archive).toHaveBeenCalledExactlyOnceWith(kind);
  },
);

it("switching the master off pauses both rules and re-enabling confirms both due candidates", async () => {
  const test = await archiveSettingsFixture(
    {
      autoArchive: true,
      archiveDoneEnabled: true,
      archiveCanceledEnabled: true,
      archiveDoneAfterDays: 7,
      archiveCanceledAfterDays: 14,
    },
    "2026-09-22T00:00:00Z",
  );
  const enabledSettings = test.store.current.settings;
  await test.toggle("auto-archive", false);
  expect(test.store.current.settings).toEqual({
    ...enabledSettings,
    autoArchive: false,
  });
  test.host.conversation = agentEvidence("2026-08-01T00:00:00Z");
  for (const agent of test.inventory.agents) {
    agent.updatedAt = "2026-08-01T00:00:00Z";
    agent.lastUserMessageAt = "2026-08-01T00:00:00Z";
  }
  await test.board.refresh();
  test.refreshView();
  expect(test.host.archive).not.toHaveBeenCalled();
  test.mutate.mockClear();
  await test.toggle("auto-archive", true);
  expect(test.mutate).not.toHaveBeenCalled();
  expect(test.confirmation().props.description).toBe(
    t.enableAutoArchiveConfirm
      .replace("{count}", "2")
      .replace("{done}", "1")
      .replace("{canceled}", "1"),
  );
  const rows = findByTestId(test.confirmation(), "workboard-archive-candidates")
    .props.children as ReactElement[];
  expect(rows).toHaveLength(2);
  expect(rows.map(elementText)).toEqual([
    expect.stringContaining(t.stages.done),
    expect.stringContaining(t.stages.canceled),
  ]);
  (test.confirmation().props.onClose as () => void)();
  expect(test.store.current.settings.autoArchive).toBe(false);
  expect(test.mutate).not.toHaveBeenCalled();
  await test.toggle("auto-archive", true);
  await (test.confirmation().props.onConfirm as () => Promise<boolean>)();
  await test.board.refresh();
  expect(test.store.current.settings).toEqual(enabledSettings);
  expect(test.host.archive).toHaveBeenCalledTimes(2);
  expect(test.host.archive).toHaveBeenCalledWith("canceled");
  expect(test.host.archive).toHaveBeenCalledWith("done");
  expect(test.inventory.workspaces).toEqual([]);
});

it.each([
  [true, false],
  [false, true],
  [true, true],
])(
  "master off collapses both rules and retains Done=%s Canceled=%s",
  async (done, canceled) => {
    const test = await archiveSettingsFixture({
      autoArchive: false,
      archiveDoneEnabled: done,
      archiveCanceledEnabled: canceled,
      archiveDoneAfterDays: 7,
      archiveCanceledAfterDays: 14,
    });
    const before = test.store.current.settings;
    expect(
      findByTestId(test.render(), "workboard-auto-archive").props.disabled,
    ).toBe(false);
    expect(() =>
      findByTestId(test.render(), "workboard-auto-archive-rules"),
    ).toThrow("not found");
    await test.board.refresh();
    expect(test.store.current.settings).toEqual(before);
    expect(test.mutate).not.toHaveBeenCalled();
    expect(test.host.archive).not.toHaveBeenCalled();
    await test.toggle("auto-archive", true);
    expect(() =>
      findByTestId(test.render(), "workboard-auto-archive-rules"),
    ).toThrow("not found");
    (test.confirmation().props.onClose as () => void)();
    expect(test.store.current.settings).toEqual(before);
  },
);

it("saves enabling rules with no overdue tasks without confirmation", async () => {
  const test = await archiveSettingsFixture({}, "2026-09-22T00:00:00Z");
  await test.toggle("auto-archive-done", true);
  await test.toggle("auto-archive-canceled", true);
  await test.board.refresh();
  expect(test.store.current.settings).toMatchObject({
    archiveDoneEnabled: true,
    archiveCanceledEnabled: true,
  });
  expect(() => test.confirmation()).toThrow("not found");
  expect(test.host.archive).not.toHaveBeenCalled();
});

it("saves disabling rules and the master without confirmation even when tasks are overdue", async () => {
  const test = await archiveSettingsFixture();
  test.host.safety = async () => "git-dirty";
  const initial = test.board.snapshot();
  await test.board.mutate({
    action: "settings",
    revision: initial.revision,
    expectedSettings: initial.settings,
    settings: {
      ...initial.settings,
      archiveDoneEnabled: true,
      archiveCanceledEnabled: true,
    },
  });
  test.refreshView();
  await test.toggle("auto-archive-done", false);
  await test.toggle("auto-archive-canceled", false);
  await test.toggle("auto-archive", false);
  expect(test.store.current.settings).toMatchObject({
    autoArchive: false,
    archiveDoneEnabled: false,
    archiveCanceledEnabled: false,
  });
  expect(() => test.confirmation()).toThrow("not found");
  expect(test.host.archive).not.toHaveBeenCalled();
});

it("invalidates confirmation when another client changes settings and requires a fresh preview", async () => {
  const test = await archiveSettingsFixture();
  await test.toggle("auto-archive-done", true);
  const initial = test.board.snapshot();
  await test.board.mutate({
    action: "settings",
    revision: initial.revision,
    expectedSettings: initial.settings,
    settings: {
      ...initial.settings,
      archiveDoneAfterDays: 1,
      exclusiveStatusLabels: true,
    },
  });
  test.refreshView();
  expect(() => test.confirmation()).toThrow("not found");
  expect(test.mutate).not.toHaveBeenCalled();
  await test.toggle("auto-archive-done", true);
  await (test.confirmation().props.onConfirm as () => Promise<boolean>)();
  expect(test.store.current.settings).toMatchObject({
    archiveDoneAfterDays: 1,
    exclusiveStatusLabels: true,
    archiveDoneEnabled: true,
  });
});

it("retains expectedSettings when a concurrent change has not reached the client", async () => {
  const test = await archiveSettingsFixture();
  await test.toggle("auto-archive-done", true);
  const initial = test.board.snapshot();
  await test.board.mutate({
    action: "settings",
    revision: initial.revision,
    expectedSettings: initial.settings,
    settings: { ...initial.settings, pinInProgressWorkspaces: false },
  });
  await expect(
    (test.confirmation().props.onConfirm as () => Promise<boolean>)(),
  ).rejects.toThrow("Settings changed");
  expect(test.store.current.settings).toMatchObject({
    pinInProgressWorkspaces: false,
    archiveDoneEnabled: false,
  });
  await test.board.refresh();
  expect(test.host.archive).not.toHaveBeenCalled();
});

it("blocks repeated archive saves while pending and keeps the proposed settings after failure", async () => {
  const test = await archiveSettingsFixture();
  await test.toggle("auto-archive-done", true);
  let finish!: (value: undefined) => void;
  test.mutate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const confirm = test.confirmation().props.onConfirm as () => Promise<boolean>;
  const pending = confirm();
  expect(await confirm()).toBe(false);
  expect(test.mutate).toHaveBeenCalledTimes(1);
  finish(undefined);
  expect(await pending).toBe(false);
  expect(test.store.current.settings.archiveDoneEnabled).toBe(false);
  expect(test.host.archive).not.toHaveBeenCalled();
  expect(
    await (test.confirmation().props.onConfirm as () => Promise<boolean>)(),
  ).toBe(true);
  await test.board.refresh();
  expect(test.host.archive).toHaveBeenCalledExactlyOnceWith("done");
});

it("unlocks archive confirmation after an exception without saving the proposed rule", async () => {
  const test = await archiveSettingsFixture();
  await test.toggle("auto-archive-canceled", true);
  test.mutate.mockRejectedValueOnce(new Error("write failed"));
  await expect(
    (test.confirmation().props.onConfirm as () => Promise<boolean>)(),
  ).rejects.toThrow("write failed");
  expect(test.store.current.settings.archiveCanceledEnabled).toBe(false);
  expect(test.host.archive).not.toHaveBeenCalled();
  expect(
    await (test.confirmation().props.onConfirm as () => Promise<boolean>)(),
  ).toBe(true);
  await test.board.refresh();
  expect(test.host.archive).toHaveBeenCalledExactlyOnceWith("canceled");
});

it("blocks repeated immediate archive saves before a rerender", async () => {
  const test = await archiveSettingsFixture({}, "2026-09-22T00:00:00Z");
  let finish!: () => void;
  const released = new Promise<void>((resolve) => {
    finish = resolve;
  });
  test.mutate.mockImplementationOnce(async (input) => {
    await released;
    return test.board.mutate(input);
  });
  const toggle = findByTestId(test.render(), "workboard-auto-archive-done")
    .props.onValueChange as (value: boolean) => Promise<void>;
  const pending = toggle(true);
  for (const control of ["auto-archive", "auto-archive-canceled"]) {
    expect(
      findByTestId(test.render(), `workboard-${control}`).props.disabled,
    ).toBe(true);
  }
  expect(
    findByTestId(test.render(), "workboard-pin-in-progress").props.disabled,
  ).toBe(false);
  await toggle(true);
  expect(test.mutate).toHaveBeenCalledTimes(1);
  finish();
  await pending;
  expect(test.store.current.settings.archiveDoneEnabled).toBe(true);
  expect(test.host.archive).not.toHaveBeenCalled();
});

it("hides a disabled rule's delay and saves a longer active delay without confirmation", async () => {
  const test = await archiveSettingsFixture({
    archiveCanceledEnabled: true,
    archiveCanceledAfterDays: 90,
  });
  expect(() =>
    findByTestId(test.render(), "workboard-archive-done-days"),
  ).toThrow("not found");
  await test.days("canceled", "120");
  expect(test.store.current.settings).toMatchObject({
    archiveDoneEnabled: false,
    archiveDoneAfterDays: null,
    archiveCanceledAfterDays: 120,
  });
  expect(() => test.confirmation()).toThrow("not found");
  await test.board.refresh();
  expect(test.host.archive).not.toHaveBeenCalled();
});

it("keeps a valid confirmation across board refreshes with unchanged settings", async () => {
  const test = await archiveSettingsFixture();
  await test.toggle("auto-archive-done", true);
  await test.board.refresh();
  test.refreshView();
  expect(
    await (test.confirmation().props.onConfirm as () => Promise<boolean>)(),
  ).toBe(true);
  await test.board.refresh();
  expect(test.host.archive).toHaveBeenCalledExactlyOnceWith("done");
});

it("clears a confirmed delay edit so an external reset cannot revive the old draft", async () => {
  const test = await archiveSettingsFixture({
    archiveDoneEnabled: true,
    archiveDoneAfterDays: 90,
  });
  test.host.safety = async () => "git-dirty";
  await test.days("done", "30");
  await (test.confirmation().props.onConfirm as () => Promise<boolean>)();
  const saved = test.board.snapshot();
  await test.board.mutate({
    action: "settings",
    revision: saved.revision,
    expectedSettings: saved.settings,
    settings: { ...saved.settings, archiveDoneAfterDays: 90 },
  });
  test.refreshView();
  expect(
    findByTestId(test.render(), "workboard-archive-done-days").props.value,
  ).toBe("90");
  expect(
    findByTestId(test.render(), "workboard-save-archive-done-days").props
      .disabled,
  ).toBe(true);
});

function elementText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(elementText).join(" ");
  if (node && typeof node === "object" && "props" in node)
    return elementText(
      (node as ReactElement<{ children?: ReactNode }>).props.children,
    );
  return "";
}

it("lists only the proposed rule's due workspaces with their state and proposed deadline", async () => {
  const test = await archiveSettingsFixture();
  await test.toggle("auto-archive-done", true);
  const list = findByTestId(
    test.confirmation(),
    "workboard-archive-candidates",
  );
  const rows = list.props.children as ReactElement[];
  expect(rows).toHaveLength(1);
  expect(elementText(rows[0])).toContain("done");
  expect(elementText(rows[0])).toContain(t.stages.done);
  expect(elementText(rows[0])).not.toContain("canceled");
  expect(elementText(rows[0])).toContain("30");
  expect(elementText(rows[0])).toContain(
    new Intl.DateTimeFormat(t.locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date("2026-08-31T00:00:00Z")),
  );
  expect(rows[0].props).toMatchObject({ role: "listitem" });
  expect(list.props).toMatchObject({
    role: "list",
    accessibilityLabel: t.archiveCandidates,
  });
  expect(test.mutate).not.toHaveBeenCalled();
});

it("lists both states without truncation in a bounded scroll area", async () => {
  const test = await archiveSettingsFixture({
    autoArchive: false,
    archiveDoneEnabled: true,
    archiveCanceledEnabled: true,
  });
  for (let index = 0; index < 40; index++) {
    const kind = index % 2 ? "done" : "canceled";
    const id = `many-${index}`;
    test.inventory.workspaces.push(
      workspace(id, `Synthetic task ${index}`, [`task:${kind}`]),
    );
    test.inventory.agents.push({
      id: `a-${id}`,
      workspaceId: id,
      title: null,
      activity: "idle",
      updatedAt: "2026-08-01T00:00:00Z",
      lastUserMessageAt: "2026-08-01T00:00:00Z",
    });
  }
  await test.board.refresh();
  test.refreshView();
  await test.toggle("auto-archive", true);
  const confirmation = test.confirmation();
  expect(confirmation.props.description).toContain("42");
  expect(confirmation.props.scrollable).toBe(false);
  const list = findByTestId(confirmation, "workboard-archive-candidates");
  const rows = list.props.children as ReactElement[];
  expect(rows).toHaveLength(42);
  for (let index = 0; index < 40; index++)
    expect(elementText(rows[index + 2])).toContain(`Synthetic task ${index}`);
  expect(elementText(list)).toContain(t.stages.done);
  expect(elementText(list)).toContain(t.stages.canceled);
  expect(list.props.style).toMatchObject({ maxHeight: expect.any(Number) });
});

it("refreshes the list to empty when conversation evidence changes while confirmation is open", async () => {
  const test = await archiveSettingsFixture();
  await test.toggle("auto-archive-done", true);
  expect(
    findByTestId(test.confirmation(), "workboard-archive-candidates").props
      .children,
  ).toHaveLength(1);
  test.host.conversation = agentEvidence("2026-09-22T00:00:00Z");
  await test.board.refresh();
  test.refreshView();
  expect(elementText(test.confirmation())).toContain(t.archiveCandidatesEmpty);
  expect(() =>
    findByTestId(test.confirmation(), "workboard-archive-candidates"),
  ).toThrow("not found");
  expect(test.mutate).not.toHaveBeenCalled();
});

it("does not retain a candidate list after concurrent settings invalidate its confirmation", async () => {
  const test = await archiveSettingsFixture();
  await test.toggle("auto-archive-done", true);
  expect(elementText(test.confirmation())).toContain("done");
  const initial = test.board.snapshot();
  await test.board.mutate({
    action: "settings",
    revision: initial.revision,
    expectedSettings: initial.settings,
    settings: { ...initial.settings, archiveDoneAfterDays: 90 },
  });
  test.refreshView();
  expect(() =>
    findByTestId(test.render(), "workboard-archive-candidates"),
  ).toThrow("not found");
  await test.toggle("auto-archive-canceled", true);
  const rows = findByTestId(test.confirmation(), "workboard-archive-candidates")
    .props.children as ReactElement[];
  expect(rows).toHaveLength(1);
  expect(elementText(rows[0])).toContain("canceled");
  expect(elementText(rows[0])).not.toContain("done");
});

it.each(["zh", "en"] as const)(
  "labels conservative conversation evidence accurately in %s",
  async (language) => {
    const test = await archiveSettingsFixture();
    const at = "2026-08-01T00:00:00Z";
    test.host.conversation = async () => observed(at, { gate: "upper-bound" });
    await test.board.refresh();
    test.refreshView();
    await test.toggle("auto-archive-done", true);
    const localized = strings(language);
    const tree = renderSettings(test.board.snapshot(), test.mutate, localized);
    const list = findByTestId(tree, "workboard-archive-candidates");
    const date = new Intl.DateTimeFormat(localized.locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(at));
    expect(elementText(list)).toContain(
      localized.archiveCandidateUpperBound.replace("{date}", date),
    );
    expect(elementText(list)).not.toContain(
      localized.archiveCandidateExact.replace("{date}", date),
    );
    expect(elementText(list)).toContain(localized.stages.done);
  },
);

it.each(["zh", "en"] as const)(
  "groups archive settings under a standalone master and two subordinate rules in %s",
  (language) => {
    const localized = strings(language);
    const tree = renderSettings(
      board(settingsSchema.parse({ autoArchive: true })),
      vi.fn(),
      localized,
    );
    const section = findByTestId(tree, "workboard-auto-archive-section");
    expect(section.props.title).toBe(localized.autoArchive);
    const master = findByTestId(section, "workboard-auto-archive-master");
    expect(findByTestId(master, "workboard-auto-archive").props.label).toBe(
      localized.autoArchiveMaster,
    );
    const rules = findByTestId(section, "workboard-auto-archive-rules");
    expect(() => findByTestId(rules, "workboard-auto-archive")).toThrow(
      "not found",
    );
    for (const kind of ["done", "canceled"] as const) {
      const rule = findByTestId(rules, `workboard-archive-rule-${kind}`);
      expect(
        findByTestId(rule, `workboard-auto-archive-${kind}`).props.disabled,
      ).toBe(false);
      expect(
        findByTestId(rule, `workboard-archive-${kind}-days`).props.editable,
      ).toBe(true);
    }
    expect(() => findByTestId(section, "workboard-default-draft")).toThrow(
      "not found",
    );
  },
);

it.each(["done", "canceled"] as const)(
  "%s rule collapses its wait controls and retains saved values and unsaved input across both toggles",
  async (kind) => {
    const test = await archiveSettingsFixture(
      {
        archiveDoneAfterDays: 7,
        archiveCanceledAfterDays: 14,
      },
      "2026-09-22T00:00:00Z",
    );
    const inputId = `workboard-archive-${kind}-days`;
    expect(() => findByTestId(test.render(), inputId)).toThrow("not found");
    await test.toggle(`auto-archive-${kind}`, true);
    const input = findByTestId(test.render(), inputId);
    expect(input.props.value).toBe(kind === "done" ? "7" : "14");
    (input.props.onChangeText as (text: string) => void)("31");
    await test.toggle(`auto-archive-${kind}`, false);
    expect(() => findByTestId(test.render(), inputId)).toThrow("not found");
    await test.toggle("auto-archive", false);
    expect(() =>
      findByTestId(test.render(), "workboard-auto-archive-rules"),
    ).toThrow("not found");
    await test.toggle("auto-archive", true);
    expect(
      findByTestId(test.render(), `workboard-auto-archive-${kind}`).props.value,
    ).toBe(false);
    expect(() => findByTestId(test.render(), inputId)).toThrow("not found");
    await test.toggle(`auto-archive-${kind}`, true);
    expect(findByTestId(test.render(), inputId).props.value).toBe("31");
    const other = kind === "done" ? "canceled" : "done";
    expect(() =>
      findByTestId(test.render(), `workboard-archive-${other}-days`),
    ).toThrow("not found");
    await (
      findByTestId(test.render(), `workboard-save-archive-${kind}-days`).props
        .onPress as () => Promise<void>
    )();
    expect(
      test.store.current.settings[
        kind === "done" ? "archiveDoneAfterDays" : "archiveCanceledAfterDays"
      ],
    ).toBe(31);
    expect(test.host.archive).not.toHaveBeenCalled();
  },
);

it.each(["zh", "en"] as const)(
  "shows each delay label once with its Save immediately right of the input in %s",
  (language) => {
    const localized = strings(language);
    const tree = renderSettings(
      board(settingsSchema.parse({ autoArchive: true })),
      vi.fn(),
      localized,
    );
    const section = findByTestId(tree, "workboard-auto-archive-section");
    expect(
      findByTestId(section, "workboard-auto-archive").props.hint,
    ).toBeUndefined();
    const rules = findByTestId(section, "workboard-auto-archive-rules");
    expect(rules.props.style).not.toHaveProperty("borderLeftWidth");
    const labels = (node: ReactNode): unknown[] => {
      if (Array.isArray(node)) return node.flatMap(labels);
      if (!node || typeof node !== "object" || !("props" in node)) return [];
      const props = (
        node as ReactElement<{ label?: string; children?: ReactNode }>
      ).props;
      return [...(props.label ? [props.label] : []), ...labels(props.children)];
    };
    for (const kind of ["done", "canceled"] as const) {
      const label =
        kind === "done"
          ? localized.archiveDoneAfterDays
          : localized.archiveCanceledAfterDays;
      expect(labels(section).filter((value) => value === label)).toHaveLength(
        1,
      );
      const row = findByTestId(section, `workboard-archive-${kind}-delay-row`);
      const controls = row.props.children as ReactElement<{
        style: object;
        children: ReactElement<Record<string, unknown>>[];
      }>;
      expect(controls.props.style).toMatchObject({
        flexDirection: "row",
        maxWidth: "100%",
      });
      expect(
        controls.props.children.map((child) => child.props.testID),
      ).toEqual([
        `workboard-archive-${kind}-days`,
        `workboard-save-archive-${kind}-days`,
      ]);
      expect(controls.props.children[1].props.accessibilityLabel).toBe(
        `${localized.save}: ${label}`,
      );
      expect(elementText(controls.props.children[1])).toBe(localized.save);
    }
  },
);
