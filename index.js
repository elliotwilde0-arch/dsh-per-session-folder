import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const PLUGIN = 'dsh-per-session-folder'
const MARKER = '.dsh-per-session-folder.json'
const LEGACY_MARKER = '.dsh-session-dir.json'
const MARKER_VERSION = 1
const DEFAULT_MAX_NAME_CHARS = 60
const DEFAULT_MAX_RENAMES = 3
const DEFAULT_TEXT_FALLBACK_TURNS = 3
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

/** Optional schema so the package still loads in a minimal development profile. */
let schema
try {
  schema = (await import('@deepseek-ai/schemastery')).default
} catch (error) {
  console.warn(`[${PLUGIN}] configuration UI unavailable: ${String(error)}`)
}

export const inject = ['workingDirectory', 'systemPrompt']

export const Config = schema
  ? schema.object({
      enabled: schema
        .boolean()
        .default(true)
        .description('启用后，默认工作区里的每个新对话会自动获得独立文件夹。'),
      root: schema
        .string()
        .default('')
        .volatile()
        .description('会话文件夹的根目录；留空表示使用默认工作区。支持绝对路径和环境变量。'),
      creationMode: schema
        .union(['immediate', 'first-message'])
        .default('immediate')
        .volatile()
        .description('immediate 在打开新对话时创建；first-message 在发送第一条消息时创建。'),
      workspacePath: schema
        .string()
        .default('')
        .description('需要隔离的默认工作区路径；通常留空，由插件自动识别。'),
      maxNameChars: schema
        .number()
        .min(12)
        .max(120)
        .default(DEFAULT_MAX_NAME_CHARS)
        .description('文件夹名的最大字符数。'),
      renamePolicy: schema
        .union(['once', 'follow', 'never'])
        .default('once')
        .volatile()
        .description('文件夹改名策略：once 等第一个 LLM/手动标题改一次名后锁定；follow 跟随每次标题更新（受 maxRenames 限制）；never 从不自动改名。'),
      followUserRename: schema
        .boolean()
        .default(true)
        .description('在侧边栏手动重命名会话时，文件夹是否跟随改名（不受 once/never 锁定影响）。'),
      maxRenames: schema
        .number()
        .min(1)
        .max(20)
        .default(DEFAULT_MAX_RENAMES)
        .description('follow 策略下自动改名的次数上限（手动改名不计入）。'),
      textFallbackTurns: schema
        .number()
        .min(0)
        .max(20)
        .default(DEFAULT_TEXT_FALLBACK_TURNS)
        .description('多少个回合结束后仍没有 LLM/手动标题时，用清洗后的首条消息文本（去掉 @引用和网址）给文件夹命名；0 表示禁用，文件夹保持时间戳名。'),
    })
  : undefined

function clampInt(value, min, max, fallback) {
  const parsed =
    typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
  return Math.min(max, Math.max(min, parsed))
}

function expandEnvironment(raw, home = os.homedir()) {
  let value = String(raw ?? '').trim()
  if (!value) return ''
  value = value.replace(/%([^%]+)%/g, (whole, key) => process.env[key] ?? whole)
  if (value === '~') return home
  if (value.startsWith(`~${path.sep}`)) return path.join(home, value.slice(2))
  return value
}

