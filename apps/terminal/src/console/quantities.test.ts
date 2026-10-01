import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration } from "./quantities";

describe("console quantities", () => {
  it("OWN-AC-12: formats byte sizes in binary units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(8_192)).toBe("8.0 KiB");
    expect(formatBytes(13_002_342)).toBe("12.4 MiB");
    expect(formatBytes(-1)).toBe("—");
  });

  it("OWN-AC-12: formats uptimes", () => {
    expect(formatDuration(12)).toBe("12s");
    expect(formatDuration(257)).toBe("4m 17s");
    expect(formatDuration(7_500)).toBe("2h 5m");
    expect(formatDuration(273_600)).toBe("3d 4h");
  });
});
