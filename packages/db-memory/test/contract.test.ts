import { runAdapterContractTests } from "@quickben/adapter-tests";
import { describe, expect, it } from "vitest";

import { memoryAdapter } from "../src";

runAdapterContractTests(() => memoryAdapter());

describe("memoryAdapter", () => {
  it("is named memory", () => {
    expect(memoryAdapter().name).toBe("memory");
  });
});
