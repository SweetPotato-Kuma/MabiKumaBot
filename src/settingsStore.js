import fs from "node:fs/promises";
import path from "node:path";

export class SettingsStore {
  constructor({ filePath, initialSettings = {} }) {
    this.filePath = filePath;
    this.settings = { ...initialSettings };
    this.loaded = false;
  }

  async load() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.settings = { ...this.settings, ...parsed };
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    this.loaded = true;
  }

  getAlertChannelId() {
    this.assertLoaded();
    return this.settings.alertChannelId ?? "";
  }

  async setAlertChannelId(channelId) {
    this.assertLoaded();
    this.settings.alertChannelId = channelId;
    await this.save();
  }

  async clearAlertChannelId() {
    this.assertLoaded();
    delete this.settings.alertChannelId;
    await this.save();
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const payload = JSON.stringify(
      {
        ...this.settings,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    );
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, `${payload}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
  }

  assertLoaded() {
    if (!this.loaded) {
      throw new Error("SettingsStore.load() must be called before using the store.");
    }
  }
}