function normalizeForCompare(value) {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function samePath(left, right) {
  return (
    typeof left === 'string' &&
    left.length > 0 &&
    typeof right === 'string' &&
    right.length > 0 &&
    normalizeForCompare(left) === normalizeForCompare(right)
  )
}

function isInside(candidate, root) {
  const relative = path.relative(normalizeForCompare(root), normalizeForCompare(candidate))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function messageText(message) {
  const content = message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join(' ')
    .trim()
}

function isHumanMessage(message) {
  return message?.source?.kind === 'user' && messageText(message).length > 0
}

function firstCommittedUserText(session) {
  try {
    for (const event of session?.snapshotEvents?.() ?? []) {
      if (event?.type !== 'user/message') continue
      if (!isHumanMessage(event.data)) continue
      return messageText(event.data)
    }
  } catch {}
  return ''
}

function hasPriorConversation(session) {
  try {
    return (session?.snapshotEvents?.() ?? []).some(
      (event) =>
        event?.type === 'assistant/message' ||
        event?.type === 'tool/call' ||
        event?.type === 'turn/end' ||
        (event?.type === 'user/message' && isHumanMessage(event.data)),
    )
  } catch {
    return true
  }
}

/**
 * Latest non-empty session title together with its source kind. DSH emits
 * `session/title` with `source.kind` = 'fallback' (leading words of the first
 * message), 'provider' (LLM-generated) or 'user' (manual rename). Only the
 * latter two are meaningful folder names; the fallback is raw message text.
 */
export function latestTitleInfo(session) {
  try {
    const events = session?.snapshotEvents?.() ?? []
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event?.type !== 'session/title') continue
      const title = typeof event.data?.title === 'string' ? event.data.title.trim() : ''
      if (!title) continue
      const kind = event.data?.source?.kind
      return { title, kind: kind === 'provider' || kind === 'user' ? kind : 'fallback' }
    }
  } catch {}
  return { title: '', kind: '' }
}

