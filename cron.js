/**
 * ============================================================================
 * GLOBAL AI NEWS & SPONSORED ADS TELEGRAM BOT (Zero-Dependency Universal Script)
 * ============================================================================
 * Works out-of-the-box on:
 *   1. Vercel Serverless Functions (save as `api/cron.js`)
 *   2. Netlify Functions (save as `netlify/functions/cron.js`)
 *   3. GitHub Actions / CLI (`node telegram_news_ad_bot.js`)
 *   4. Triggerable via cron-job.org (`GET https://your-app.vercel.app/api/cron?secret=YOUR_SECRET`)
 *
 * Core Features:
 *   - Multi-Region, Multi-Country & Multi-Language RSS Aggregation (Google News + Global Feeds)
 *   - Last-50-Posts Deduplication via Upstash Redis Free REST API
 *   - AI Summarization & Localization via Google Gemini API (Free Tier)
 *   - Built-in Paid Ads & Sponsorship System:
 *       * Dedicated Sponsored Posts with Images & Inline CTA Buttons
 *       * Optional Native Sponsor Footer inside regular news posts
 *       * Live Ad Impression Counter stored in Redis for advertiser reporting
 *       * Telegram Admin Bot Commands (`/addad`, `/listads`, `/delad`, `/postnow`)
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// 1. CONFIGURATION & ENVIRONMENT VARIABLES
// ----------------------------------------------------------------------------
const CONFIG = {
  // Telegram Settings
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
  TELEGRAM_CHANNEL_ID: process.env.TELEGRAM_CHANNEL_ID || "", // e.g. "@my_global_news" or "-1001234567890"
  ADMIN_TELEGRAM_USER_ID: process.env.ADMIN_TELEGRAM_USER_ID || "", // Your numeric Telegram ID for managing ads via DM

  // Free Gemini API Key (https://aistudio.google.com/app/apikey)
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-2.5-flash",

  // Free Upstash Redis REST API (https://console.upstash.com)
  UPSTASH_REDIS_REST_URL: (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, ""),
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN || "",

  // Security & Posting Rules
  CRON_SECRET: process.env.CRON_SECRET || "", // Optional secret for cron-job.org (?secret=...)
  MAX_POSTS_PER_RUN: parseInt(process.env.MAX_POSTS_PER_RUN || "2", 10),
  DEDUP_HISTORY_LIMIT: 50, // Strictly keeps the last 50 posted article URLs in Redis
  OUTPUT_LANGUAGE: process.env.OUTPUT_LANGUAGE || "English (with original region/language context noted)",

  // Paid Ads & Monetization Rules
  ENABLE_PAID_ADS: (process.env.ENABLE_PAID_ADS || "true").toLowerCase() === "true",
  AD_FREQUENCY_EVERY_N_POSTS: parseInt(process.env.AD_FREQUENCY_EVERY_N_POSTS || "4", 10), // Dedicated ad every 4 news posts
  INCLUDE_INLINE_SPONSOR_FOOTER: (process.env.INCLUDE_INLINE_SPONSOR_FOOTER || "true").toLowerCase() === "true",
};

// ----------------------------------------------------------------------------
// 2. MULTI-COUNTRY, MULTI-LANGUAGE & GLOBAL RSS SOURCES
// ----------------------------------------------------------------------------
// Helper to generate Google News RSS feeds for any Country + Language + Topic
function buildGoogleNewsRss({ country = "US", lang = "en", topic = "" }) {
  const ceid = `${country}:${lang}`;
  if (!topic) {
    return `https://news.google.com/rss?hl=${lang}-${country}&gl=${country}&ceid=${ceid}`;
  }
  return `https://news.google.com/rss/headlines/section/topic/${topic.toUpperCase()}?hl=${lang}-${country}&gl=${country}&ceid=${ceid}`;
}

const NEWS_FEEDS = [
  // Global / World English
  { name: "BBC World", region: "🌍 Global", lang: "en", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "Al Jazeera Global", region: "🌍 Global", lang: "en", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  // India (English, Hindi, Marathi)
  { name: "Google News India (EN)", region: "🇮🇳 India", lang: "en", url: buildGoogleNewsRss({ country: "IN", lang: "en" }) },
  { name: "Google News India (Hindi)", region: "🇮🇳 भारत (Hindi)", lang: "hi", url: buildGoogleNewsRss({ country: "IN", lang: "hi" }) },
  { name: "Google News India (Marathi)", region: "🇮🇳 महाराष्ट्र (Marathi)", lang: "mr", url: buildGoogleNewsRss({ country: "IN", lang: "mr" }) },
  // Americas, Europe, Middle East & Asia-Pacific (Multi-language)
  { name: "Google News US", region: "🇺🇸 USA", lang: "en", url: buildGoogleNewsRss({ country: "US", lang: "en" }) },
  { name: "Google News Tech & AI", region: "💻 Global Tech", lang: "en", url: buildGoogleNewsRss({ country: "US", lang: "en", topic: "TECHNOLOGY" }) },
  { name: "Google News Business", region: "📈 Global Finance", lang: "en", url: buildGoogleNewsRss({ country: "US", lang: "en", topic: "BUSINESS" }) },
  { name: "Google News Espanol", region: "🇪🇸/🌎 Spanish", lang: "es", url: buildGoogleNewsRss({ country: "ES", lang: "es" }) },
  { name: "Google News France", region: "🇫🇷 French", lang: "fr", url: buildGoogleNewsRss({ country: "FR", lang: "fr" }) },
  { name: "Google News Middle East", region: "🇦🇪 Arabic", lang: "ar", url: buildGoogleNewsRss({ country: "AE", lang: "ar" }) },
  { name: "Google News Japan", region: "🇯🇵 Japanese", lang: "ja", url: buildGoogleNewsRss({ country: "JP", lang: "ja" }) },
];

// Default fallback Paid Ads (can also be added dynamically via Telegram `/addad` stored in Redis!)
const DEFAULT_SPONSORED_ADS = [
  {
    id: "sponsor-default-1",
    sponsorName: "Your Brand Here",
    headline: "🚀 Promote Your Business, App, or Channel Here!",
    body: "Reach thousands of daily global news readers across our Telegram network. Affordable daily & weekly sponsorship slots available.",
    ctaText: "📢 Book an Ad Slot",
    ctaUrl: "https://t.me/your_admin_username",
    imageUrl: "", // Optional image banner URL (https://...)
    inlineFooter: "💎 Sponsored: Want to advertise here? Contact Admin (@your_admin_username)",
  },
];

// ----------------------------------------------------------------------------
// 3. UPSTASH REDIS CLIENT (LAST 50 POSTS DEDUPLICATION + AD STORAGE)
// ----------------------------------------------------------------------------
const REDIS_KEYS = {
  RECENT_POSTS: "tg_news_bot:last_50_urls",
  POST_COUNTER: "tg_news_bot:total_post_counter",
  FEED_ROTATION_INDEX: "tg_news_bot:feed_index",
  CUSTOM_ADS: "tg_news_bot:custom_ads",
  AD_INDEX: "tg_news_bot:ad_rotation_index",
};

async function redisCommand(commandArray) {
  if (!CONFIG.UPSTASH_REDIS_REST_URL || !CONFIG.UPSTASH_REDIS_REST_TOKEN) {
    return null; // Runs in stateless fallback mode if Redis isn't configured yet
  }
  const res = await fetch(CONFIG.UPSTASH_REDIS_REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CONFIG.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commandArray),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Upstash Redis error (${res.status}): ${errText}`);
  }
  const data = await res.json();
  return data.result;
}

async function getLast50PostedUrls() {
  const list = await redisCommand(["LRANGE", REDIS_KEYS.RECENT_POSTS, "0", String(CONFIG.DEDUP_HISTORY_LIMIT - 1)]);
  return Array.isArray(list) ? new Set(list) : new Set();
}

async function recordPostedUrl(urlKey) {
  if (!CONFIG.UPSTASH_REDIS_REST_URL) return;
  // Push new URL to the head of the list and trim strictly to the last 50 items
  await redisCommand(["LPUSH", REDIS_KEYS.RECENT_POSTS, urlKey]);
  await redisCommand(["LTRIM", REDIS_KEYS.RECENT_POSTS, "0", String(CONFIG.DEDUP_HISTORY_LIMIT - 1)]);
}

async function incrementAndGetCounter(key) {
  const count = await redisCommand(["INCR", key]);
  return typeof count === "number" ? count : 1;
}

// ----------------------------------------------------------------------------
// 4. ZERO-DEPENDENCY RSS / ATOM XML PARSER
// ----------------------------------------------------------------------------
function decodeHtmlEntities(str = "") {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(xmlBlock, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = xmlBlock.match(regex);
  return match ? decodeHtmlEntities(match[1]) : "";
}

function extractImageFromItem(xmlBlock) {
  const mediaMatch =
    xmlBlock.match(/<media:content[^>]+url=["']([^"']+)["']/i) ||
    xmlBlock.match(/<enclosure[^>]+url=["']([^"']+)["']/i) ||
    xmlBlock.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
  return mediaMatch ? mediaMatch[1] : "";
}

async function fetchRssItems(feed) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(feed.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GlobalNewsTelegramBot/1.0)" },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return [];
    const xml = await response.text();
    const itemBlocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) || [];

    return itemBlocks.slice(0, 8).map((block) => {
      const title = extractTag(block, "title");
      let link = extractTag(block, "link");
      if (!link) {
        const hrefMatch = block.match(/<link[^>]+href=["']([^"']+)["']/i);
        if (hrefMatch) link = hrefMatch[1];
      }
      const description = extractTag(block, "description") || extractTag(block, "summary");
      const pubDate = extractTag(block, "pubDate") || extractTag(block, "published");
      const guid = extractTag(block, "guid") || extractTag(block, "id") || link || title;
      const imageUrl = extractImageFromItem(block);

      return {
        title,
        link,
        description,
        pubDate,
        guid: guid.slice(0, 240),
        imageUrl,
        sourceName: feed.name,
        region: feed.region,
        lang: feed.lang,
      };
    }).filter((item) => item.title && item.link);
  } catch (err) {
    console.warn(`[RSS Warning] Failed to fetch ${feed.name}: ${err.message}`);
    return [];
  }
}

// ----------------------------------------------------------------------------
// 5. AI SUMMARIZATION ENGINE (GOOGLE GEMINI API - FREE TIER)
// ----------------------------------------------------------------------------
function escapeHtml(text = "") {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function summarizeArticleWithAI(article, inlineFooter = "") {
  // Fallback formatting if Gemini API key is not configured
  if (!CONFIG.GEMINI_API_KEY) {
    const baseText = [
      `<b>${escapeHtml(article.region)} | ${escapeHtml(article.sourceName)}</b>`,
      ``,
      `📰 <b>${escapeHtml(article.title)}</b>`,
      article.description ? `\n${escapeHtml(article.description.slice(0, 280))}...` : "",
      ``,
      `🔗 <a href="${article.link}">Read Full Story</a>`,
      inlineFooter ? `\n──────────────\n${inlineFooter}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return baseText;
  }

  const prompt = `You are an engaging global news editor for a high-traffic Telegram channel.
Summarize the following news item into a crisp, high-signal Telegram post.

Source Region: ${article.region} (${article.sourceName}, source language code: ${article.lang})
Headline: ${article.title}
Snippet: ${article.description || "N/A"}
Target Output Language Policy: ${CONFIG.OUTPUT_LANGUAGE}

Strict Formatting Rules (Plain text only, NO markdown asterisks ** or # headers):
1. Line 1: A single punchy, attention-grabbing headline starting with a fitting emoji.
2. Blank line.
3. 2 to 3 short bullet points (using "• ") summarizing the key facts and why it matters globally or locally.
4. If the original article is in a non-English language (e.g. Hindi, Marathi, Spanish, Arabic, Japanese, French), include BOTH a crisp English summary AND a 1-line summary in the original language so readers from all countries can follow.
5. Last line: 3 to 4 relevant hashtags (e.g. #WorldNews #Tech #India).`;

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 450 },
      }),
    });

    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = await res.json();
    const rawSummary = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!rawSummary) throw new Error("Empty AI response");

    return [
      `<b>${escapeHtml(article.region)} • ${escapeHtml(article.sourceName)}</b>`,
      ``,
      escapeHtml(rawSummary),
      ``,
      `🔗 <a href="${article.link}">Read Full Source</a>`,
      inlineFooter ? `\n──────────────\n${inlineFooter}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  } catch (err) {
    console.warn(`[AI Fallback] Using standard format due to: ${err.message}`);
    return [
      `<b>${escapeHtml(article.region)} • ${escapeHtml(article.sourceName)}</b>`,
      ``,
      `📰 <b>${escapeHtml(article.title)}</b>`,
      article.description ? `\n${escapeHtml(article.description.slice(0, 260))}...` : "",
      ``,
      `🔗 <a href="${article.link}">Read Full Source</a>`,
      inlineFooter ? `\n──────────────\n${inlineFooter}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
}

// ----------------------------------------------------------------------------
// 6. PAID ADS & SPONSORSHIP MANAGER
// ----------------------------------------------------------------------------
async function getActiveAds() {
  try {
    const rawAds = await redisCommand(["GET", REDIS_KEYS.CUSTOM_ADS]);
    if (rawAds) {
      const parsed = JSON.parse(rawAds);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    console.warn("[Ads Warning] Could not load custom ads from Redis:", e.message);
  }
  return DEFAULT_SPONSORED_ADS;
}

async function pickNextSponsoredAd() {
  const ads = await getActiveAds();
  if (!ads.length) return null;
  const idx = await incrementAndGetCounter(REDIS_KEYS.AD_INDEX);
  const chosenAd = ads[(idx - 1) % ads.length];
  // Track ad impression in Redis for advertiser reporting
  if (chosenAd?.id) {
    await redisCommand(["INCR", `tg_news_bot:ad_impressions:${chosenAd.id}`]);
  }
  return chosenAd;
}

async function publishDedicatedSponsoredAd(ad) {
  if (!ad) return null;
  const caption = [
    `📣 <b>SPONSORED PARTNER</b>`,
    ``,
    `<b>${escapeHtml(ad.headline)}</b>`,
    ``,
    escapeHtml(ad.body),
    ``,
    `<i>Sponsored by ${escapeHtml(ad.sponsorName || "Partner")}</i>`,
  ].join("\n");

  const replyMarkup = ad.ctaUrl
    ? {
        inline_keyboard: [
          [{ text: ad.ctaText || "🔗 Learn More", url: ad.ctaUrl }],
        ],
      }
    : undefined;

  if (ad.imageUrl) {
    return sendTelegramPhoto(CONFIG.TELEGRAM_CHANNEL_ID, ad.imageUrl, caption, replyMarkup);
  }
  return sendTelegramMessage(CONFIG.TELEGRAM_CHANNEL_ID, caption, replyMarkup);
}

// ----------------------------------------------------------------------------
// 7. TELEGRAM BOT API HELPERS & ADMIN WEBHOOK COMMANDS
// ----------------------------------------------------------------------------
async function sendTelegramMessage(chatId, htmlText, replyMarkup = undefined) {
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: htmlText,
    parse_mode: "HTML",
    disable_web_page_preview: false,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram sendMessage failed: ${data.description || JSON.stringify(data)}`);
  }
  return data.result;
}

async function sendTelegramPhoto(chatId, photoUrl, captionHtml, replyMarkup = undefined) {
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const payload = {
    chat_id: chatId,
    photo: photoUrl,
    caption: captionHtml.slice(0, 1020),
    parse_mode: "HTML",
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) {
    // Fallback to text message if remote image URL fails
    return sendTelegramMessage(chatId, captionHtml, replyMarkup);
  }
  return data.result;
}

/**
 * Handles Telegram Admin DM Commands when deployed as a Webhook (`?mode=webhook`)
 * Commands:
 *   /addad Sponsor | Headline | Body | https://link.com | CTA Button Text
 *   /listads
 *   /delad <ad_id>
 *   /postnow
 */
