# Changelog

English | [简体中文](CHANGELOG.zh-CN.md)

Notable changes to cc-hud, newest first. Each version matches `version` in `cc-hud/.claude-plugin/plugin.json`.

## 1.4.0 (2026-10-10)

### Added

- **Today's share of the weekly quota**, at the right end of the toolbar: `today 21% · 20%/day`. The daily share is what was left at your first reading of the day, divided by the days until the weekly reset (today included), so it holds steady all day; all of the day's sessions share that first reading. Once today's use passes the share, the number turns orange and the crab starts to sweat, even if the week as a whole is on pace. It shortens to `today 21/20%` or `21/20%` when room runs short, steps aside while `[settings]` is open, and sits last on the one-line panel when there's room. The desktop app's toolbar row shows the full sentence too. The grid itself is unchanged.
- **Remote Control indicator**: in fullscreen, Claude Code shows its `/rc` label after the path in the logo at the top, so it scrolls away once the conversation grows. While Remote Control is on, the toolbar now shows a green `● rc` at its right end (in the one-line panel, right after the buttons). Click it to open Claude Code's Remote Control dialog (session link, QR code, Disconnect). cc-hud can't read Remote Control's state, so it follows the `/remote-control` you run: it appears when you turn it on and goes away when you disconnect. It doesn't notice a dropped or reconnecting connection, or Remote Control started by the `remoteControlAtStartup` setting. On the default renderer Claude Code draws its own `/rc` at the bottom right, so cc-hud doesn't add one. After `/reload-plugins`, run `/remote-control` again (choose Continue) so cc-hud knows it's on. The desktop app's toolbar row shows the dot too.

### Changed

The terminal crab's moves were redesigned. Each tool now has a start, a loop while it runs, and an ending when the tool really finishes:
- **Editing a file**: every tap of the claw leaves one ink dot; when the edit is done the page flies up into the blank row and a fresh page takes its place.
- **Running a command**: the crab types the command, then watches the output scroll; the last line turns green when it finishes, red when it fails. After about 15 seconds on the same command it gets impatient: it taps the desk and stamps its feet while the screen steams.
- **Searching the web**: a green radar sweeps beside the crab while the query is typed above its head; when results come back, blips light up and the first link appears with how many more.
- **Fetching a page**: the page flies in from the right and loads line by line, with the URL above; when it's fetched, the page folds away and the URL turns purple.
- **Sleeping**: after 4 idle minutes the crab dozes off (its eyes close into lines, its head nods); at 5 minutes it digs into the sand, puts on a nightcap and sleeps, peeking with one eye now and then. Anything that happens wakes it at once: it pops out within 0.6 s while the cap flies off.
- Speech bubbles move to the crab's left while a wide prop (the radar, a fetched page) is on its right.
- The sunglasses get a small glint, so they don't look like closed eyes.

The desktop app's crab now does the same tool moves in its 16 × 8 picture: the radar with blips, the page that flies in and folds away, the terminal whose last line turns green or red, ink dots and the page flip, steam after about 15 seconds, dozing at 4 minutes, the sandy nap with a nightcap at 5, and popping out when you come back. Its picture redraws only every 15 seconds or so, so these timings are built into the SVG itself. It has no blank row above it for URLs and search terms, and no pointer greeting.

## 1.3.1 (2026-10-08)

### Fixed

- Clicking `[history]` (or the desktop app's **Handoff history**) in a terminal narrower than 144 columns showed "Couldn't open the handoff history: unasked below 144 columns". `/hud history` was not affected. The button now opens the pane at any width.

## 1.3.0 (2026-10-08)

### Added

- **Handoff history.** `[history]` on the toolbar, or `/hud history` (also `/hud 历史`), opens a pane that lists this project's saved handoffs, newest first, up to 9.
  - Each row shows when it was written, the branch, and its first next step.
  - Press a digit (1-9) or click `fill in`: the prompt box gets `@<that handoff> Continue from this handoff`, and anything you had typed stays below it. `open` opens the file; `open folder` shows them all.
  - Picking the handoff that was waiting for your next session uses it up, so `/clear` doesn't fill it in a second time.
  - The desktop app gets a native **Handoff history** button. It probably won't let a mod fill its prompt box, so use **Open** there.
- **`[clear & continue]`.** Once this conversation has a handoff, this button appears after `[handoff]` (terminal only). Click it and cc-hud runs `/clear` for you; the cleared session gets the handoff line, even if you already used that handoff once.

### Changed

- **A panicking crab no longer flashes a red bar beside its head while it works.** Like an idle panicking crab, it now flings sweat up into the row above its head. The red "!" now only appears beside an idle panicking crab. The desktop crab matches.
- When the terminal isn't fullscreen, the toolbar leaves out `[history]` (clicks don't reach it there) and keeps room for the hint.

## 1.2.0 (2026-10-08)

### Added

- **The next session fills in your handoff.** Write a handoff with `[handoff]` or `/hud handoff`, then open a new session in the same project or run `/clear`. The prompt box already holds `@<the handoff file> Continue from this handoff`. Press Enter and Claude Code attaches the whole file.
  - It happens once, within 2 hours of writing the handoff.
  - It doesn't happen when you resume an old session, fork one, or after a compaction.
  - If the file path contains a space, which would break the `@` reference, the handoff text itself is filled in.
  - If a dialog is in the way, it tries again a few times.
- The toast you see after writing a handoff now mentions this.

## 1.1.0 (2026-10-08)

### Added

- **Desktop app: native Settings and Handoff buttons** above the card.
  - Settings opens Lang, Crab and Panel dropdowns.
  - Handoff turns into the app's primary button at 85% context, and shows "Writing handoff…" while Claude writes.
  - The desktop app can't copy to the clipboard from a mod yet, so the handoff is saved to a file and an **Open handoff file** button opens it.
- **`/hud full`, `/hud compact` and `/hud hide`** (also `/hud 完整`, `/hud 精简`, `/hud 隐藏`) switch the panel directly. A bare `/hud` still cycles.

### Changed

- The one-line (compact) terminal panel keeps `[settings] [handoff]` at the front, and its options open on the line below, so you can always switch back. In very narrow terminals the usage bars give way first.
- Crab off now also hides the crab on the desktop card.
- The desktop GIFs in the README were re-recorded with the new buttons.

## 1.0.0 (2026-10-08)

First public release:
- a usage panel under the prompt: model, project, context, and 5-hour and weekly quota with pace warnings
- a settings toolbar and an English or Chinese UI
- one-click handoff prompts
- a board showing what each subagent and workflow agent is doing
- a pixel crab above the prompt that acts out each tool
- an SVG card for the desktop app
