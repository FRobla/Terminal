import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, REDACTION_CENSOR } from "./logger";
import { runWithRequestContext } from "./request-context";

function capture() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, logger: createLogger({ service: "test", level: "debug", destination }) };
}

const SECRETS = {
  privateKey: "PRIVATE-KEY-VALUE",
  secretKey: "SECRET-KEY-VALUE",
  seed: "SEED-VALUE",
  mnemonic: "MNEMONIC-VALUE",
  passphrase: "PASSPHRASE-VALUE",
  password: "PASSWORD-VALUE",
  apiKey: "API-KEY-VALUE",
  authorization: "Bearer TOKEN-VALUE",
  cookie: "sct_session=COOKIE-VALUE",
};

describe("createLogger", () => {
  it("FND-AC-05: redacts secret fields at the top level and when nested", () => {
    const { lines, logger } = capture();
    logger.info({ ...SECRETS, nested: { ...SECRETS, deeper: { ...SECRETS } } }, "secret test");
    logger.info({ headers: { "set-cookie": "sct_session=SET-COOKIE-VALUE" } }, "header test");
    const output = lines.join("\n");
    for (const value of [...Object.values(SECRETS), "sct_session=SET-COOKIE-VALUE"]) {
      expect(output).not.toContain(value);
    }
    expect(output).toContain(REDACTION_CENSOR);
  });

  it("FND-AC-04: includes the request context in every line", () => {
    const { lines, logger } = capture();
    runWithRequestContext({ requestId: "req-abcdefgh", traceId: "trace-1", operation: "GET /x" }, () => {
      logger.info("inside");
    });
    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry.requestId).toBe("req-abcdefgh");
    expect(entry.traceId).toBe("trace-1");
    expect(entry.operation).toBe("GET /x");
    expect(entry.service).toBe("test");
  });
});
