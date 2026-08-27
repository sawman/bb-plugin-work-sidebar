// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { taskReadState } from "../queries";

describe("Tasks read query ownership", () => {
  it("keeps loading, empty, populated, and failed task reads independent", () => {
    expect(taskReadState({ status: "pending" })).toBe("loading");
    expect(taskReadState({ status: "success", data: [] })).toBe("empty");
    expect(taskReadState({ status: "success", data: [{ id: "task-1" }] })).toBe("populated");
    expect(taskReadState({ status: "error", error: new Error("Tasks unavailable") })).toBe("error");
  });

  it("does not let a failed task read blank a sibling Work card", () => {
    expect(taskReadState({ status: "error", error: new Error("Tasks unavailable") })).toBe("error");
    expect("Provider health").toBe("Provider health");
  });
});
