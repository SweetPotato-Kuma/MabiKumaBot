import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "./env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

function readString(name, fallback = "") {
  return (process.env[name] ?? fallback).trim();
}

function readRequiredString(name) {
  const value = readString(name);
  if (!value) {
    throw new ConfigError(`${name} 환경 변수가 필요합니다.`);
  }
  return value;
}

function readNumber(name, fallback, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  const raw = readString(name, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new ConfigError(`${name} 값은 ${min} 이상 ${max} 이하의 숫자여야 합니다. 현재 값: ${raw}`);
  }
  return value;
}

function readBoolean(name, fallback = false) {
  const raw = readString(name, String(fallback)).toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(raw);
}

function readDiscordToken() {
  const token = readString("DISCORD_BOT_TOKEN") || readString("TOKEN");
  if (!token) {
    throw new ConfigError("TOKEN 또는 DISCORD_BOT_TOKEN 환경 변수가 필요합니다.");
  }
  return token;
}

function parseCsv(raw) {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getConfig({ requireClientId = false } = {}) {
  loadEnvFile(path.join(projectRoot, ".env"));

  const clientId = readString("DISCORD_CLIENT_ID");

  if (requireClientId && !clientId) {
    throw new ConfigError("DISCORD_CLIENT_ID 환경 변수가 필요합니다.");
  }

  return {
    projectRoot,
    dataDir: path.join(projectRoot, "data"),
    itemsFile: path.join(projectRoot, "data", "items.json"),
    settingsFile: path.join(projectRoot, "data", "settings.json"),
    discordToken: readDiscordToken(),
    discordClientId: clientId,
    discordGuildId: readString("DISCORD_GUILD_ID"),
    discordChannelId: readString("DISCORD_CHANNEL_ID"),
    mabinogiApiKey: readString("MABINOGI_API_KEY") || readString("API_KEY"),
    initialItems: parseCsv(readString("MABINOGI_ITEMS")),
    checkIntervalMs: readNumber("CHECK_INTERVAL_SECONDS", 10, { min: 1 }) * 1000,
    requestTimeoutMs: readNumber("REQUEST_TIMEOUT_SECONDS", 10, { min: 1 }) * 1000,
    alertDiscountThreshold: readNumber("ALERT_DISCOUNT_THRESHOLD", 0.1, { min: 0, max: 1 }),
    alertCooldownMs: readNumber("ALERT_COOLDOWN_SECONDS", 3600, { min: 0 }) * 1000,
    autoDeployCommands: readBoolean("AUTO_DEPLOY_COMMANDS", true),
    nexonApiEndpoint: readString(
      "MABINOGI_AUCTION_ENDPOINT",
      "https://open.api.nexon.com/mabinogi/v1/auction/keyword-search",
    ),
  };
}
