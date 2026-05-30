import fs from "node:fs/promises";
import path from "node:path";

const MIN_ALERT_DISCOUNT_PERCENT = 10;
const MAX_ALERT_DISCOUNT_PERCENT = 100;

function normalizeChannelId(value) {
  return String(value ?? "").trim();
}

function normalizeAlertDiscountPercent(value) {
  const percent = Number(value);
  if (!Number.isInteger(percent) || percent < MIN_ALERT_DISCOUNT_PERCENT || percent > MAX_ALERT_DISCOUNT_PERCENT) {
    return null;
  }

  return percent;
}

function normalizeUsers(rawUsers) {
  if (!rawUsers || typeof rawUsers !== "object" || Array.isArray(rawUsers)) {
    return {};
  }

  const users = {};
  for (const [userId, rawUserSettings] of Object.entries(rawUsers)) {
    if (!userId || !rawUserSettings || typeof rawUserSettings !== "object" || Array.isArray(rawUserSettings)) {
      continue;
    }

    const userSettings = {};
    const alertChannelId = normalizeChannelId(rawUserSettings.alertChannelId);
    const alertDiscountPercent = normalizeAlertDiscountPercent(rawUserSettings.alertDiscountPercent);

    if (alertChannelId) {
      userSettings.alertChannelId = alertChannelId;
    }

    if (alertDiscountPercent !== null) {
      userSettings.alertDiscountPercent = alertDiscountPercent;
    }

    users[userId] = userSettings;
  }

  return users;
}

export class SettingsStore {
  constructor({ filePath, initialSettings = {} }) {
    this.filePath = filePath;
    this.settings = { ...initialSettings, users: normalizeUsers(initialSettings.users) };
    this.loaded = false;
  }

  async load() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.settings = {
        ...this.settings,
        ...parsed,
        users: normalizeUsers(parsed.users),
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    if (!this.settings.users || typeof this.settings.users !== "object" || Array.isArray(this.settings.users)) {
      this.settings.users = {};
    }

    this.loaded = true;
  }

  getAlertChannelId(userId = null) {
    this.assertLoaded();
    const userChannelId = userId ? this.settings.users?.[userId]?.alertChannelId : "";
    return userChannelId || this.settings.alertChannelId || "";
  }

  getCheckIntervalMs(fallbackMs) {
    this.assertLoaded();
    const value = Number(this.settings.checkIntervalMs);
    return Number.isFinite(value) && value >= 1000 ? value : fallbackMs;
  }

  getAlertDiscountPercent(userId, fallbackPercent) {
    this.assertLoaded();
    const userPercent = normalizeAlertDiscountPercent(this.settings.users?.[userId]?.alertDiscountPercent);
    if (userPercent !== null) {
      return userPercent;
    }

    const globalPercent = normalizeAlertDiscountPercent(this.settings.alertDiscountPercent);
    if (globalPercent !== null) {
      return globalPercent;
    }

    return normalizeAlertDiscountPercent(fallbackPercent) ?? MIN_ALERT_DISCOUNT_PERCENT;
  }

  async setAlertChannelId(userId, channelId) {
    this.assertLoaded();
    const normalizedChannelId = normalizeChannelId(channelId);

    if (!userId) {
      this.settings.alertChannelId = normalizedChannelId;
      await this.save();
      return;
    }

    this.ensureUserSettings(userId);
    this.settings.users[userId].alertChannelId = normalizedChannelId;
    await this.save();
  }

  async setCheckIntervalMs(intervalMs) {
    this.assertLoaded();
    this.settings.checkIntervalMs = intervalMs;
    await this.save();
  }

  async setAlertDiscountPercent(userId, percent) {
    this.assertLoaded();
    const normalizedPercent = normalizeAlertDiscountPercent(percent);
    if (normalizedPercent === null) {
      throw new Error(
        `Alert discount percent must be an integer between ${MIN_ALERT_DISCOUNT_PERCENT} and ${MAX_ALERT_DISCOUNT_PERCENT}.`,
      );
    }

    this.ensureUserSettings(userId);
    this.settings.users[userId].alertDiscountPercent = normalizedPercent;
    await this.save();
  }

  async clearAlertChannelId(userId = null) {
    this.assertLoaded();

    if (!userId) {
      delete this.settings.alertChannelId;
      await this.save();
      return;
    }

    this.ensureUserSettings(userId);
    delete this.settings.users[userId].alertChannelId;
    await this.save();
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const payload = JSON.stringify(
      {
        ...this.settings,
        users: this.settings.users ?? {},
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    );
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, `${payload}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
  }

  ensureUserSettings(userId) {
    if (!userId) {
      throw new Error("Discord user id is required for user-scoped settings.");
    }

    if (!this.settings.users) {
      this.settings.users = {};
    }

    if (!this.settings.users[userId]) {
      this.settings.users[userId] = {};
    }
  }

  assertLoaded() {
    if (!this.loaded) {
      throw new Error("SettingsStore.load() must be called before using the store.");
    }
  }
}
