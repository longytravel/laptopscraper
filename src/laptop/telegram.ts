import { createHash } from "node:crypto";

import { assessBestBuy, rankBestBuys } from "./best-buy";
import type { LaptopDataset, LaptopListing } from "./types";

export interface AlertState {
  schemaVersion: 1;
  seenEligibleIds: string[];
  lastSnapshotHash: string | null;
  lastSentAt: string | null;
  lastMessageId: number | null;
}

export interface TelegramDigest {
  html: string;
  shouldSend: boolean;
  snapshotHash: string;
  currentEligibleIds: string[];
  newEligibleIds: string[];
}

export function emptyAlertState(): AlertState {
  return {
    schemaVersion: 1,
    seenEligibleIds: [],
    lastSnapshotHash: null,
    lastSentAt: null,
    lastMessageId: null,
  };
}

export function escapeTelegramHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function signedPercent(value: number): string {
  const rounded = Math.round(value - 100);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

function signedRatioPercent(value: number): string {
  const rounded = Math.round((value - 1) * 100);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

function listingBlock(listing: LaptopListing, isNew: boolean): string {
  const result = assessBestBuy(listing);
  const title = escapeTelegramHtml(listing.title);
  const url = escapeTelegramHtml(listing.listingUrl);
  const condition = escapeTelegramHtml(listing.condition ?? "Condition not stated");
  const confidence = listing.specConfidence;
  const rank = listing.sellerFeedbackPercent
    ? `${listing.sellerFeedbackPercent.toFixed(1)}% seller feedback`
    : "seller feedback unavailable";

  return [
    `${isNew ? "🆕 " : ""}<b>${title}</b> — £${listing.price.toFixed(0)}`,
    `Work performance ${signedPercent(result.workPerformance!)} vs your G16`,
    `Multi-core ${signedPercent(listing.cpuMultiPower!)} · single-thread ${signedPercent(listing.cpuSinglePower!)}`,
    `${listing.ramGb!}GB RAM · ${Math.round(listing.storageGb! / 1024)}TB storage · GPU passes the RTX 4060 floor`,
    `Work value ${signedRatioPercent(result.workValue!)} vs your G16`,
    `${condition} · ${confidence} evidence confidence · ${escapeTelegramHtml(rank)}`,
    `<a href="${url}">View on eBay</a>`,
  ].join("\n");
}

function snapshotHash(dataset: LaptopDataset, eligibleIds: string[]): string {
  const relevant = dataset.listings
    .filter((listing) => eligibleIds.includes(listing.id))
    .map((listing) => ({
      id: listing.id,
      price: listing.price,
      title: listing.title,
      listingUrl: listing.listingUrl,
      lastSeenAt: listing.lastSeenAt,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return createHash("sha256")
    .update(JSON.stringify({ generatedAt: dataset.generatedAt, relevant }))
    .digest("hex");
}

export function buildTelegramDigest(
  dataset: LaptopDataset,
  state: AlertState,
  dashboardUrl: string,
): TelegramDigest {
  const allEligible = dataset.listings.filter(
    (listing) => assessBestBuy(listing).eligible,
  );
  const currentEligibleIds = allEligible.map((listing) => listing.id).sort();
  const seen = new Set(state.seenEligibleIds);
  const newEligibleIds = currentEligibleIds.filter((id) => !seen.has(id));
  const newSet = new Set(newEligibleIds);
  const frontier = rankBestBuys(dataset.listings);
  const frontierIds = new Set(frontier.map((listing) => listing.id));
  const ranked = [
    ...frontier,
    ...allEligible
      .filter((listing) => !frontierIds.has(listing.id))
      .sort((a, b) => assessBestBuy(b).workValue! - assessBestBuy(a).workValue!),
  ];
  const ordered = [
    ...ranked.filter((listing) => newSet.has(listing.id)),
    ...ranked.filter((listing) => !newSet.has(listing.id)),
  ];
  const hash = snapshotHash(dataset, currentEligibleIds);

  const header = newEligibleIds.length
    ? `<b>${newEligibleIds.length} new qualifying laptop${newEligibleIds.length === 1 ? "" : "s"}</b>`
    : "<b>No new qualifying laptops</b> — current best buy";
  const footer = `<a href="${escapeTelegramHtml(dashboardUrl)}">Open the full dashboard</a>`;
  const sections = [header];

  for (const listing of ordered) {
    if (newEligibleIds.length === 0 && sections.length > 1) break;
    const block = listingBlock(listing, newSet.has(listing.id));
    const candidate = [...sections, block, footer].join("\n\n");
    if (candidate.length > 4096) break;
    sections.push(block);
  }

  if (sections.length === 1 && ordered.length === 0) {
    sections[0] = "<b>No qualifying laptops found</b>";
  }

  let html = [...sections, footer].join("\n\n");
  if (html.length > 4096) html = html.slice(0, 4096);

  return {
    html,
    shouldSend: state.lastSnapshotHash !== hash,
    snapshotHash: hash,
    currentEligibleIds,
    newEligibleIds,
  };
}

export async function sendTelegramMessage(options: {
  token: string;
  chatId: string;
  html: string;
  fetchImpl?: typeof fetch;
}): Promise<{ messageId: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;

  try {
    response = await fetchImpl(
      `https://api.telegram.org/bot${options.token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: options.chatId,
          text: options.html,
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "network error";
    const redacted = message.replaceAll(options.token, "[redacted]");
    // The original fetch error can contain the bot token in its request URL.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`Telegram send failed: ${redacted}`);
  }

  if (!response.ok) {
    throw new Error(`Telegram send failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    ok?: boolean;
    result?: { message_id?: number };
  };
  const messageId = body.result?.message_id;
  if (!body.ok || typeof messageId !== "number") {
    throw new Error("Telegram send failed: invalid API response");
  }

  return { messageId };
}