async function handleAdminWebhookUpdate(update) {
  const msg = update?.message;
  if (!msg || !msg.text) return { handled: false };

  const senderId = String(msg.from?.id || "");
  if (CONFIG.ADMIN_TELEGRAM_USER_ID && senderId !== String(CONFIG.ADMIN_TELEGRAM_USER_ID)) {
    return { handled: false, reason: "Unauthorized user" };
  }

  const text = msg.text.trim();

  if (text.startsWith("/addad")) {
    const rawArgs = text.replace("/addad", "").trim();
    const parts = rawArgs.split("|").map((s) => s.trim());
    if (parts.length < 4) {
      await sendTelegramMessage(
        msg.chat.id,
        "ℹ️ <b>Usage:</b>\n<code>/addad Sponsor Name | Headline | Ad Body Copy | https://link.com | Button Text</code>"
      );
      return { handled: true };
    }
    const [sponsorName, headline, body, ctaUrl, ctaText = "🔗 Visit Sponsor"] = parts;
    const currentAds = await getActiveAds();
    const newAd = {
      id: `ad-${Date.now()}`,
      sponsorName,
      headline,
      body,
      ctaUrl,
      ctaText,
      inlineFooter: `💎 Sponsored by <a href="${ctaUrl}">${escapeHtml(sponsorName)}</a> — ${escapeHtml(headline)}`,
    };
    const updatedAds = [...currentAds.filter((a) => a.id !== "sponsor-default-1"), newAd];
    await redisCommand(["SET", REDIS_KEYS.CUSTOM_ADS, JSON.stringify(updatedAds)]);
    await sendTelegramMessage(msg.chat.id, `✅ Added new paid ad <code>${newAd.id}</code> for <b>${escapeHtml(sponsorName)}</b>!`);
    return { handled: true };
  }

  if (text.startsWith("/listads")) {
    const ads = await getActiveAds();
    const lines = await Promise.all(
      ads.map(async (ad) => {
        const views = (await redisCommand(["GET", `tg_news_bot:ad_impressions:${ad.id}`])) || 0;
        return `• <code>${ad.id}</code> — <b>${escapeHtml(ad.sponsorName)}</b> (${views} impressions)\n  ${escapeHtml(ad.headline)}`;
      })
    );
    await sendTelegramMessage(msg.chat.id, `📊 <b>Active Sponsored Ads:</b>\n\n${lines.join("\n\n")}`);
    return { handled: true };
  }

  if (text.startsWith("/delad")) {
    const targetId = text.replace("/delad", "").trim();
    const ads = await getActiveAds();
    const filtered = ads.filter((a) => a.id !== targetId);
    await redisCommand(["SET", REDIS_KEYS.CUSTOM_ADS, JSON.stringify(filtered)]);
    await sendTelegramMessage(msg.chat.id, `🗑️ Removed ad <code>${escapeHtml(targetId)}</code>. Remaining ads: ${filtered.length}`);
    return { handled: true };
  }

  if (text.startsWith("/postnow")) {
    const result = await runNewsAndAdsCycle();
    await sendTelegramMessage(msg.chat.id, `✅ Manual run complete: posted ${result.postedCount} news item(s) and ${result.adsPosted} dedicated ad(s).`);
    return { handled: true };
  }

  return { handled: false };
}

