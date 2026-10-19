/**
 * 디스코드가 보낸 요청인지 서명(Ed25519)으로 확인한다. 서명 대상은 타임스탬프 헤더와 본문을 이은 글자다.
 * 확인하지 못한 요청은 처리하지 않는다.
 */

const encoder = new TextEncoder();

function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function importPublicKey(publicKeyHex) {
  const raw = hexToBytes(publicKeyHex);
  if (!raw) {
    return null;
  }
  // 예전 Workers 는 NODE-ED25519 라는 이름만 알았다. 표준 이름이 되지 않으면 그 이름으로 다시 해 본다.
  try {
    return await crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
  } catch {
    return crypto.subtle.importKey(
      "raw",
      raw,
      { name: "NODE-ED25519", namedCurve: "NODE-ED25519" },
      false,
      ["verify"],
    );
  }
}

/** 서명이 맞으면 읽은 본문 글자를, 아니면 null 을 돌려준다. */
export async function readVerifiedBody(request, publicKeyHex) {
  const signature = hexToBytes(request.headers.get("x-signature-ed25519"));
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!signature || !timestamp) {
    return null;
  }

  const body = await request.text();
  try {
    const key = await importPublicKey(publicKeyHex);
    if (!key) {
      return null;
    }
    const algorithm = key.algorithm.name;
    const ok = await crypto.subtle.verify(algorithm, key, signature, encoder.encode(timestamp + body));
    return ok ? body : null;
  } catch {
    return null;
  }
}
