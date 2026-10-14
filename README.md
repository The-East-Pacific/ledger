# The East Pacific — Ledger Archive

Raw Discord exports of **permanently archived** public channels, plus the search
index that powers the public website and the `/search-public` command.

Website: **https://ledger.theeastpacific.com/**

This repo is meant to be **self-serve** — you edit one file and run one workflow.
No coding needed.

## Archive a channel (step by step)

1. **Get the channel ID.** In Discord: Settings → Advanced → enable **Developer Mode**,
   then right-click the channel → **Copy Channel ID**.
2. **Add a row to `channels.csv`.** On GitHub: open `channels.csv` → pencil (edit) →
   add a line → **Commit changes**.
   ```
   Server,Branch,Subbranch,ChannelID,Label,Frozen
   The East Pacific,community,main,123456789012345678,weekly-questions,
   ```
   | Column | Meaning |
   |---|---|
   | `Server` | A label for you (which Discord server). |
   | `Branch` | Main branch: `executive`, `legislative`, `judicial`, `foreign-affairs`, `community`. |
   | `Subbranch` | Optional — use for old/archived servers (e.g. `archive`). Blank = `main`. |
   | `ChannelID` | The ID you copied. |
   | `Label` | A short name for you. |
   | `Frozen` | Leave **blank** — the workflow sets it to `yes` after a successful export. |
3. **Run the workflow.** **Actions → Archive Ledger → Run workflow → Run.**
   - `term` defaults to `archive` — leave it.
   - Optionally set `branch` or `server` to process only a slice.
4. **Done.** It exports the channel (including threads and forum posts), updates the
   index, and marks the row `Frozen=yes`. It appears on the website within a minute.

## About `Frozen`
These channels are perma-archived (no new posts), so after a clean export the row is
marked `Frozen=yes` and future runs skip it. To **re-export** a channel (e.g. the
first try failed), clear its `Frozen` value and run the workflow again.

## Troubleshooting
- **403 Forbidden** in the run log → the bot can't see that channel. Give the bot's
  role **View Channel** + **Read Message History** on it, then re-run.
- **404 Not Found** → the channel was deleted; it's skipped automatically.

## Searching
The website and `/search-public` support `from:`, `mentions:`, `in:`, `before:`,
`after:`, `during:`, `has:image|file|link|embed|video|sound|sticker`, `pinned:true`,
and `-` negation.