// ----------------------------------------------------------------------------
// 8. MAIN AUTOMATION CYCLE (FETCH -> DEDUPLICATE -> SUMMARIZE -> POST + ADS)
// ----------------------------------------------------------------------------
async function runNewsAndAdsCycle({ forceAdOnly = false } = {}) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHANNEL_ID) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID environment variables.");
  }

  if (forceAdOnly) {
    const ad = await pickNextSponsoredAd();
    await publishDedicatedSponsoredAd(ad);
    return { status: "ok", postedCount: 0, adsPosted: 1 };
  }

  // 1. Load the last 50 posted article URLs/GUIDs from Upstash Redis
  const postedHistorySet = await getLast50PostedUrls();

  // 2. Rotate starting feed index so every region & language gets fair coverage across runs
  const startIdx = (await incrementAndGetCounter(REDIS_KEYS.FEED_ROTATION_INDEX)) % NEWS_FEEDS.length;
  const orderedFeeds = [...NEWS_FEEDS.slice(startIdx), ...NEWS_FEEDS.slice(0, startIdx)];

  let postedCount = 0;
  let adsPosted = 0;
  const postedTitles = [];

  for (const feed of orderedFeeds) {
    if (postedCount >= CONFIG.MAX_POSTS_PER_RUN) break;

    const items = await fetchRssItems(feed);
    const freshItem = items.find(
      (item) => !postedHistorySet.has(item.guid) && !postedHistorySet.has(item.link)
    );

    if (!freshItem) continue;

    // Prepare optional inline sponsor footer
    let inlineFooter = "";
    if (CONFIG.ENABLE_PAID_ADS && CONFIG.INCLUDE_INLINE_SPONSOR_FOOTER) {
      const activeAds = await getActiveAds();
      const sponsor = activeAds[postedCount % activeAds.length];
      if (sponsor?.inlineFooter) {
        inlineFooter = sponsor.inlineFooter;
      }
    }

    // Summarize with Gemini AI & publish to Telegram Channel
    const formattedPost = await summarizeArticleWithAI(freshItem, inlineFooter);
    const ctaMarkup = {
      inline_keyboard: [[{ text: `🌐 Read Full Article (${freshItem.sourceName})`, url: freshItem.link }]],
    };

    if (freshItem.imageUrl) {
      await sendTelegramPhoto(CONFIG.TELEGRAM_CHANNEL_ID, freshItem.imageUrl, formattedPost, ctaMarkup);
    } else {
      await sendTelegramMessage(CONFIG.TELEGRAM_CHANNEL_ID, formattedPost, ctaMarkup);
    }

    // Save in Last-50 Redis list immediately so it is never posted again
    await recordPostedUrl(freshItem.link);
    postedHistorySet.add(freshItem.link);
    postedCount += 1;
    postedTitles.push(`${freshItem.region}: ${freshItem.title}`);

    // Check if it's time to publish a full dedicated Sponsored Ad post
    const totalPostsEver = await incrementAndGetCounter(REDIS_KEYS.POST_COUNTER);
    if (
      CONFIG.ENABLE_PAID_ADS &&
      CONFIG.AD_FREQUENCY_EVERY_N_POSTS > 0 &&
      totalPostsEver % CONFIG.AD_FREQUENCY_EVERY_N_POSTS === 0
    ) {
      const ad = await pickNextSponsoredAd();
      await publishDedicatedSponsoredAd(ad);
      adsPosted += 1;
    }
  }

  return {
    status: "ok",
    postedCount,
    adsPosted,
    postedTitles,
    timestamp: new Date().toISOString(),
  };
}

