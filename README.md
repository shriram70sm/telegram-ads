# Global AI News & Paid Ads Telegram Bot — Setup & Deployment Guide

This guide walks you through deploying `telegram_news_ad_bot.js` for **$0/month** using either **GitHub Actions** (direct scheduled runner) or **Vercel / Netlify + cron-job.org**, connected to **Upstash Redis** (for tracking the last 50 posts and ad impressions) and **Google Gemini** (for multilingual AI news summaries).

## 1. Get Your Free Credentials (5 Minutes)

| Service | Where to Get It (100% Free) | Environment Variable Name |
| :--- | :--- | :--- |
| **Telegram Bot Token** | Message [@BotFather](https://www.google.com/search?q=https%3A%2F%2Ft.me%2FBotFather) on Telegram → `/newbot` → copy the HTTP API token, then add your bot as an **Administrator** (with *Post Messages* permission) in your Telegram Channel. | `TELEGRAM_BOT_TOKEN` |
| **Telegram Channel ID** | Use your public channel username (e.g. `@world_daily_news`) or numeric ID (e.g. `-1001234567890`). | `TELEGRAM_CHANNEL_ID` |
| **Admin Telegram ID** | Message [@userinfobot](https://www.google.com/search?q=https%3A%2F%2Ft.me%2Fuserinfobot) on Telegram to get your personal numeric user ID so only you can add/delete paid ads via bot DM. | `ADMIN_TELEGRAM_USER_ID` |
| **Gemini AI API Key** | Sign in to [Google AI Studio](https://www.google.com/search?q=https%3A%2F%2Faistudio.google.com%2Fapp%2Fapikey) and click **Create API Key** (free tier includes 1,500 requests/day on `gemini-2.5-flash`). | `GEMINI_API_KEY` |
| **Upstash Redis URL & Token** | Create a free account at [Upstash Console](https://www.google.com/search?q=https%3A%2F%2Fconsole.upstash.com) → **Create Database** → scroll to **REST API** and copy the URL and Token. | `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` |
| **Cron Webhook Secret** | Invent any random password (e.g. `my_super_secret_99`) to protect your Vercel/Netlify URL. | `CRON_SECRET` |

## 2. Deployment Option A: Run Directly on GitHub Actions (Simplest, No Vercel Needed)

You can run the bot every 20 minutes directly inside a free GitHub repository without even needing a web host, or use GitHub Actions to ping your Vercel endpoint.

1. Create a new **Private** GitHub repository and upload `telegram_news_ad_bot.js` to the root folder.
2. Go to your repo's **Settings → Secrets and variables → Actions → New repository secret** and add the environment variables from Step 1.
3. Create `.github/workflows/news-bot.yml` with the following configuration:

```yaml
name: Telegram Global AI News & Ads Cron

on:
  schedule:
    # Runs every 30 minutes automatically
    - cron: "*/30 * * * *"
  workflow_dispatch: # Lets you click "Run workflow" manually anytime

jobs:
  publish-news:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Run Telegram News & Ad Bot
        env:
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHANNEL_ID: ${{ secrets.TELEGRAM_CHANNEL_ID }}
          ADMIN_TELEGRAM_USER_ID: ${{ secrets.ADMIN_TELEGRAM_USER_ID }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          UPSTASH_REDIS_REST_URL: ${{ secrets.UPSTASH_REDIS_REST_URL }}
          UPSTASH_REDIS_REST_TOKEN: ${{ secrets.UPSTASH_REDIS_REST_TOKEN }}
          MAX_POSTS_PER_RUN: "2"
          ENABLE_PAID_ADS: "true"
          AD_FREQUENCY_EVERY_N_POSTS: "4"
        run: node telegram_news_ad_bot.js
```

## 3. Deployment Option B: Deploy on Vercel or Netlify + cron-job.org

Deploying on Vercel or Netlify also lets you manage **Paid Ads live via Telegram DM commands** (`/addad`, `/listads`, `/delad`, `/postnow`).

1. Create a folder named `api/` in your project and place `telegram_news_ad_bot.js` inside it as `api/cron.js`.
2. Add a `vercel.json` file in your root folder:

```json
{
  "functions": {
    "api/cron.js": {
      "maxDuration": 10
    }
  }
}
```

3. Import the repository into [Vercel](https://www.google.com/search?q=https%3A%2F%2Fvercel.com) and add your Environment Variables in **Project Settings → Environment Variables**.
4. Create a free account at [cron-job.org](https://www.google.com/search?q=https%3A%2F%2Fcron-job.org) and create a cron job that sends a `GET` request every 15 or 30 minutes to:
   `https://your-project-name.vercel.app/api/cron?secret=YOUR_CRON_SECRET`

## 4. Managing Paid Ads & Sponsorships

Your bot supports **two monetization formats** out of the box:

* **Inline Sponsor Footer**: Appends a subtle sponsor credit line with a clickable link at the bottom of every AI news summary.
* **Dedicated Sponsored Posts with CTA Buttons**: Automatically publishes a full standalone ad (with optional banner photo and an inline clickable button) every `AD_FREQUENCY_EVERY_N_POSTS` news posts (default: every 4th post), or anytime you trigger `https://your-project-name.vercel.app/api/cron?secret=YOUR_CRON_SECRET&mode=ad`.

### Adding & Tracking Ads via Telegram Commands (Webhook Mode)

To manage ads directly from your phone without editing code, point your Telegram Bot webhook to your Vercel URL once in your browser:

`https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-project-name.vercel.app/api/cron?mode=webhook`

Then send any of these commands in a direct message to your bot:

* **Add a Paid Ad**:
  `/addad Acme Crypto | 🚀 Trade Zero-Fee Perpetuals Today | Get a $50 welcome bonus when you sign up this week. | https://example.com/promo | 🔥 Claim $50 Bonus`
* **Check Live Ad Impressions**:
  `/listads` (returns every active sponsor and how many times their ad was posted to your channel).
* **Remove an Expired Ad**:
  `/delad ad-1729338123456`
* **Force an Immediate News Post**:
  `/postnow`
