import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildTelegramDigest,
  emptyAlertState,
  sendTelegramMessage,
  type AlertState,
} from "../src/laptop/telegram";
import type { LaptopDataset } from "../src/laptop/types";

const ROOT = process.cwd();
const DATASET_PATH = path.join(ROOT, "public", "data", "laptop-listings.json");
const STATE_PATH = path.join(ROOT, "data", "laptop-alert-state.json");
const DASHBOARD_URL =
  process.env.LAPTOP_DASHBOARD_URL ?? "https://laptopscraper.vercel.app";

async function readState(): Promise<AlertState> {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8")) as AlertState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyAlertState();
    throw error;
  }
}

async function writeState(state: AlertState): Promise<void> {
  const temporaryPath = `${STATE_PATH}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, STATE_PATH);
}

export async function runLaptopAlerts(args = process.argv.slice(2)): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const dataset = JSON.parse(await readFile(DATASET_PATH, "utf8")) as LaptopDataset;
  const state = await readState();
  const digest = buildTelegramDigest(dataset, state, DASHBOARD_URL);

  if (dryRun) {
    process.stdout.write(`${digest.html}\n`);
    return;
  }

  if (dataset.refreshStatus === "cached-fallback") {
    process.stdout.write("Skipping Telegram: collection used the cached fallback.\n");
    return;
  }
  if (!digest.shouldSend) {
    process.stdout.write("Skipping Telegram: this snapshot was already sent.\n");
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required");
  }

  const { messageId } = await sendTelegramMessage({
    token,
    chatId,
    html: digest.html,
  });
  await writeState({
    schemaVersion: 1,
    seenEligibleIds: digest.currentEligibleIds,
    lastSnapshotHash: digest.snapshotHash,
    lastSentAt: new Date().toISOString(),
    lastMessageId: messageId,
  });
  process.stdout.write(`Sent Telegram laptop update (message ${messageId}).\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLaptopAlerts().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
