# Changelog

English | [简体中文](CHANGELOG.zh-CN.md)

Notable changes to cc-hud, newest first. Each version matches `version` in `cc-hud/.claude-plugin/plugin.json`.

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
