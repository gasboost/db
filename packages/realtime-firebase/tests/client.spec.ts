import { describe, expect, it, vi } from "vitest";
import { versionPath } from "../src/client";
import { FirebaseRtdb } from "../src";

describe("browser client", () => {
  it("returns the notification path without GAS globals", () => {
    expect(versionPath("employees")).toBe("/syncVersions/employees");
    expect(versionPath("departments")).toBe("/syncVersions/departments");
  });

  it("matches the path published by the backend", () => {
    const patch = vi.fn();
    const rtdb = new FirebaseRtdb({
      versionStore: { next: () => 42 },
      transport: { patch },
    });
    rtdb.publish([{ table: "employees" }]);
    expect(patch).toHaveBeenCalledExactlyOnceWith({
      [versionPath("employees").slice(1)]: 42,
    });
  });
});