function fallbackName(session) {
  const stamp = new Date(session?.header?.createdAt ?? Date.now())
  const pad = (value) => String(value).padStart(2, '0')
  const day = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}`
  const time = `${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`
  const id = String(session?.id ?? '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-8)
  return id ? `会话-${day}-${time}-${id}` : `会话-${day}-${time}`
}

/**
 * Whether the folder still carries the name this plugin gives it before a title
 * exists, i.e. whether a title has renamed it yet.
 */
export function isDefaultFolderName(name) {
  return (
    typeof name === 'string' && /^会话-\d{8}-\d{6}(-[a-z0-9]+)?$/iu.test(name)
  )
}

export function safeFolderName(raw, max = DEFAULT_MAX_NAME_CHARS) {
  let text = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  text = text.replace(ILLEGAL, '-')
  text = text.replace(/^[.\s]+/g, '').replace(/[.\s]+$/g, '')
  if (!text) return ''
  if (RESERVED.test(text)) text = `_${text}`
  const chars = Array.from(text)
  if (chars.length > max) text = chars.slice(0, max).join('').replace(/[.\s]+$/g, '')
  return text === '.' || text === '..' ? '' : text
}

const AT_REFERENCE = /(^|\s)@(?:"[^"]*"|[^\s@]+)/g
const URL_IN_TEXT =
  /\b(?:https?|ftp):\/\/[^\s<>"'`，。；、！？）】》]+|\bwww\.[^\s<>"'`，。；、！？）】》]+/gi
const EDGE_PUNCTUATION =
  /^[\s:：,，.。;；、!！?？~～\-—]+|[\s:：,，.。;；、!！?？~～\-—]+$/g

/**
 * Strip @file references and URLs from a message so the leftover prose can name
 * the folder when no LLM title ever arrives. `user@example.com` is kept intact
 * because the @ is not at a word boundary.
 */
export function cleanMessageText(raw) {
  let text = String(raw ?? '')
  text = text.replace(AT_REFERENCE, '$1 ')
  text = text.replace(URL_IN_TEXT, ' ')
  text = text.replace(/\s+/g, ' ').trim()
  text = text.replace(EDGE_PUNCTUATION, '')
  return text.trim()
}

/**
 * Decide whether a naming source may rename the folder.
 * kind: 'provider' (LLM title) | 'user' (manual rename) | 'text' (cleaned
 * first-message fallback). DSH's 'fallback' title never names the folder.
 */
export function renameDecision({
  policy,
  followUserRename,
  kind,
  isDefault,
  lastNameKind,
  renameCount,
  maxRenames,
}) {
  if (kind === 'user') return followUserRename ? 'rename' : 'skip'
  if (kind !== 'provider' && kind !== 'text') return 'skip'
  if (policy === 'never') return 'skip'
  if (policy === 'follow') return renameCount < maxRenames ? 'rename' : 'skip'
  if (isDefault) return 'rename'
  // once: a clean-text fallback name may still be upgraded to the first LLM title.
  if (kind === 'provider' && lastNameKind === 'text') return 'rename'
  return 'skip'
}

export function apply(ctx, rawConfig) {
  const rootReference = rawConfig?.root
  const creationModeReference = rawConfig?.creationMode
  const renamePolicyReference = rawConfig?.renamePolicy
  const rootValue = () => {
    const candidate =
      typeof rootReference?.get === 'function' ? rootReference.get() : rootReference
    return typeof candidate === 'string' ? candidate : ''
  }
  const creationModeValue = () => {
    const candidate =
      typeof creationModeReference?.get === 'function'
        ? creationModeReference.get()
        : creationModeReference
    return candidate === 'first-message' ? 'first-message' : 'immediate'
  }
  const renamePolicyValue = () => {
    const candidate =
      typeof renamePolicyReference?.get === 'function'
        ? renamePolicyReference.get()
        : renamePolicyReference
    return candidate === 'follow' || candidate === 'never' ? candidate : 'once'
  }
  const config = {
    enabled: rawConfig?.enabled !== false,
    get root() {
      return expandEnvironment(rootValue())
    },
    get creationMode() {
      return creationModeValue()
    },
    get renamePolicy() {
      return renamePolicyValue()
    },
    workspacePath: expandEnvironment(rawConfig?.workspacePath),
    maxNameChars: clampInt(
      rawConfig?.maxNameChars,
      12,
      120,
      DEFAULT_MAX_NAME_CHARS,
    ),
    followUserRename: rawConfig?.followUserRename !== false,
    maxRenames: clampInt(rawConfig?.maxRenames, 1, 20, DEFAULT_MAX_RENAMES),
    textFallbackTurns: clampInt(
      rawConfig?.textFallbackTurns,
      0,
      20,
      DEFAULT_TEXT_FALLBACK_TURNS,
    ),
  }
  if (!config.enabled) return

  const workingDirectory = ctx.workingDirectory
  const logger = ctx.logger
  const states = new Map()
  const activeTurns = new Set()
  const pendingRenames = new Set()
  const markerSearched = new Set()

  let workspaceCache

  const warn = (message) => {
    const text = `[${PLUGIN}] ${message}`
    try {
      if (typeof logger?.warn === 'function') logger.warn(text)
      else console.warn(text)
    } catch {}
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['settings'], (scope) => {
      scope.effect(
        () => scope.settings.configure({ auto: true }, ctx.fiber),
        'dsh-per-session-folder: auto settings',
      )
    })
  }

  const service = (name) => {
    try {
      return ctx.get?.(name)
    } catch {
      return undefined
    }
  }

  function workspaceRoot() {
    if (config.workspacePath) return path.resolve(config.workspacePath)
    if (workspaceCache) return workspaceCache

    try {
      const domain = service('storageDomain')?.get?.('workspace')
      const global = domain?.global?.get?.()
      const id = global?.defaultWorkspaceId
      if (typeof id === 'string' && id) {
        const workspace = service('workspaceRegistry')?.get?.(id)
        if (typeof workspace?.path === 'string' && workspace.path) {
          workspaceCache = path.resolve(workspace.path)
          return workspaceCache
        }
      }
    } catch (error) {
      warn(`读取默认工作区失败：${error?.message ?? error}`)
    }

    if (typeof workingDirectory?.defaultDirectory === 'string') {
      workspaceCache = path.resolve(workingDirectory.defaultDirectory)
    }
    return workspaceCache
  }

  function destinationRoot(workspace) {
    if (!config.root) return workspace
    return path.isAbsolute(config.root)
      ? path.resolve(config.root)
      : path.resolve(workspace, config.root)
  }

  function skipSession(session) {
    const header = session?.header
    return (
      !header ||
      header.origin === 'subagent' ||
      header.parentSession !== undefined ||
      typeof header.cwd !== 'string' ||
      header.cwd.length === 0
    )
  }

  function stateOf(session) {
    let state = states.get(session.id)
    if (!state) {
      state = {
        dir: undefined,
        desired: undefined,
        chain: Promise.resolve(),
        renameCount: 0,
        nameKind: '',
        turnsEnded: 0,
        createdAt: undefined,
      }
      states.set(session.id, state)
    }
    return state
  }

  function enqueue(state, operation) {
    state.chain = state.chain.then(async () => {
      try {
        await operation()
      } catch (error) {
        warn(`会话目录操作失败：${error?.message ?? error}`)
      }
    })
    return state.chain
  }

  async function isDirectory(target) {
    try {
      return (await stat(target)).isDirectory()
    } catch {
      return false
    }
  }

  async function readMarker(directory, sessionId) {
    for (const filename of [MARKER, LEGACY_MARKER]) {
      try {
        const marker = JSON.parse(
          await readFile(path.join(directory, filename), 'utf8'),
        )
        if (marker?.sessionId === sessionId) {
          return { ...marker, legacyMarker: filename === LEGACY_MARKER }
        }
      } catch {}
    }
    return undefined
  }

  async function writeMarker(directory, session, extra = {}) {
    const marker = {
      version: MARKER_VERSION,
      sessionId: session.id,
      createdAt:
        typeof extra.createdAt === 'string' && extra.createdAt
          ? extra.createdAt
          : new Date().toISOString(),
    }
    if (typeof extra.renameCount === 'number') marker.renameCount = extra.renameCount
    if (typeof extra.nameKind === 'string' && extra.nameKind) marker.nameKind = extra.nameKind
    await writeFile(path.join(directory, MARKER), JSON.stringify(marker), 'utf8')
  }

  async function findMarkedDirectory(root, sessionId) {
    if (!root) return undefined
    try {
      const entries = await readdir(root, { withFileTypes: true })
      const matches = []
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
        const candidate = path.join(root, entry.name)
        const marker = await readMarker(candidate, sessionId)
        if (marker) matches.push({ candidate, createdAt: marker.createdAt ?? '' })
      }
      matches.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      return matches[0]?.candidate
    } catch {
      return undefined
    }
  }

  async function uniqueDirectory(root, base, skip) {
    for (let index = 1; index <= 999; index += 1) {
      const candidate = path.join(root, index === 1 ? base : `${base}-${index}`)
      if (skip && samePath(candidate, skip)) return candidate
      try {
        await mkdir(candidate)
        return candidate
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
      }
    }
    const fallback = path.join(root, `${base}-${Date.now()}`)
    await mkdir(fallback)
    return fallback
  }

  async function uniqueRenameTarget(root, base, current) {
    for (let index = 1; index <= 999; index += 1) {
      const candidate = path.join(root, index === 1 ? base : `${base}-${index}`)
      if (samePath(candidate, current)) return candidate
      if (!(await isDirectory(candidate))) {
        try {
          await stat(candidate)
        } catch (error) {
          if (error?.code === 'ENOENT') return candidate
          continue
        }
      }
    }
    return path.join(root, `${base}-${Date.now()}`)
  }

  function adoptMarked(session, state, marked, marker) {
    state.dir = marked
    state.desired = path.basename(marked)
    state.createdAt = marker?.createdAt
    state.renameCount = typeof marker?.renameCount === 'number' ? marker.renameCount : 0
    state.nameKind = typeof marker?.nameKind === 'string' ? marker.nameKind : ''
  }

  async function adoptCurrent(session, state) {
    const current = workingDirectory.get(session)
    if (typeof current !== 'string' || !(await isDirectory(current))) return false
    const marker = await readMarker(current, session.id)
    if (!marker) return false
    if (marker.legacyMarker) {
      try {
        await writeMarker(current, session, { createdAt: marker.createdAt })
      } catch (error) {
        warn(`迁移会话目录标记失败：${error?.message ?? error}`)
      }
    }
    adoptMarked(session, state, current, marker)
    return true
  }

  async function createDirectory(agent, session, base) {
    const workspace = workspaceRoot()
    if (!workspace) throw new Error('无法确定默认工作区')
    const root = destinationRoot(workspace)
    await mkdir(root, { recursive: true })
    const directory = await uniqueDirectory(root, base)
    await writeMarker(directory, session)
    await workingDirectory.set(agent, directory)
    return directory
  }

  async function syncName(agent, session, state, preferredRaw, signal, kind) {
    const preferred = safeFolderName(preferredRaw, config.maxNameChars)
    if (!preferred || !(await isDirectory(state.dir))) return
    if (state.desired === preferred) return
    // Every rename moves the working directory, invalidates open file addresses
    // and injects a working-directory notice into the conversation, so each
    // naming source must pass the configured policy before the folder moves.
    const decision = renameDecision({
      policy: config.renamePolicy,
      followUserRename: config.followUserRename,
      kind,
      isDefault: isDefaultFolderName(path.basename(state.dir)),
      lastNameKind: state.nameKind,
      renameCount: state.renameCount,
      maxRenames: config.maxRenames,
    })
    if (decision !== 'rename') return

    const parent = path.dirname(state.dir)
    const target = await uniqueRenameTarget(parent, preferred, state.dir)
    if (!samePath(target, state.dir)) {
      try {
        await rename(state.dir, target)
      } catch (error) {
        warn(`重命名会话目录失败（${state.dir} → ${target}）：${error?.message ?? error}`)
        return
      }
    }

    try {
      await workingDirectory.set(agent, target, signal)
    } catch (error) {
      if (!samePath(target, state.dir)) {
        try {
          await rename(target, state.dir)
        } catch {}
      }
      throw error
    }

    state.dir = target
    state.desired = preferred
    state.nameKind = kind
    if (kind !== 'user') state.renameCount += 1
    try {
      await writeMarker(target, session, {
        createdAt: state.createdAt,
        renameCount: state.renameCount,
        nameKind: state.nameKind,
      })
    } catch (error) {
      warn(`更新会话目录标记失败：${error?.message ?? error}`)
    }
  }

  /**
   * Bring the folder name in line with the session title. LLM and manual titles
   * win immediately; while only DSH's raw-text fallback title exists the folder
   * keeps its timestamp name until `textFallbackTurns` turns have ended, then
   * the cleaned first message names it once.
   */
  async function syncNaming(agent, session, state, signal) {
    const { title, kind } = latestTitleInfo(session)
    if (title && (kind === 'provider' || kind === 'user')) {
      await syncName(agent, session, state, title, signal, kind)
      return
    }
    if (config.textFallbackTurns <= 0) return
    if (!isDefaultFolderName(path.basename(state.dir))) return
    if (state.turnsEnded < config.textFallbackTurns) return
    const cleaned = cleanMessageText(firstCommittedUserText(session))
    if (!cleaned) return
    await syncName(agent, session, state, cleaned, signal, 'text')
  }

  async function prepare(agent, messages, signal, allowCreate = true) {
    const session = agent?.session
    if (!session?.header || skipSession(session)) return

    const workspace = workspaceRoot()
    if (!workspace || !samePath(session.header.cwd, workspace)) return

    const state = stateOf(session)
    const current = workingDirectory.get(session)
    const { title, kind } = latestTitleInfo(session)
    // The raw first message (and DSH's fallback title built from it) must not
    // name the folder: it starts with @paths/URLs and would consume the single
    // rename before the LLM title exists. Wait for a provider/user title.
    const usableTitle = kind === 'provider' || kind === 'user' ? title : ''

    if (!state.dir) {
      if (await adoptCurrent(session, state)) {
        // The marker survived an application restart or plugin reload.
      } else if (
        samePath(current, workspace) &&
        !markerSearched.has(session.id) &&
        !hasPriorConversation(session)
      ) {
        markerSearched.add(session.id)
        const marked = await findMarkedDirectory(destinationRoot(workspace), session.id)
        if (marked) {
          const marker = await readMarker(marked, session.id)
          adoptMarked(session, state, marked, marker)
          await workingDirectory.set(agent, marked, signal)
        }
      }
    }

    if (!state.dir) {
      if (!allowCreate || !samePath(current, workspace) || hasPriorConversation(session)) return
      const base = safeFolderName(usableTitle, config.maxNameChars) || fallbackName(session)
      const directory = await createDirectory(agent, session, base)
      state.dir = directory
      state.desired = base
      state.createdAt = new Date().toISOString()
      return
    }

    if (!(await isDirectory(state.dir))) {
      const marked = await findMarkedDirectory(path.dirname(state.dir), session.id)
      if (marked) {
        const marker = await readMarker(marked, session.id)
        adoptMarked(session, state, marked, marker)
        await workingDirectory.set(agent, marked, signal)
      } else {
        states.delete(session.id)
        return
      }
    }

    if (samePath(workingDirectory.get(session), workspace)) {
      await workingDirectory.set(agent, state.dir, signal)
    }

    await syncNaming(agent, session, state, signal)
    pendingRenames.delete(session.id)
  }

  async function queuePrepare(agent, messages, signal, allowCreate = true) {
    const session = agent?.session
    if (!session?.id) return
    await enqueue(stateOf(session), () => prepare(agent, messages, signal, allowCreate))
  }

  async function queueTitleSync(agent) {
    const session = agent?.session
    if (!session?.id) return
    await enqueue(stateOf(session), async () => {
      const workspace = workspaceRoot()
      if (!workspace || skipSession(session) || !samePath(session.header.cwd, workspace)) return
      const state = states.get(session.id)
      if (!state?.dir) return
      await syncNaming(agent, session, state)
      pendingRenames.delete(session.id)
    })
  }

  function onSessionEvent(session, event) {
    if (!session?.id) return
    if (event?.type === 'turn/start') {
      activeTurns.add(session.id)
      return
    }
    if (event?.type === 'turn/end') {
      activeTurns.delete(session.id)
      const state = states.get(session.id)
      if (state) state.turnsEnded += 1
      // Sync on every turn end: a title may have arrived mid-turn, and the
      // clean-text fallback becomes due after enough title-less turns.
      if (state?.dir || pendingRenames.has(session.id)) {
        const agent = service('agents')?.get?.(session.id)
        if (agent) void queueTitleSync(agent)
      }
      return
    }
    if (event?.type !== 'session/title') return
    const kind = event.data?.source?.kind
    if (kind !== 'provider' && kind !== 'user') return
    pendingRenames.add(session.id)
    if (activeTurns.has(session.id)) return
    const agent = service('agents')?.get?.(session.id)
    if (agent) void queueTitleSync(agent)
  }

  ctx.effect(() => {
    const disposers = []

    disposers.push(
      ctx.on(
        'system-prompt/assemble',
        async (_assembly, context, next) => {
          if (context?.agent) {
            try {
              await queuePrepare(context.agent, undefined, context.signal)
            } catch (error) {
              warn(`准备会话目录失败：${error?.message ?? error}`)
            }
          }
          return next()
        },
        { prepend: true },
      ),
    )

    disposers.push(
      ctx.on(
        'agent/pre-step',
        async (payload, next) => {
          try {
            const agent = payload?.agent
            const session = agent?.session
            const allowCreate =
              payload?.turn === 1 && payload?.step === 1 && !hasPriorConversation(session)
            await queuePrepare(agent, payload?.messages, payload?.signal, allowCreate)
          } catch (error) {
            warn(`首个步骤前准备会话目录失败：${error?.message ?? error}`)
          }
          return next()
        },
        { prepend: true },
      ),
    )

    disposers.push(
      ctx.on('agent/created', (payload) => {
        const agent = payload?.agent
        if (!agent?.session) return
        const session = agent.session
        if (skipSession(session) || hasPriorConversation(session)) return
        if (config.creationMode === 'first-message') return
        return queuePrepare(agent, undefined, undefined, true)
      }),
    )

    disposers.push(ctx.on('session/event', onSessionEvent))

    return () => {
      for (const dispose of disposers) {
        try {
          if (typeof dispose === 'function') dispose()
        } catch {}
      }
    }
  })
}
