/**
 * ============================================================================
 * GLOBAL AI NEWS & SPONSORED ADS TELEGRAM BOT (Zero-Dependency Universal Script)
 * ============================================================================
 * Works out-of-the-box on:
 *   1. GitHub Actions (`node telegram_news_ad_bot.js`)
 *   2. Vercel / Netlify Serverless Functions (`api/cron.js`)
 *
 * Security & Admin Lock Features:
 *   - Checks `tg_news_bot:bot_paused` in Upstash Redis so if the Admin pauses
 *     the bot from the password-locked GitHub Pages dashboard, no runs occur.
 *   - Supports `CRON_SECRET` / `ADMIN_PASSWORD` verification on HTTP triggers.
 *   - Restricts Telegram DM commands (`/addad`, `/delad`, `/postnow`) strictly
 *     to `ADMIN_TELEGRAM_USER_ID`.
 * ============================================================================
 */

const CONFIG = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
  TELEGRAM_CHANNEL_ID: process.env.TELEGRAM_CHANNEL_ID || "",
  ADMIN_TELEGRAM_USER_ID: process.env.ADMIN_TELEGRAM_USER_ID || "",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  UPSTASH_REDIS_REST_URL: (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, ""),
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN || "",
  CRON_SECRET: process.env.CRON_SECRET || process.env.ADMIN_PASSWORD || "",
  MAX_POSTS_PER_RUN: parseInt(process.env.MAX_POSTS_PER_RUN || "2", 10),
  DEDUP_HISTORY_LIMIT: 50,
  OUTPUT_LANGUAGE: process.env.OUTPUT_LANGUAGE || "English (with original region/language context noted)",
  ENABLE_PAID_ADS: (process.env.ENABLE_PAID_ADS || "true").toLowerCase() === "true",
  AD_FREQUENCY_EVERY_N_POSTS: parseInt(process.env.AD_FREQUENCY_EVERY_N_POSTS || "4", 10),
  INCLUDE_INLINE_SPONSOR_FOOTER: (process.env.INCLUDE_INLINE_SPONSOR_FOOTER || "true").toLowerCase() === "true",
};

function buildGoogleNewsRss({ country = "US", lang = "en", topic = "" }) {
  const ceid = `${country}:${lang}`;
  if (!topic) {
    return `https://news.google.com/rss?hl=${lang}-${country}&gl=${country}&ceid=${ceid}`;
  }
  return `https://news.google.com/rss/headlines/section/topic/${topic.toUpperCase()}?hl=${lang}-${country}&gl=${country}&ceid=${ceid}`;
}

