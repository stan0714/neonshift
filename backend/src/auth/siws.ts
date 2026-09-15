/**
 * Sign In With Solana 訊息（SD 4.2）。格式沿用 phantom/solana-labs 的 SIWS ABNF：
 *
 *   ${domain} wants you to sign in with your Solana account:
 *   ${address}
 *
 *   ${statement}
 *
 *   URI: ${uri}
 *   Version: 1
 *   Chain ID: ${chainId}
 *   Nonce: ${nonce}
 *   Issued At: ${issuedAt}
 *   Expiration Time: ${expirationTime}
 *   Request ID: ${requestId}
 *
 * 後端只信任自己重建／解析後的欄位，不信任 client 另傳的 wallet。
 */
export type SiwsFields = {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  version: "1";
  chainId: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
  requestId: string;
};

export function buildSiwsMessage(f: SiwsFields): string {
  return [
    `${f.domain} wants you to sign in with your Solana account:`,
    f.address,
    "",
    f.statement,
    "",
    `URI: ${f.uri}`,
    `Version: ${f.version}`,
    `Chain ID: ${f.chainId}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
    `Expiration Time: ${f.expirationTime}`,
    `Request ID: ${f.requestId}`,
  ].join("\n");
}

const HEADER = /^(?<domain>[^\s]+) wants you to sign in with your Solana account:$/;

/** 嚴格解析；任何欄位缺漏或順序不符即回 null（不猜測） */
export function parseSiwsMessage(message: string): SiwsFields | null {
  const lines = message.split("\n");
  if (lines.length !== 12) return null;
  const header = HEADER.exec(lines[0]!);
  if (!header?.groups?.domain) return null;
  const address = lines[1]!;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return null;
  if (lines[2] !== "" || lines[4] !== "") return null;
  const statement = lines[3]!;
  const kv = (line: string | undefined, key: string): string | null => {
    if (!line || !line.startsWith(`${key}: `)) return null;
    return line.slice(key.length + 2);
  };
  const uri = kv(lines[5], "URI");
  const version = kv(lines[6], "Version");
  const chainId = kv(lines[7], "Chain ID");
  const nonce = kv(lines[8], "Nonce");
  const issuedAt = kv(lines[9], "Issued At");
  const expirationTime = kv(lines[10], "Expiration Time");
  const requestId = kv(lines[11], "Request ID");
  if (!uri || version !== "1" || !chainId || !nonce || !issuedAt || !expirationTime || !requestId) return null;
  return { domain: header.groups.domain, address, statement, uri, version: "1", chainId, nonce, issuedAt, expirationTime, requestId };
}
