import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { erinClock, formatErinClock } from "../src/erin.js";
import worker from "../src/index.js";
import { fakeSite, click, slash } from "./helpers.js";

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

const call = (env, body, headers, ctx) =>
  worker.fetch(new Request("https://bot.example/", { method: "POST", body, headers }), env, ctx);

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

  it("서명이 맞는 명령과 단추는 화면으로 답한다", async () => {
    const { publicKey, sign } = await signer();
    const env = { DISCORD_PUBLIC_KEY: publicKey, SITE: fakeSite() };
    const send = async (interaction) => {
      const body = JSON.stringify(interaction);
      return (await call(env, body, await sign(body), { waitUntil() {} })).json();
    };

    const menu = await send(slash());
    assert.equal(menu.type, 4);
    assert.match(menu.data.content, /마비쿠마/);
    assert.equal((await send(click("m:erin"))).type, 7);
  });

  it("처리 중으로 답하고 나머지는 ctx.waitUntil 로 마친다", async () => {
    const { publicKey, sign } = await signer();
    const site = fakeSite();
    await site.registerUser("111111111111111111", "v");
    const env = { DISCORD_PUBLIC_KEY: publicKey, SITE: site, DISCORD_APPLICATION_ID: "app" };
    const real = globalThis.fetch;
    const edits = [];
    globalThis.fetch = async (url, init) => {
      edits.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response("{}");
    };
    const waited = [];
    try {
      const body = JSON.stringify(click("m:fav"));
      const response = await call(env, body, await sign(body), { waitUntil: (p) => waited.push(p) });
      assert.deepEqual(await response.json(), { type: 6 });

      await Promise.all(waited);
      assert.equal(edits.length, 1);
      assert.match(edits[0].url, /\/webhooks\/app\/interaction-token\/messages\/@original$/);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("에린 시계", () => {
  it("직접 잰 게임 시계와 맞는다", () => {
    const kst = (time) => Date.parse(`2026-10-19T${time}+09:00`);
    assert.equal(formatErinClock(erinClock(kst("09:54:21"))), "00:10");
    assert.equal(formatErinClock(erinClock(kst("09:54:51"))), "00:30");
  });
});