const NEWS_FEEDS = [
  { name: "BBC World", region: "🌍 Global", lang: "en", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "Al Jazeera Global", region: "🌍 Global", lang: "en", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { name: "Google News India (EN)", region: "🇮🇳 India", lang: "en", url: buildGoogleNewsRss({ country: "IN", lang: "en" }) },
  { name: "Google News India (Hindi)", region: "🇮🇳 भारत (Hindi)", lang: "hi", url: buildGoogleNewsRss({ country: "IN", lang: "hi" }) },
  { name: "Google News India (Marathi)", region: "🇮🇳 महाराष्ट्र (Marathi)", lang: "mr", url: buildGoogleNewsRss({ country: "IN", lang: "mr" }) },
  { name: "Google News US", region: "🇺🇸 USA", lang: "en", url: buildGoogleNewsRss({ country: "US", lang: "en" }) },
  { name: "Google News Tech & AI", region: "💻 Global Tech", lang: "en", url: buildGoogleNewsRss({ country: "US", lang: "en", topic: "TECHNOLOGY" }) },
  { name: "Google News Business", region: "📈 Global Finance", lang: "en", url: buildGoogleNewsRss({ country: "US", lang: "en", topic: "BUSINESS" }) },
  { name: "Google News Espanol", region: "🇪🇸/🌎 Spanish", lang: "es", url: buildGoogleNewsRss({ country: "ES", lang: "es" }) },
  { name: "Google News France", region: "🇫🇷 French", lang: "fr", url: buildGoogleNewsRss({ country: "FR", lang: "fr" }) },
  { name: "Google News Middle East", region: "🇦🇪 Arabic", lang: "ar", url: buildGoogleNewsRss({ country: "AE", lang: "ar" }) },
  { name: "Google News Japan", region: "🇯🇵 Japanese", lang: "ja", url: buildGoogleNewsRss({ country: "JP", lang: "ja" }) },
];

const DEFAULT_SPONSORED_ADS = [
  {
    id: "sponsor-default-1",
    sponsorName: "Your Brand Here",
    headline: "🚀 Promote Your Business, App, or Channel Here!",
    body: "Reach thousands of daily global news readers across our Telegram network. Affordable daily & weekly sponsorship slots available.",
    ctaText: "📢 Book an Ad Slot",
    ctaUrl: "https://t.me/your_admin_username",
    imageUrl: "",
    inlineFooter: "💎 Sponsored: Want to advertise here? Contact Admin (@your_admin_username)",
  },
];

const REDIS_KEYS = {
  BOT_PAUSED: "tg_news_bot:bot_paused",
  RECENT_POSTS: "tg_news_bot:last_50_urls",
  POST_COUNTER: "tg_news_bot:total_post_counter",
  FEED_ROTATION_INDEX: "tg_news_bot:feed_index",
  CUSTOM_ADS: "tg_news_bot:custom_ads",
  AD_INDEX: "tg_news_bot:ad_rotation_index",
};

async function redisCommand(commandArray) {
  if (!CONFIG.UPSTASH_REDIS_REST_URL || !CONFIG.UPSTASH_REDIS_REST_TOKEN) return null;
  const res = await fetch(CONFIG.UPSTASH_REDIS_REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CONFIG.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commandArray),
  });
  if (!res.ok) throw new Error(`Upstash Redis error (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.result;
}

async function isBotPausedByAdmin() {
  const pausedVal = await redisCommand(["GET", REDIS_KEYS.BOT_PAUSED]);
  return String(pausedVal).toLowerCase() === "true";
}

async function getLast50PostedUrls() {
  const list = await redisCommand(["LRANGE", REDIS_KEYS.RECENT_POSTS, "0", String(CONFIG.DEDUP_HISTORY_LIMIT - 1)]);
  return Array.isArray(list) ? new Set(list) : new Set();
}

async function recordPostedUrl(urlKey) {
  if (!CONFIG.UPSTASH_REDIS_REST_URL) return;
  await redisCommand(["LPUSH", REDIS_KEYS.RECENT_POSTS, urlKey]);
  await redisCommand(["LTRIM", REDIS_KEYS.RECENT_POSTS, "0", String(CONFIG.DEDUP_HISTORY_LIMIT - 1)]);
}

async function incrementAndGetCounter(key) {
  const count = await redisCommand(["INCR", key]);
  return typeof count === "number" ? count : 1;
}

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

    return itemBlocks
      .slice(0, 8)
      .map((block) => {
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
      })
      .filter((item) => item.title && item.link);
  } catch (err) {
    return [];
  }
}

function escapeHtml(text = "") {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function summarizeArticleWithAI(article, inlineFooter = "") {
  if (!CONFIG.GEMINI_API_KEY) {
    return [
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

async function getActiveAds() {
  try {
    const rawAds = await redisCommand(["GET", REDIS_KEYS.CUSTOM_ADS]);
    if (rawAds) {
      const parsed = JSON.parse(rawAds);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  return DEFAULT_SPONSORED_ADS;
}

async function pickNextSponsoredAd() {
  const ads = await getActiveAds();
  if (!ads.length) return null;
  const idx = await incrementAndGetCounter(REDIS_KEYS.AD_INDEX);
  const chosenAd = ads[(idx - 1) % ads.length];
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
    ? { inline_keyboard: [[{ text: ad.ctaText || "🔗 Learn More", url: ad.ctaUrl }]] }
    : undefined;

  if (ad.imageUrl) {
    return sendTelegramPhoto(CONFIG.TELEGRAM_CHANNEL_ID, ad.imageUrl, caption, replyMarkup);
  }
  return sendTelegramMessage(CONFIG.TELEGRAM_CHANNEL_ID, caption, replyMarkup);
}

async function sendTelegramMessage(chatId, htmlText, replyMarkup = undefined) {
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = { chat_id: chatId, text: htmlText, parse_mode: "HTML", disable_web_page_preview: false };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram sendMessage failed: ${data.description || JSON.stringify(data)}`);
  return data.result;
}

async function sendTelegramPhoto(chatId, photoUrl, captionHtml, replyMarkup = undefined) {
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const payload = { chat_id: chatId, photo: photoUrl, caption: captionHtml.slice(0, 1020), parse_mode: "HTML" };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) return sendTelegramMessage(chatId, captionHtml, replyMarkup);
  return data.result;
}

