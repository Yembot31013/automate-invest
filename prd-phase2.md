# Product Requirement Document — Phase 2: Signal Desk AI Sidekick

## Objective
Clerk-authenticated web command center with a Gemini-powered sidekick that monitors tickers, surfaces Finnhub headlines, recommends from real rules, runs paper trades / what-ifs, and stays casual without inventing numbers.

## Locked decisions
- Model: Gemini `2.5-pro` for desk chat; `2.5-flash` for Discord one-liners
- Surface: Web desk (`/desk`) + Discord `#live-alerts` webhook
- Auth: Clerk (`proxy.ts`)
- Data: User-scoped Upstash Redis; cron uses watcher reverse-index union
- Cron: `0 14 * * 1-5` (Hobby-safe once/weekday); desk **Scan now** for on-demand

## Capabilities
| Command | Behavior |
|---|---|
| monitor / unmonitor | User list + `symbol:{SYM}:watchers`; cron drops when watchers empty |
| update / check out | Snapshot + sentiment + company headlines |
| recommend | User watchlist only (empty → ask to monitor) |
| paper buy/sell | $100k cash book; insufficient cash fails |
| what-if | Real OHLC counterfactual |
| Scan now | Authenticated `/api/scan` for your list → Discord |

## Acceptance
1. Unmonitor removes cron coverage only if no other watchers remain
2. Chat survives refresh (Redis persistence)
3. Recommend never invents a default ticker universe
4. Paper buy respects cash; portfolio shows cash + equity
5. Headlines appear on desk cards / alerts when Finnhub returns them
6. `yarn test` / `npm test` passes math + concurrency checks
7. Finnhub calls are cached + RPM-limited