// ----------------------------------------------------------------------------
// 9. UNIVERSAL ENTRYPOINTS (VERCEL, NETLIFY, AND GITHUB ACTIONS CLI)
// ----------------------------------------------------------------------------

// Vercel Serverless Handler (`api/cron.js`)
async function vercelHandler(req, res) {
  try {
    const query = req.query || {};
    if (CONFIG.CRON_SECRET && query.secret !== CONFIG.CRON_SECRET && query.mode !== "webhook") {
      return res.status(401).json({ error: "Unauthorized: Invalid CRON_SECRET" });
    }

    if (query.mode === "webhook" && req.method === "POST") {
      const out = await handleAdminWebhookUpdate(req.body);
      return res.status(200).json(out);
    }

    const result = await runNewsAndAdsCycle({ forceAdOnly: query.mode === "ad" });
    return res.status(200).json(result);
  } catch (err) {
    console.error("[Bot Error]", err);
    return res.status(500).json({ error: err.message });
  }
}

// Netlify Function Wrapper
async function netlifyHandler(event) {
  try {
    const query = event.queryStringParameters || {};
    if (CONFIG.CRON_SECRET && query.secret !== CONFIG.CRON_SECRET && query.mode !== "webhook") {
      return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
    }
    if (query.mode === "webhook" && event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const out = await handleAdminWebhookUpdate(body);
      return { statusCode: 200, body: JSON.stringify(out) };
    }
    const result = await runNewsAndAdsCycle({ forceAdOnly: query.mode === "ad" });
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}

module.exports = vercelHandler;
module.exports.handler = netlifyHandler;
module.exports.runNewsAndAdsCycle = runNewsAndAdsCycle;

// Direct CLI execution for GitHub Actions (`node telegram_news_ad_bot.js`)
if (require.main === module) {
  runNewsAndAdsCycle()
    .then((res) => {
      console.log("Automation Run Result:", JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error("Automation Run Failed:", err);
      process.exit(1);
    });
}
