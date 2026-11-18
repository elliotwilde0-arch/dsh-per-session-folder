# Changelog

All notable changes to this project are documented here.

## 0.3.1 - 2026-11-18

- **Resumed sessions re-adopt their own folder.** After a restart — or after
  the folder was renamed outside the plugin (e.g. the stock-folder cleanup) —
  DSH falls back to the workspace root because the logged cwd no longer exists.
  The marker scan used to skip sessions with prior conversation, so a resumed
  session never found its renamed folder again and kept running in the root.
  The scan now runs for resumed sessions too; it only matches a marker carrying
  the session's own id, and folder creation still requires a brand-new session.
- **Clean-text fallback fires after 1 title-less turn by default**
  (`textFallbackTurns`, was 3), so folders get a readable name quickly even on
  gateways where the DSH title provider cannot produce titles. A later LLM
  title still upgrades the fallback name once.
- Documentation: the title-provider troubleshooting section now describes the
  verified upstream failure modes (64-token output budget consumed by
  reasoning; the token-plan gateway rejecting `reasoning_effort: "off"` for
  flash models) instead of recommending a global profile override. This plugin
  does not modify the DSH title plugins or their configuration.

## 0.3.0 - 2026-11-18

- **The folder is named from the DSH session title, not the raw first message.**
  The single rename used to run at the first step of the first turn, before the
  LLM title existed, so `title || text` picked the raw message (leading
  `@C:\...` paths and URLs) and consumed the rename quota; the good title that
  arrived later was locked out by the default-name gate. The folder now keeps
  its neutral `会话-YYYYMMDD-HHMMSS-id` name until a `session/title` event with
  `source.kind` `provider` (LLM) or `user` (manual rename) arrives. DSH's
  `fallback` title (leading words of the raw message) never names the folder.
- **Configurable rename policy.** `renamePolicy`: `once` (default — rename on
  the first LLM/manual title, then lock), `follow` (track every title update,
  i.e. adapt to "随对话更新标题", capped by `maxRenames`, default 3), `never`
  (no automatic rename). `followUserRename` (default true) lets a manual
  sidebar rename move the folder even when locked.
- **Clean-text fallback.** If no LLM/manual title has arrived after
  `textFallbackTurns` turns (default 3), the first message with @references and
  URLs stripped names the folder once; a later LLM title may still upgrade that
  name. `0` disables the fallback and keeps the timestamp name.
- Rename count and naming source persist in the marker file, so the `follow`
  cap survives application restarts.
- Note: folder naming depends on DSH actually producing LLM titles. If the
  title provider's `maxOutputTokens` is smaller than the model's default
  reasoning budget (e.g. the built-in 64 on a reasoning-by-default gateway),
  every title call fails silently and folders keep their fallback names. See
  the README verification section for the profile-side fix.

## 0.2.0 - 2026-11-14

- **The folder is renamed once.** DSH can refresh the session title on every
  prompt ("随对话更新标题"), and every rename moved the working directory,
  invalidated the addresses of already-open files and injected another
  `The working directory changed` notice into the conversation. `syncName` now
  renames only while the folder still carries the name this plugin gives it, so
  the folder follows the first title and then stays put.
- **An address with a folder name that no longer exists is repaired.** When a
  read fails with `workspace-file/not-found`, the shim asks whether the segment
  under the session folder still exists; if nothing carries that name any more
  the segment is dropped and the read is retried once. Files opened before a
  rename, or restored after a reload, open again — and a file that really is
  missing still reports the original error.

## 0.1.4 - 2026-11-14

- Read the session folder name from the client list row on every rewrite instead
  of caching it at page load. The title sync renames the folder while the page
  stays open, so the cached name kept prefixing addresses with a directory that
  no longer existed and files opened from the sidebar still reported
  `workspace-file/not-found` ("文件不存在") until DSH was reloaded.
- Drop a leading segment that names an earlier name of the same folder, so a tab
  restored after a rename opens its file instead of nesting the old name under
  the new one.

## 0.1.3 - 2026-11-11

- Cover the `remote.workspaceFiles` face as well as `sidebarRight.openResource`.
  Restored tabs and the file panel read through `remote.workspaceFiles`, so a
  shim that only rewrote `openResource` changed nothing (0.1.2 did exactly
  that and is superseded by this release).
- Keep the original compatibility layer untouched and degrade to the plain
  upstream behaviour if a seam cannot be wrapped.

## 0.1.2 - 2026-11-11

- Complete file addresses opened through the right sidebar to absolute paths, so
  files inside the managed session folder no longer report
  `workspace-file/not-found` ("the file does not exist") when the host resolves
  them against the session's original workspace root.
- Collapse a duplicated session-folder segment (`folder/folder/file`) while
  rewriting, which appears when the address was already built from the mirrored
  working directory.
- Folded into the existing compatibility layer, so DSH itself is untouched.

## 0.1.1 - 2026-11-02

- Mirror each session's effective working directory into DSH's client session state.
- Make the built-in Open In button and local-file actions target the managed session folder.
- Keep the compatibility layer isolated and degrade gracefully if DSH's internal client shape changes.

## 0.1.0 - 2026-11-02

- Create one isolated working folder for each new conversation in the default workspace.
- Rename the folder when the first message arrives and whenever the session title changes.
- Add a native folder picker and display the selected folder's availability.
- Support creating folders immediately or only after the first message.
- Preserve existing session folders across plugin restarts with durable marker files.
- Keep workspaces, historical sessions, and subagent sessions unchanged.
