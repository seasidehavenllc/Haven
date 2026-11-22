export const Roles = ["BUYER", "SELLER", "CREATOR", "ADMIN"] as const;
export type Role = (typeof Roles)[number];

export const StreamModes = ["HUMAN", "AI_HOST", "HUMAN_AI_COHOST"] as const;
export type StreamMode = (typeof StreamModes)[number];

/** Co-host assistance levels for HUMAN_AI_COHOST streams. */
export const CohostModes = ["SILENT", "INVITED", "AUTO_ASSIST", "TAKEOVER"] as const;
export type CohostMode = (typeof CohostModes)[number];

export const AiCapabilities = [
  "VISION_PRODUCT_ID",
  "LLM_TEXT",
  "LLM_AGENT",
  "SPEECH_TO_TEXT",
  "TEXT_TO_SPEECH",
  "AVATAR_VIDEO",
  "TRANSLATION",
  "MODERATION",
  "EMBEDDINGS",
] as const;
export type AiCapability = (typeof AiCapabilities)[number];

/** Metered AI features sellers are billed for. Each maps to a capability. */
export const AiFeatures = [
  "PRODUCT_SCAN",
  "LISTING_GENERATION",
  "PRICE_SUGGESTION",
  "SHOPPING_ASSISTANT",
  "COHOST_MINUTE",
  "AI_HOST_MINUTE",
  "TRANSCRIPTION_MINUTE",
  "TTS_CHARACTERS",
  "AVATAR_MINUTE",
] as const;
export type AiFeature = (typeof AiFeatures)[number];

export const ProductConditions = ["NEW", "LIKE_NEW", "GOOD", "FAIR", "POOR", "REFURBISHED"] as const;
export type ProductCondition = (typeof ProductConditions)[number];

export const OrderStatuses = [
  "PENDING_PAYMENT",
  "PAID",
  "FULFILLING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
] as const;
export type OrderStatus = (typeof OrderStatuses)[number];

/** Realtime event names shared by API, web and mobile. */
export const RealtimeEvents = {
  inventoryChanged: "inventory:changed",
  streamMenuChanged: "stream:menu",
  streamPinned: "stream:pinned",
  streamStatus: "stream:status",
  streamChat: "stream:chat",
  streamViewers: "stream:viewers",
  auctionBid: "auction:bid",
  auctionClosed: "auction:closed",
  orderCreated: "order:created",
  creditsChanged: "credits:changed",
  notification: "notification",
  cohostSuggestion: "cohost:suggestion",
} as const;
