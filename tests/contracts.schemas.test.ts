import { describe, expect, it } from "vitest";
import { rpcSchemas } from "../contracts.schemas";
import {
  trackerContextSchema,
  trackerItemSchema,
  trackerStatusOptionSchema,
} from "../features/tracker/schemas";

describe("Work outcome RPC schema", () => {
  it("requires the legacy discovery context on every response", () => {
    const result = rpcSchemas.getWorkOutcome.output.safeParse({
      tasksAvailable: true,
      outcome: null,
      executionTasks: [],
      bindings: [],
    });

    expect(result.success).toBe(false);
  });
});

describe("R32.2 outcome and tracker RPC schemas", () => {
  it("accepts only the optional BB Task priority vocabulary when creating an outcome", () => {
    expect(
      rpcSchemas.createWorkTask.input.safeParse({
        threadId: "thr_root",
        title: "Create from Linear",
        priority: "urgent",
      }).success,
    ).toBe(true);
    expect(
      rpcSchemas.ensureOutcomeContext.input.safeParse({
        rootThreadId: "thr_root",
        title: "Create from Linear",
        priority: "unexpected",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields from every browser-safe tracker projection", () => {
    const item = {
      key: "LIN-1",
      title: "Tracker work",
      url: "https://linear.app/issue/LIN-1",
      status: "Todo",
      stateCategory: "todo" as const,
      priority: null,
      assignee: null,
      project: null,
    };
    expect(trackerItemSchema.safeParse({ ...item, leaked: true }).success).toBe(false);
    expect(
      trackerStatusOptionSchema.safeParse({
        id: "todo",
        name: "Todo",
        current: true,
        leaked: true,
      }).success,
    ).toBe(false);
    expect(
      trackerContextSchema.safeParse({
        visible: true,
        available: true,
        message: null,
        primaryKey: null,
        suggestions: [],
        items: [],
        leaked: true,
      }).success,
    ).toBe(false);
  });

  it("exposes a strict primary-Linear mutation contract", () => {
    expect(
      rpcSchemas.setPrimaryLinearIssue.input.safeParse({
        threadId: "thr_root",
        key: "LIN-2",
      }).success,
    ).toBe(true);
    expect(
      rpcSchemas.setPrimaryLinearIssue.input.safeParse({
        threadId: "thr_root",
        key: "LIN-2",
        leaked: true,
      }).success,
    ).toBe(false);
  });
});

describe("R37.2 bounded text-scale RPC schema", () => {
  it("accepts only strict bounded appearance updates and returns both preferences", () => {
    expect(
      rpcSchemas.saveSidebarAppearance.input.safeParse({ textScale: 0.9 })
        .success,
    ).toBe(true);
    expect(
      rpcSchemas.saveSidebarAppearance.input.safeParse({
        textScale: 1.11,
      }).success,
    ).toBe(false);
    expect(
      rpcSchemas.saveSidebarAppearance.input.safeParse({
        textScale: 1.001,
      }).success,
    ).toBe(false);
    expect(
      rpcSchemas.saveSidebarAppearance.input.safeParse({ textScale: 1, leaked: true })
        .success,
    ).toBe(false);
    expect(
      rpcSchemas.saveSidebarAppearance.input.safeParse({}).success,
    ).toBe(false);
    expect(
      rpcSchemas.getSidebarAppearance.output.safeParse({
        rowHeight: 40,
        textScale: 1.1,
      }).success,
    ).toBe(true);
  });
});
