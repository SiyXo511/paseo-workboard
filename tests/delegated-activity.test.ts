import { expect, it } from "vitest";
import { settingsSchema } from "../shared/model";
import { fixture, workspace } from "./fixtures";

function delegatedFixture(autoMove: boolean) {
  const test = fixture({
    settings: settingsSchema.parse({ autoMoveInProgressToReview: autoMove }),
  });
  test.inventory.workspaces.push(
    workspace("w", "Workspace", ["task:in-progress"]),
  );
  test.inventory.agents.push(
    {
      id: "parent",
      workspaceId: "w",
      title: "Parent",
      updatedAt: "2026-09-23T00:00:00Z",
      lastUserMessageAt: null,
      archivedAt: null,
      activity: "idle",
    },
    {
      id: "child",
      workspaceId: "w",
      title: "Delegated",
      updatedAt: "2026-09-23T01:00:00Z",
      lastUserMessageAt: null,
      archivedAt: null,
      activity: "attention",
      delegatedBy: "parent",
    },
  );
  return test;
}

it("ignores delegated subagents when projecting workspace activity", async () => {
  const test = delegatedFixture(false);
  try {
    await test.board.start();
    expect(test.board.snapshot().cards[0].activity).toBe("idle");
  } finally {
    test.board.dispose();
  }
});

it("does not move Review for delegated unread output", async () => {
  const test = delegatedFixture(true);
  try {
    await test.board.start();
    test.completeTurn("w", "child");
    await test.board.refresh();
    expect(test.board.snapshot().cards[0].stage).toBe("in-progress");
    expect(test.host.setLabel).not.toHaveBeenCalled();
  } finally {
    test.board.dispose();
  }
});