async function handleAdminWebhookUpdate(update) {
  const msg = update?.message;
  if (!msg || !msg.text) return { handled: false };
  const senderId = String(msg.from?.id || "");
  if (CONFIG.ADMIN_TELEGRAM_USER_ID && senderId !== String(CONFIG.ADMIN_TELEGRAM_USER_ID)) {
    return { handled: false, reason: "Unauthorized user" };
  }
  const text = msg.text.trim();
  if (text.startsWith("/addad")) {
    const parts = text.replace("/addad", "").trim().split("|").map((s) => s.trim());
    if (parts.length < 4) {
      await sendTelegramMessage(msg.chat.id, "ℹ️ <b>Usage:</b>\n<code>/addad Sponsor | Headline | Body | https://link.com | Button Text</code>");
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
    await sendTelegramMessage(msg.chat.id, `🗑️ Removed ad <code>${escapeHtml(targetId)}</code>.`);
    return { handled: true };
  }
  if (text.startsWith("/postnow")) {
    const result = await runNewsAndAdsCycle();
    await sendTelegramMessage(msg.chat.id, `✅ Manual run complete: posted ${result.postedCount} news item(s) and ${result.adsPosted} ad(s).`);
    return { handled: true };
  }
  return { handled: false };
}

async function runNewsAndAdsCycle({ forceAdOnly = false } = {}) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHANNEL_ID) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID environment variables.");
  }

  // Respect Admin Master Switch set from the password-protected dashboard
  if (await isBotPausedByAdmin()) {
    return { status: "paused", message: "Bot Master Switch is currently PAUSED by Admin.", postedCount: 0, adsPosted: 0 };
  }

  if (forceAdOnly) {
    const ad = await pickNextSponsoredAd();
    await publishDedicatedSponsoredAd(ad);
    return { status: "ok", postedCount: 0, adsPosted: 1 };
  }
  const postedHistorySet = await getLast50PostedUrls();
  const startIdx = (await incrementAndGetCounter(REDIS_KEYS.FEED_ROTATION_INDEX)) % NEWS_FEEDS.length;
  const orderedFeeds = [...NEWS_FEEDS.slice(startIdx), ...NEWS_FEEDS.slice(0, startIdx)];

  let postedCount = 0;
  let adsPosted = 0;
  const postedTitles = [];

  for (const feed of orderedFeeds) {
    if (postedCount >= CONFIG.MAX_POSTS_PER_RUN) break;
    const items = await fetchRssItems(feed);
    const freshItem = items.find((item) => !postedHistorySet.has(item.guid) && !postedHistorySet.has(item.link));
    if (!freshItem) continue;

    let inlineFooter = "";
    if (CONFIG.ENABLE_PAID_ADS && CONFIG.INCLUDE_INLINE_SPONSOR_FOOTER) {
      const activeAds = await getActiveAds();
      const sponsor = activeAds[postedCount % activeAds.length];
      if (sponsor?.inlineFooter) inlineFooter = sponsor.inlineFooter;
    }

    const formattedPost = await summarizeArticleWithAI(freshItem, inlineFooter);
    const ctaMarkup = { inline_keyboard: [[{ text: `🌐 Read Full Article (${freshItem.sourceName})`, url: freshItem.link }]] };

    if (freshItem.imageUrl) {
      await sendTelegramPhoto(CONFIG.TELEGRAM_CHANNEL_ID, freshItem.imageUrl, formattedPost, ctaMarkup);
    } else {
      await sendTelegramMessage(CONFIG.TELEGRAM_CHANNEL_ID, formattedPost, ctaMarkup);
    }

    await recordPostedUrl(freshItem.link);
    postedHistorySet.add(freshItem.link);
    postedCount += 1;
    postedTitles.push(`${freshItem.region}: ${freshItem.title}`);

    const totalPostsEver = await incrementAndGetCounter(REDIS_KEYS.POST_COUNTER);
    if (CONFIG.ENABLE_PAID_ADS && CONFIG.AD_FREQUENCY_EVERY_N_POSTS > 0 && totalPostsEver % CONFIG.AD_FREQUENCY_EVERY_N_POSTS === 0) {
      const ad = await pickNextSponsoredAd();
      await publishDedicatedSponsoredAd(ad);
      adsPosted += 1;
    }
  }

  return { status: "ok", postedCount, adsPosted, postedTitles, timestamp: new Date().toISOString() };
}

async function vercelHandler(req, res) {
  try {
    const query = req.query || {};
    if (CONFIG.CRON_SECRET && query.secret !== CONFIG.CRON_SECRET && query.mode !== "webhook") {
      return res.status(401).json({ error: "Unauthorized: Invalid Admin Password / CRON_SECRET" });
    }
    if (query.mode === "webhook" && req.method === "POST") {
      const out = await handleAdminWebhookUpdate(req.body);
      return res.status(200).json(out);
    }
    const result = await runNewsAndAdsCycle({ forceAdOnly: query.mode === "ad" });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

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
