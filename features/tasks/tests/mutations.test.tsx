// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { taskMutationPlan } from "../mutations";

describe("Tasks mutations", () => {
  it("characterizes operation ownership, exact invalidation keys, and optimistic scope", () => {
    expect(taskMutationPlan.create).toMatchObject({ optimistic: false, cancel: ["list"], invalidate: ["list", "links"] });
    expect(taskMutationPlan.delete).toMatchObject({ optimistic: false, cancel: ["list"], invalidate: ["list", "links"] });
    expect(taskMutationPlan.attach).toMatchObject({ optimistic: false, cancel: ["list", "links"], invalidate: ["list", "links"] });
    expect(taskMutationPlan.detach).toMatchObject({ optimistic: false, cancel: ["list", "links"], invalidate: ["list", "links"] });
    expect(taskMutationPlan.assignment).toMatchObject({ optimistic: true, cancel: ["list"], invalidate: ["list"] });
    expect(taskMutationPlan.reorder).toMatchObject({ optimistic: true, cancel: ["list"], invalidate: ["list"] });
  });

  it("requires rollback snapshots only for reversible assignment and sibling ordering", () => {
    expect(taskMutationPlan.assignment.rollback).toBe(true);
    expect(taskMutationPlan.reorder.rollback).toBe(true);
    expect(taskMutationPlan.create.rollback).toBe(false);
    expect(taskMutationPlan.delete.rollback).toBe(false);
    expect(taskMutationPlan.attach.rollback).toBe(false);
    expect(taskMutationPlan.detach.rollback).toBe(false);
  });
});
