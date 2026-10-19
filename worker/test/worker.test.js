import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { handleCommand } from "../src/commands.js";
import { erinClock, formatErinClock } from "../src/erin.js";
import worker from "../src/index.js";

const encoder = new TextEncoder();
const hex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

async function signer() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = hex(await crypto.subtle.exportKey("raw", pair.publicKey));
  const sign = async (body, timestamp = "1700000000") => ({
    "x-signature-timestamp": timestamp,
    "x-signature-ed25519": hex(await crypto.subtle.sign("Ed25519", pair.privateKey, encoder.encode(timestamp + body))),
  });
  return { publicKey, sign };
}

async function call(env, body, headers) {
  return worker.fetch(new Request("https://bot.example/", { method: "POST", body, headers }), env);
}

describe("서명 확인", () => {
  it("서명이 맞는 PING 에 PONG 으로 답한다", async () => {
    const { publicKey, sign } = await signer();
    const body = JSON.stringify({ type: 1 });
    const response = await call({ DISCORD_PUBLIC_KEY: publicKey }, body, await sign(body));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { type: 1 });
  });

  it("본문이 바뀌었거나 서명이 없거나 다른 키로 서명하면 거절한다", async () => {
    const { publicKey, sign } = await signer();
    const other = await signer();
    const body = JSON.stringify({ type: 1 });
    const env = { DISCORD_PUBLIC_KEY: publicKey };

    assert.equal((await call(env, `${body} `, await sign(body))).status, 401);
    assert.equal((await call(env, body, {})).status, 401);
    assert.equal((await call(env, body, await other.sign(body))).status, 401);
    assert.equal((await call({ DISCORD_PUBLIC_KEY: "zz" }, body, await sign(body))).status, 401);
  });

  it("POST 가 아니면 거절한다", async () => {
    const response = await worker.fetch(new Request("https://bot.example/"), { DISCORD_PUBLIC_KEY: "00" });
    assert.equal(response.status, 405);
  });
});

describe("명령", () => {
  const command = (name, sub) => ({ type: 2, data: { name, options: sub ? [{ type: 1, name: sub }] : [] } });

  it("/구마 에린 은 에린 시각과 상점 교체까지 남은 시간을 알려 준다", async () => {
    const { publicKey, sign } = await signer();
    const body = JSON.stringify(command("구마", "에린"));
    const response = await call({ DISCORD_PUBLIC_KEY: publicKey }, body, await sign(body));
    const reply = await response.json();

    assert.equal(reply.type, 4);
    assert.match(reply.data.content, /에린 시각 \*\*\d{2}:\d{2}\*\* \((낮|밤)\)/);
    assert.match(reply.data.content, /다음 상점 교체까지/);
  });

  it("직접 잰 게임 시계와 맞는다", () => {
    const kst = (time) => Date.parse(`2026-10-19T${time}+09:00`);
    assert.equal(formatErinClock(erinClock(kst("09:54:21"))), "00:10");
    assert.equal(formatErinClock(erinClock(kst("09:54:51"))), "00:30");

    const reply = handleCommand(command("구마", "에린"), kst("09:54:21"));
    assert.match(reply.data.content, /00:10\*\* \(밤\)/);
  });

  it("모르는 명령은 본인에게만 보이게 안내한다", () => {
    const reply = handleCommand(command("구마", "없는명령"));
    assert.equal(reply.data.flags, 64);
  });
});
