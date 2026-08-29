# Product Requirement Document (PRD): Autonomous Market Alerting Bot

## 1. Project Overview & Objective
The goal is to build a lightweight, fully automated stock filtering and alerting system using a **100% Serverless Node.js/TypeScript architecture**. The system will scan financial markets for specific trend anomalies—such as "buying the dip" on sharp sell-offs or uncovering high-potential, lower-volume "under-the-radar" assets—and push beautifully structured, highly visual notifications to a private **Discord** channel.

To maintain a zero-cost infrastructure footprint, the entire stack bypasses Python/Django and runs entirely on the **Next.js App Router**, leveraging free-tier serverless environments via **Vercel** (Hosting & Cron) and **Upstash** (Redis/Database).

---

## 2. Technical Stack & Infrastructure
*   **Frontend & Orchestration:** Next.js 14+ (App Router) with TypeScript.
*   **Database & State Management:** Upstash Redis (Free Tier) to store tracking watchlists, historical daily metrics, and rate-limiting flags.
*   **Cron Job Orchestration:** Vercel Cron Jobs (configured via vercel.json) to trigger API scanning tasks at fixed market intervals.
*   **Market Data Aggregator:** Finnhub.io or Alpaca Markets Node SDK (Free Tiers) utilizing standard HTTPS REST clients.
*   **Notification Engine:** Discord Webhooks utilizing rich Discord JSON Embeds.
*   **Visual Chart Generation:** QuickChart API (Free Tier) to dynamically build data-visualization images on-the-fly without a browser overhead.

---

## 3. Core Functional Requirements

### 3.1. Market Scanning Engine (Vercel Cron)
*   **Trigger Schedule:** The scanner must run automatically via cron endpoints (e.g., /api/cron/scan) every Monday through Friday, aligning with active market hours.
*   **Anomaly Rules:**
    1.  **The Sharp Dip ("Buy the Dip"):** Track specific benchmark indices and equities. If an asset drops $\ge 8\%$ below its 14-day rolling average due to short-term news catalysts, qualify it for evaluation.
    2.  **The Promising Under-the-Radar:** Scan for lower-cap assets experiencing a sudden positive divergence in news sentiment (via Finnhub Sentiment API) accompanied by a structural surge in volume ($\ge 2x$ the 20-day trading volume average), indicating early breakout accumulation.

### 3.2. Data Processing & Payload Building
*   The API route fetches raw OHLC (Open, High, Low, Close) and sentiment payloads.
*   It filters incoming arrays using functional TypeScript array reductions (bypassing the need for heavy native libraries like TA-Lib).
*   If a specific condition evaluates to true, the system logs the event to Upstash Redis to prevent duplicate notifications within the same trading session.

### 3.3. Dynamic Image Generation
*   To bypass serverless memory bottlenecks, the script formats numerical arrays into an encoded quickchart.io GET URL string.
*   The generated URL renders a minimalist, dark-themed trend line chart mapping recent pricing patterns, which is fed seamlessly as an image attachment straight to Discord.

---

## 4. UI/UX & Visual Design System (Discord Embed Guidelines)

Visual elegance is a core priority. The Discord notification layout must move away from dense text blocks, favoring structured micro-dashboards through specific Discord Embed parameters.

### 4.1. Color Coding System (Not Strict, Clean Palettes)
*   **Sharp Dip Alert UI:** Left border accent color set to **Soft Crimson/Coral** (#E05656). It visually denotes a market pullback without creating flashing alarm errors.
*   **Promising Growth Alert UI:** Left border accent color set to **Emerald/Mint Sage** (#4E9F3D). It signals growth trends cleanly and professionally.

### 4.2. Embed Structure Layout
*   **Header Section:** Clear asset display using EXCHANGE:SYMBOL notation (e.g., NASDAQ:NVDA) coupled with a brief, high-readability title (e.g., "Sharp Price Pullback Detected").
*   **Grid Meta Fields:** Organize underlying fundamental numbers into 2-column or 3-column inline Markdown blocks:
    *   *Current Price* | *Percentage Off Peak*
    *   *24h Trading Volume* | *Sentiment Index Score*
*   **Body Description:** A concise 2-sentence breakdown detailing the specific trigger catalyst (e.g., *"Volume has crossed 2.1x normal levels alongside a rise in bullish media coverage."*).
*   **Image Footer:** The line chart rendered by QuickChart must occupy the primary image block below the text, giving you immediate contextual analysis directly inside the notification window.

---

## 5. Directory & Route Map for Cursor AI

Instruct your Cursor AI context to scaffold the project structure exactly as follows:

text
    vercel.json                  # Vercel Cron definitions
    app/
        api/
            cron/
                scan/
                    route.ts # Main scanning cron endpoint
            watchlist/
                route.ts     # Simple API to add/remove tickers
    lib/
       market.ts            # Client abstractions for Finnhub/Alpaca
       redis.ts             # Upstash Redis connector client
       discord.ts           # Discord payload builders & embed templates
    types/
        index.ts             # Strict TypeScript models for API responses


---

## 6. Phase 1 Implementation Milestones for Prompting
Provide these specific instructions to your development environment step-by-step:
1.  *“Scaffold a Next.js App Router API directory in TypeScript and hook up a serverless Redis client using @upstash/redis.”*
2.  *“Write utility functions in src/lib/market.ts to fetch historical prices and calculate a simple rolling average using basic JS/TS math arrays.”*
3.  *“Construct a Discord webhook service that formats JSON message bodies into Embed objects using dark-mode themed fields and structural column groupings.”*
4.  *“Hook up the automated workflows together under the /api/cron/scan route, implementing tracking checks to ensure duplicate alerts are suppressed for 24 hours.”*