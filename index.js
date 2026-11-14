import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const PLUGIN = 'dsh-per-session-folder'
const MARKER = '.dsh-per-session-folder.json'
const LEGACY_MARKER = '.dsh-session-dir.json'
const MARKER_VERSION = 1
const DEFAULT_MAX_NAME_CHARS = 60
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

function textFromMessages(messages) {
  if (!Array.isArray(messages)) return ''
  for (const message of messages) {
    if (isHumanMessage(message)) return messageText(message)
  }
  return ''
}

function textFromInbox(agent) {
  const inbox = agent?.inbox
  const groups = [inbox?.nextTurn, inbox?.nextStep]
  for (const group of groups) {
    if (!Array.isArray(group)) continue
    for (const message of group) {
      if (isHumanMessage(message)) return messageText(message)
    }
  }
  return ''
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

function latestTitle(session) {
  try {
    const events = session?.snapshotEvents?.() ?? []
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event?.type === 'session/title' && typeof event.data?.title === 'string') {
        return event.data.title.trim()
      }
    }
  } catch {}
  return ''
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

export function apply(ctx, rawConfig) {
  const rootReference = rawConfig?.root
  const creationModeReference = rawConfig?.creationMode
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
  const config = {
    enabled: rawConfig?.enabled !== false,
    get root() {
      return expandEnvironment(rootValue())
    },
    get creationMode() {
      return creationModeValue()
    },
    workspacePath: expandEnvironment(rawConfig?.workspacePath),
    maxNameChars: clampInt(
      rawConfig?.maxNameChars,
      12,
      120,
      DEFAULT_MAX_NAME_CHARS,
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
      state = { dir: undefined, desired: undefined, chain: Promise.resolve() }
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

  async function writeMarker(directory, session) {
    const marker = {
      version: MARKER_VERSION,
      sessionId: session.id,
      createdAt: new Date().toISOString(),
    }
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

  async function adoptCurrent(session, state) {
    const current = workingDirectory.get(session)
    if (typeof current !== 'string' || !(await isDirectory(current))) return false
    const marker = await readMarker(current, session.id)
    if (!marker) return false
    if (marker.legacyMarker) {
      try {
        await writeMarker(current, session)
      } catch (error) {
        warn(`迁移会话目录标记失败：${error?.message ?? error}`)
      }
    }
    state.dir = current
    state.desired = path.basename(current)
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

  async function syncName(agent, session, state, preferredRaw, signal) {
    const preferred = safeFolderName(preferredRaw, config.maxNameChars)
    if (!preferred || !(await isDirectory(state.dir))) return
    if (state.desired === preferred) return
    // The title can change on every prompt, but the folder is renamed once: each
    // rename moves the working directory, invalidates open file addresses and
    // injects another working-directory notice into the conversation.
    if (!isDefaultFolderName(path.basename(state.dir))) return

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
  }

  async function prepare(agent, messages, signal, allowCreate = true) {
    const session = agent?.session
    if (!session?.header || skipSession(session)) return

    const workspace = workspaceRoot()
    if (!workspace || !samePath(session.header.cwd, workspace)) return

    const state = stateOf(session)
    const current = workingDirectory.get(session)
    const text =
      textFromMessages(messages) || textFromInbox(agent) || firstCommittedUserText(session)
    const title = latestTitle(session)
    const preferred = title || text || fallbackName(session)

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
          state.dir = marked
          state.desired = path.basename(marked)
          await workingDirectory.set(agent, marked, signal)
        }
      }
    }

    if (!state.dir) {
      if (!allowCreate || !samePath(current, workspace) || hasPriorConversation(session)) return
      const base = safeFolderName(preferred, config.maxNameChars) || fallbackName(session)
      const directory = await createDirectory(agent, session, base)
      state.dir = directory
      state.desired = base
      return
    }

    if (!(await isDirectory(state.dir))) {
      const marked = await findMarkedDirectory(path.dirname(state.dir), session.id)
      if (marked) {
        state.dir = marked
        await workingDirectory.set(agent, marked, signal)
      } else {
        states.delete(session.id)
        return
      }
    }

    if (samePath(workingDirectory.get(session), workspace)) {
      await workingDirectory.set(agent, state.dir, signal)
    }

    const hasMeaningfulName = Boolean(title || text)
    if (hasMeaningfulName || pendingRenames.has(session.id)) {
      await syncName(agent, session, state, preferred, signal)
      pendingRenames.delete(session.id)
    }
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
      const title = latestTitle(session)
      if (!title) return
      await syncName(agent, session, state, title)
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
      if (pendingRenames.has(session.id)) {
        const agent = service('agents')?.get?.(session.id)
        if (agent) void queueTitleSync(agent)
      }
      return
    }
    if (event?.type !== 'session/title') return
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
