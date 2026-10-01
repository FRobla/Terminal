/**
 * Sign-In With Solana message format, matching the text wallets produce for
 * `solana:signIn` (ABNF used by `@solana/wallet-standard-util`). The same text is
 * used for the `signMessage` fallback, so both paths verify identically.
 */
export interface SiwsFields {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  version: string;
  chainId: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}

const HEADER_SUFFIX = " wants you to sign in with your Solana account:";

export function buildSiwsMessage(fields: SiwsFields): string {
  let message = `${fields.domain}${HEADER_SUFFIX}\n${fields.address}`;
  if (fields.statement) message += `\n\n${fields.statement}`;
  const lines = [
    `URI: ${fields.uri}`,
    `Version: ${fields.version}`,
    `Chain ID: ${fields.chainId}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt}`,
    `Expiration Time: ${fields.expirationTime}`,
  ];
  return `${message}\n\n${lines.join("\n")}`;
}

export type ParsedSiwsMessage = Partial<SiwsFields> & { domain: string; address: string };

const FIELD_NAMES: Record<string, keyof SiwsFields> = {
  URI: "uri",
  Version: "version",
  "Chain ID": "chainId",
  Nonce: "nonce",
  "Issued At": "issuedAt",
  "Expiration Time": "expirationTime",
};

/** Parses a signed SIWS message. Returns null when the text is not a SIWS message. */
export function parseSiwsMessage(text: string): ParsedSiwsMessage | null {
  const lines = text.split("\n");
  const header = lines[0];
  const address = lines[1];
  if (!header?.endsWith(HEADER_SUFFIX) || !address) return null;
  const parsed: ParsedSiwsMessage = { domain: header.slice(0, -HEADER_SUFFIX.length), address };

  let index = 2;
  // Optional statement: an empty line, the statement, then an empty line before the fields.
  if (
    lines[index] === "" &&
    lines[index + 1] !== undefined &&
    !/^[A-Za-z ]+: /.test(lines[index + 1] ?? "")
  ) {
    parsed.statement = lines[index + 1] ?? "";
    index += 2;
  }
  if (lines[index] === "") index += 1;

  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const separator = line.indexOf(": ");
    if (separator === -1) return null;
    const name = FIELD_NAMES[line.slice(0, separator)];
    // Fields this terminal never requests (Not Before, Request ID, Resources) make the message invalid.
    if (!name) return null;
    parsed[name] = line.slice(separator + 2);
  }
  return parsed;
}

/** Returns the names of fields that differ between the signed message and the issued challenge. */
export function diffSiwsFields(signed: ParsedSiwsMessage, expected: SiwsFields): string[] {
  return (Object.keys(expected) as Array<keyof SiwsFields>).filter(
    (key) => (signed[key] ?? "") !== expected[key],
  );
}
