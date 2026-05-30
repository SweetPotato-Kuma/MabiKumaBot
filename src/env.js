import { config as loadDotenv } from "dotenv";

export function loadEnvFile(filePath) {
  loadDotenv({ path: filePath, override: false, quiet: true });
}
