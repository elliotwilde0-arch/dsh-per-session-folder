window.__ModuleLoader__.load({
  id: 'dsh-per-session-folder',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement

    const NS = 'dsh-per-session-folder'
    const ROW_NS = 'session-dir'
    const BUNDLE_KEY = 'dsh-per-session-folder'

    const zh = {
      title: 'Session Folders Settings',
      description: '设置新对话的独立文件夹放在哪里。',
      root: '会话文件夹的根目录',
      rootHint:
        '只会影响之后新建的对话，旧文件夹不会搬动。未选择时使用默认工作区。',
      currentPath: '当前路径',
      defaultPath: '默认工作区（未选择）',
      choose: '选择文件夹…',
      choosing: '正在打开…',
      pickFailed: '没有打开文件夹选择器，请重试。',
      useDefault: '使用默认工作区',
      pathDefault: '将使用默认工作区。',
      pathChecking: '正在检查文件夹…',
      pathReady: '文件夹可访问。',
      pathSelected: '文件夹已设置；创建新会话时会再次检查。',
      pathError: '这个文件夹无法访问，请重新选择。',
      creationMode: '创建时机',
      creationModeHint: '“打开时创建”会立刻生成文件夹；“首条消息时创建”可避免留下空文件夹。',
      creationImmediate: '打开对话时创建',
      creationFirstMessage: '首条消息时创建',
      overridden: '已覆盖',
      reset: '恢复默认',
      readOnly: '本部署的设置为只读。',
      unavailable: '该插件当前未加载，暂时无法配置。',
      save: '保存',
      saving: '保存中…',
      saveFailed: '路径没有被接受，请检查后重试。',
    }

    const en = {
      title: 'Session Folders Settings',
      description: 'Choose where new conversations keep their independent folders.',
      root: 'Session folder root',
      rootHint:
        'Only new conversations use this location. Existing folders are not moved; without a selection the default workspace is used.',
      currentPath: 'Current path',
      defaultPath: 'Default workspace (not selected)',
      choose: 'Choose folder…',
      choosing: 'Opening…',
      pickFailed: 'The folder picker could not be opened. Try again.',
      useDefault: 'Use default workspace',
      pathDefault: 'The default workspace will be used.',
      pathChecking: 'Checking folder…',
      pathReady: 'Folder is accessible.',
      pathSelected: 'Folder selected. Access will be checked when a session starts.',
      pathError: 'This folder is not accessible. Choose another folder.',
      creationMode: 'Creation timing',
      creationModeHint:
        'Create on open gives every new chat a folder immediately. Create on first message avoids empty folders.',
      creationImmediate: 'Create on open',
      creationFirstMessage: 'Create on first message',
      overridden: 'Overridden',
      reset: 'Reset to default',
      readOnly: 'This deployment stores settings read-only.',
      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      save: 'Save',
      saving: 'Saving…',
      saveFailed: 'The path was not accepted. Check it and try again.',
    }

    function labels(t) {
      return {
        unavailable: t('unavailable'),
        readOnly: t('readOnly'),
        saveFailed: t('saveFailed'),
        save: t('save'),
        saving: t('saving'),
      }
    }

    function SessionDirCard(props) {
      const { t } = props
      const state = props.useSessionDirCard((snapshot) => snapshot)
      const [picking, setPicking] = React.useState(false)
      const [pickError, setPickError] = React.useState('')
      const [pathStatus, setPathStatus] = React.useState('default')

      const rootText =
        typeof state.root?.text === 'string' ? state.root.text.trim() : ''
      const currentPath = rootText || t('defaultPath')
      const creationMode =
        state.creationMode?.text === 'first-message'
          ? 'first-message'
          : 'immediate'

      React.useEffect(() => {
        let active = true
        if (!rootText) {
          setPathStatus('default')
          return () => {
            active = false
          }
        }
        if (!props.canVerifyDirectory) {
          setPathStatus('selected')
          return () => {
            active = false
          }
        }
        setPathStatus('checking')
        Promise.resolve(props.listDirectory(rootText)).then(
          () => {
            if (active) setPathStatus('ready')
          },
          (reason) => {
            if (active) {
              const message = String(reason?.message ?? reason)
              setPathStatus(
                message.includes('needs the browse capability') ||
                  message.includes('directory-picker/unavailable')
                  ? 'selected'
                  : 'error',
              )
            }
          },
        )
        return () => {
          active = false
        }
      }, [rootText, props.canVerifyDirectory, props.listDirectory])

      if (props.view === 'summary') return t('description')

      const choose = async () => {
        if (picking) return
        setPicking(true)
        setPickError('')
        try {
          const picked = await props.pickDirectory()
          if (typeof picked === 'string' && picked.length > 0) {
            props.edit('root', picked)
          }
        } catch {
          setPickError(t('pickFailed'))
        } finally {
          setPicking(false)
        }
      }

      return h(
        'section',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            padding: 16,
            border: '1px solid var(--dsw-alias-border-l2)',
            borderRadius: 12,
          },
        },
        h('h3', { style: { margin: 0, fontSize: 16 } }, t('title')),
        h('p', { style: { margin: 0, opacity: 0.72, fontSize: 13 } }, t('description')),
        h(
          primitives.SettingsForm,
          {
            labels: labels(t),
            state,
            onSave: props.save,
            onDiscard: props.discard,
          },
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h('div', { style: { fontSize: 13, fontWeight: 600 } }, t('root')),
            h(
              'div',
              {
                style: {
                  padding: '9px 11px',
                  borderRadius: 8,
                  border: '1px solid var(--dsw-alias-border-l2)',
                  color: 'var(--dsw-alias-label-secondary)',
                  fontFamily: 'var(--dsw-font-family-mono, monospace)',
                  fontSize: 12,
                  overflowWrap: 'anywhere',
                },
              },
              currentPath,
            ),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h(
                primitives.Button,
                {
                  variant: 'outline',
                  size: 'sm',
                  disabled: !state.writable || picking,
                  onClick: choose,
                },
                picking ? t('choosing') : t('choose'),
              ),
              currentPath === t('defaultPath')
                ? null
                : h(
                    primitives.Button,
                    {
                      variant: 'ghost',
                      size: 'sm',
                      disabled: !state.writable,
                      onClick: () => props.resetField('root'),
                    },
                    t('useDefault'),
                  ),
            ),
            h(
              'div',
              {
                style: {
                  color: pickError
                    ? 'var(--dsw-alias-state-error-primary)'
                    : pathStatus === 'error'
                      ? 'var(--dsw-alias-state-error-primary)'
                      : pathStatus === 'ready'
                        ? 'var(--dsw-alias-state-success-primary, #48c78e)'
                    : 'var(--dsw-alias-label-tertiary)',
                  fontSize: 12,
                },
              },
              pickError ||
                (pathStatus === 'checking'
                  ? t('pathChecking')
                  : pathStatus === 'ready'
                    ? t('pathReady')
                    : pathStatus === 'error'
                      ? t('pathError')
                      : pathStatus === 'selected'
                        ? t('pathSelected')
                      : pathStatus === 'default'
                        ? t('pathDefault')
                        : t('rootHint')),
            ),
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  paddingTop: 12,
                  borderTop: '1px solid var(--dsw-alias-border-l2)',
                },
              },
              h('div', { style: { fontSize: 13, fontWeight: 600 } }, t('creationMode')),
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                h(
                  primitives.Button,
                  {
                    variant: creationMode === 'immediate' ? 'primary' : 'outline',
                    size: 'sm',
                    disabled: !state.writable,
                    onClick: () => props.edit('creationMode', 'immediate'),
                  },
                  t('creationImmediate'),
                ),
                h(
                  primitives.Button,
                  {
                    variant:
                      creationMode === 'first-message' ? 'primary' : 'outline',
                    size: 'sm',
                    disabled: !state.writable,
                    onClick: () => props.edit('creationMode', 'first-message'),
                  },
                  t('creationFirstMessage'),
                ),
              ),
              h(
                'div',
                {
                  style: {
                    color: 'var(--dsw-alias-label-tertiary)',
                    fontSize: 12,
                  },
                },
                t('creationModeHint'),
              ),
            ),
          ),
        ),
      )
    }

    /**
     * DSH keeps the session's original workspace in the list-row `cwd`, while
     * this plugin changes the effective working-directory projection. The
     * Open In control reads the list row, so mirror the effective directory
     * until DSH updates the summary itself. This is deliberately isolated and
     * fails quietly if the internal client shape changes.
     */
    function installWorkingDirectoryCompatibility(ctx) {
      const sessions = ctx.sessions
      const list = sessions?.list
      if (
        typeof sessions?.binding !== 'function' ||
        typeof list?.getSnapshot !== 'function' ||
        typeof list?.subscribe !== 'function' ||
        typeof list?.set !== 'function'
      ) {
        return () => {}
      }

      let disposed = false
      let scheduled = false
      let warned = false

      const reconcile = () => {
        if (disposed) return
        const snapshot = list.getSnapshot()
        if (!Array.isArray(snapshot?.ids) || !snapshot?.byId) return

        let changed = false
        const byId = { ...snapshot.byId }
        for (const sessionId of snapshot.ids) {
          const row = byId[sessionId]
          if (!row) continue
          let workingDirectory
          try {
            workingDirectory = sessions
              .binding(sessionId)
              ?.session?.projections?.get?.('workingDirectory')
          } catch {
            continue
          }
          if (
            typeof workingDirectory === 'string' &&
            workingDirectory.length > 0 &&
            row.cwd !== workingDirectory
          ) {
            if (workspaceRoot === '') workspaceRoot = row.cwd
            const previous = relativeUnder(workspaceRoot, row.cwd)
            if (previous !== '' && previous.includes('/') === false) {
              rememberFolder(sessionId, previous)
            }
            if (!originalRoots.has(sessionId)) {
              originalRoots.set(
                sessionId,
                relativeUnder(row.cwd, workingDirectory),
              )
            }
            byId[sessionId] = { ...row, cwd: workingDirectory }
            changed = true
          }
        }

        if (!changed) return
        try {
          list.set({ ...snapshot, byId })
        } catch (error) {
          if (!warned) {
            warned = true
            console.warn(
              'dsh-per-session-folder: working-directory UI compatibility unavailable:',
              error,
            )
          }
        }
      }

      const schedule = () => {
        if (disposed || scheduled) return
        scheduled = true
        queueMicrotask(() => {
          scheduled = false
          reconcile()
        })
      }

      let stop
      try {
        stop = list.subscribe(schedule)
        schedule()
      } catch (error) {
        if (!warned) {
          console.warn(
            'dsh-per-session-folder: working-directory UI compatibility unavailable:',
            error,
          )
        }
        return () => {}
      }

      return () => {
        disposed = true
        if (typeof stop === 'function') stop()
      }
    }

    /**
     * Compatibility shim for workspace file addresses (v6).
     *
     * DSH resolves the path carried by a `dsh-resource://file/...` address
     * against the Session's workspace root (header.cwd), while this plugin
     * mirrors the effective working directory (the per-session folder) into
     * the client list row. Client code that derives a relative address from
     * that row therefore hands the Host a path relative to the session folder,
     * which the Host looks up under the workspace root and reports as
     * `workspace-file/not-found`.
     *
     * Two seams:
     *   1. `ctx.sidebarRight.openResource(url)` — normalise the address when a
     *      file is opened (missing prefix, duplicated prefix).
     *   2. The `remote.workspaceFiles` face — for tabs restored from storage,
     *      which are read without going through openResource.
     *
     * Everything is recorded on `globalThis.__psf` for DevTools inspection.
     */
    const originalRoots = new Map()

    /**
     * Every folder name a session has used. The title sync renames the folder
     * while the page stays open, so an address produced earlier can still carry
     * a name the directory no longer has.
     */
    const historicFolders = new Map()

    function rememberFolder(sessionId, name) {
      if (typeof name !== 'string' || name === '') return
      let names = historicFolders.get(sessionId)
      if (names === undefined) {
        names = new Set()
        historicFolders.set(sessionId, names)
      }
      names.add(name)
    }

    /** A folder named by the plugin's own default (`会话-YYYYMMDD-HHMMSS-id`). */
    function isSessionFolderName(name) {
      return (
        typeof name === 'string' && /^会话-\d{8}-\d{6}(-[a-z0-9]+)?$/iu.test(name)
      )
    }

    const psf = (globalThis.__psf = {
      version: 6,
      loadedAt: new Date().toISOString(),
      steps: [],
      calls: [],
      wrapped: [],
      probes: [],
    })

    function note(step, extra) {
      if (psf.steps.length > 60) psf.steps.shift()
      psf.steps.push(extra === undefined ? step : step + ' :: ' + extra)
    }

    console.warn('[psf] client module loaded (v6)')
    setTimeout(() => {
      try {
        console.warn('[psf] state after boot :: ' + JSON.stringify(psf))
      } catch (error) {
        console.warn('[psf] state dump failed', error)
      }
    }, 4000)

    function normalizedPath(value) {
      return value.replace(/\\/g, '/').replace(/\/+$/, '')
    }

    function relativeUnder(root, target) {
      if (typeof root !== 'string' || typeof target !== 'string') return ''
      const base = normalizedPath(root)
      const full = normalizedPath(target)
      if (base === '' || full === '') return ''
      if (!full.toLowerCase().startsWith(base.toLowerCase() + '/')) return ''
      return full.slice(base.length + 1)
    }

    function isAbsolutePath(value) {
      return (
        /^[a-zA-Z]:\//.test(value) ||
        value.startsWith('/') ||
        value.startsWith('//')
      )
    }

    /** Drop every leading segment equal to the session folder, then add it back once. */
    function normalizeForFolder(sessionId, path) {
      if (typeof path !== 'string' || path === '') return path
      const normalized = path.replace(/\\/g, '/')
      if (isAbsolutePath(normalized)) return path
      const prefix = prefixFor(sessionId)
      if (typeof prefix !== 'string' || prefix === '') return path
      const segments = normalized.split('/')
      // An address built before a rename still starts with the old folder name:
      // drop it instead of nesting it under the current one.
      const historic = historicFolders.get(sessionId)
      while (
        segments.length > 1 &&
        segments[0] !== prefix &&
        (isSessionFolderName(segments[0]) || historic?.has(segments[0]) === true)
      ) {
        segments.shift()
      }
      while (segments.length > 1 && segments[0] === prefix) segments.shift()
      const rest = segments.join('/')
      if (rest === '') return path
      return prefix + '/' + rest
    }

    let workspaceRoot = ''
    let sessionRows = undefined

    /**
     * The session folder name, relative to the workspace root.
     *
     * Read from the row on every call. A name cached at page load goes stale as
     * soon as the title sync renames the folder, and a stale name prefixes every
     * address with a directory that no longer exists.
     */
    function prefixFor(sessionId) {
      try {
        const rows = sessionRows?.()
        const row = rows?.[sessionId]
        const folder = row?.cwd ?? row?.projectionValues?.workingDirectory
        if (typeof folder === 'string' && workspaceRoot !== '') {
          const live = relativeUnder(workspaceRoot, folder)
          if (live !== '' && live.includes('/') === false) {
            originalRoots.set(sessionId, live)
            return live
          }
        }
      } catch (error) {
        note('prefix lookup failed', String(error))
      }
      const known = originalRoots.get(sessionId)
      if (typeof known === 'string' && known !== '') return known
      return ''
    }

    function prefixedPath(sessionId, path) {
      if (typeof path !== 'string' || path === '') return undefined
      const prefix = prefixFor(sessionId)
      if (typeof prefix !== 'string' || prefix === '') return undefined
      const normalized = path.replace(/\\/g, '/')
      if (isAbsolutePath(normalized)) return undefined
      if (normalized === prefix || normalized.startsWith(prefix + '/')) return undefined
      return prefix + '/' + normalized
    }

    /**
     * The first segment under the session folder can be a folder name from
     * before a rename. When nothing carrying that name exists any more, hand
     * back the path without it, so a stored address still reaches its file.
     *
     * The probe runs first: a segment that does exist means the address is right
     * and the file really is gone, and then nothing is rewritten.
     */
    async function stripUnknownSegment(files, probe, sessionId, wrapped) {
      if (typeof probe !== 'function') return undefined
      const prefix = prefixFor(sessionId)
      if (typeof prefix !== 'string' || prefix === '') return undefined
      const normalized = wrapped.replace(/\\/g, '/')
      if (!normalized.startsWith(prefix + '/')) return undefined
      const segments = normalized.slice(prefix.length + 1).split('/')
      if (segments.length < 2) return undefined
      try {
        await probe.call(files, sessionId, prefix + '/' + segments[0])
        return undefined
      } catch (error) {
        if (!isMissingFile(error)) return undefined
      }
      return prefix + '/' + segments.slice(1).join('/')
    }

    function isMissingFile(error) {
      const code = String(error?.code ?? error?.data?.code ?? '')
      if (code === 'workspace-file/not-found') return true
      return /workspace-file\/not-found/.test(String(error?.message ?? ''))
    }

    /** Try each known access shape for the workspace-files face. */
    function probeWorkspaceFiles(scope) {
      const attempts = [
        ['declared-ns', () => scope.workspaceFiles],
        ['bracket', () => scope['remote.workspaceFiles']],
        ['property', () => scope.remote.workspaceFiles],
        ['reflect-ns', () => scope.reflect?.get?.('remote.workspaceFiles')?.value],
        ['reflect-remote-then-ns', () => scope.reflect?.get?.('remote')?.value?.workspaceFiles],
        ['remote-keys', () => Object.keys(scope.remote ?? {})],
      ]
      let found
      for (const [name, read] of attempts) {
        const entry = { name }
        try {
          const value = read()
          entry.ok = true
          entry.type = typeof value
          if (value !== null && value !== undefined && typeof value === 'object') {
            entry.keys = Object.keys(value).slice(0, 12)
            if (typeof value.read === 'function' || typeof value.stat === 'function') {
              found = value
            }
          } else if (Array.isArray(value)) {
            entry.value = value
          }
        } catch (error) {
          entry.ok = false
          entry.error = String(error?.message ?? error)
        }
        psf.probes.push(entry)
      }
      if (psf.probes.length > 40) psf.probes = psf.probes.slice(-40)
      return found
    }

    function replaceMethod(owner, name, wrap) {
      const original = owner[name]
      if (typeof original !== 'function') return undefined
      const wrapped = wrap(original)
      try {
        owner[name] = wrapped
        if (owner[name] === wrapped) return { original, how: 'own' }
      } catch (error) {
        note('assign threw', name + ': ' + String(error))
      }
      try {
        Object.defineProperty(owner, name, {
          value: wrapped,
          configurable: true,
          writable: true,
          enumerable: false,
        })
        if (owner[name] === wrapped) return { original, how: 'define' }
      } catch (error) {
        note('defineProperty threw', name + ': ' + String(error))
      }
      try {
        const proto = Object.getPrototypeOf(owner)
        if (proto !== null && typeof proto[name] === 'function') {
          proto[name] = wrapped
          return { original, how: 'prototype' }
        }
      } catch (error) {
        note('prototype patch threw', name + ': ' + String(error))
      }
      return undefined
    }

    function wrapWorkspaceFiles(files) {
      if (files === undefined || files === null) return 0
      if (files.__psfWrapped === true) return 1
      let count = 0
      // The unwrapped stat answers whether a path exists, which is what tells a
      // stale folder name apart from a file that really is missing.
      const probe = typeof files.stat === 'function' ? files.stat : undefined
      for (const name of ['read', 'stat', 'readBytes', 'list']) {
        const result = replaceMethod(files, name, (original) =>
          async function (sessionId, path, ...rest) {
            const normalized = normalizeForFolder(sessionId, path)
            if (psf.calls.length < 40) {
              psf.calls.push({ op: name, path: path, normalized: normalized })
            }
            if (normalized === path) return original.call(this, sessionId, path, ...rest)
            try {
              return await original.call(this, sessionId, normalized, ...rest)
            } catch (error) {
              if (!isMissingFile(error)) throw error
              note('not-found fallback', name + ' ' + path)
              if (name !== 'list') {
                const stripped = await stripUnknownSegment(files, probe, sessionId, normalized)
                if (stripped !== undefined) {
                  note('stale segment dropped', path + ' -> ' + stripped)
                  try {
                    return await original.call(this, sessionId, stripped, ...rest)
                  } catch (retryError) {
                    if (!isMissingFile(retryError)) throw retryError
                  }
                }
              }
              return original.call(this, sessionId, path, ...rest)
            }
          },
        )
        if (result === undefined) note('wrap failed', name)
        else {
          count += 1
          psf.wrapped.push(name + ':' + result.how)
        }
      }
      try {
        Object.defineProperty(files, '__psfWrapped', { value: true, configurable: true })
      } catch {
        /* ignore */
      }
      return count
    }

    function installAddressCompatibility(scope) {
      psf.attempts = (psf.attempts ?? 0) + 1
      const files = probeWorkspaceFiles(scope)
      if (files === undefined) {
        note('workspaceFiles not reachable', 'attempt ' + psf.attempts)
        return 0
      }
      const count = wrapWorkspaceFiles(files)
      if (count === 0) {
        note('workspaceFiles reached but not wrapped', 'attempt ' + psf.attempts)
        return 0
      }
      if (psf.installedAt === undefined) psf.installedAt = new Date().toISOString()
      console.warn('[psf] workspaceFiles shim active: ' + psf.wrapped.join(', '))
      return count
    }

    function installLazyAddressShim(scope) {
      let done = false
      let stopped = false
      let timer
      let deadline
      const attempt = () => {
        if (done || stopped) return
        try {
          if (installAddressCompatibility(scope) > 0) {
            done = true
            if (timer !== undefined) clearInterval(timer)
            if (deadline !== undefined) clearTimeout(deadline)
            return
          }
        } catch (error) {
          psf.lastError = String(error)
        }
        if (psf.attempts >= 6 && psf.probes.length > 0 && timer !== undefined) {
          clearInterval(timer)
          stopped = true
        }
      }
      attempt()
      if (!done && !stopped) {
        timer = setInterval(attempt, 800)
        deadline = setTimeout(() => {
          stopped = true
          if (timer !== undefined) clearInterval(timer)
          console.warn('[psf] stopped polling remote.workspaceFiles')
        }, 120000)
      }
      return () => {
        stopped = true
        if (timer !== undefined) clearInterval(timer)
        if (deadline !== undefined) clearTimeout(deadline)
      }
    }

    function installOpenResourceCompatibility(ctx) {
      const sidebar = ctx.sidebarRight
      if (sidebar === undefined || sidebar === null) {
        note('no sidebarRight service')
        return () => {}
      }
      try {
        const list = ctx.sessions?.list
        if (typeof list?.getSnapshot === 'function') {
          sessionRows = () => list.getSnapshot().byId
          note('session rows available')
        }
      } catch (error) {
        note('session rows unavailable', String(error))
      }
      const result = replaceMethod(sidebar, 'openResource', (original) =>
        function (url, ...rest) {
          let rewritten = url
          if (typeof url === 'string' && url.startsWith('dsh-resource://file/session/')) {
            const marker = '/file/session/'
            const at = url.indexOf(marker)
            const after = url.slice(at + marker.length)
            const slash = after.indexOf('/')
            if (slash > 0) {
              const sessionId = after.slice(0, slash)
              const raw = after.slice(slash + 1)
              let decoded = raw
              try {
                decoded = decodeURIComponent(raw)
              } catch {
                /* keep raw */
              }
              const normalized = normalizeForFolder(sessionId, decoded)
              if (normalized !== decoded) {
                rewritten =
                  url.slice(0, at + marker.length) +
                  sessionId +
                  '/' +
                  encodeURIComponent(normalized)
                note('openResource rewrite', decoded + ' -> ' + normalized)
              }
            }
          }
          return original.call(this, rewritten, ...rest)
        },
      )
      if (result === undefined) {
        console.warn('[psf] openResource shim could not wrap')
        return () => {}
      }
      psf.wrapped.push('openResource:' + result.how)
      console.warn('[psf] openResource shim active (' + result.how + ')')
      return () => {
        try {
          sidebar.openResource = result.original
        } catch {
          /* ignore */
        }
      }
    }

    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(
        () =>
          ctx.locale.register(NS, {
            zh,
            en,
          }),
        'dsh-per-session-folder: dictionaries',
      )

      const form = new primitives.SettingsFormModel(ctx.configForms.get(ROW_NS), [
        primitives.settingsTextField('root'),
        primitives.settingsTextField('creationMode'),
      ])
      const store = form.bind(() => ({
        ...form.shell(),
        root: form.field('root'),
        creationMode: form.field('creationMode'),
      }))
      const desktopPicker = globalThis.__DSH_DIRECTORY_PICKER__
      const canVerifyDirectory =
        typeof desktopPicker?.pick !== 'function'
      const pickDirectory =
        typeof desktopPicker?.pick === 'function'
          ? () => desktopPicker.pick()
          : () => ctx.uiWorkspace.pickDirectory()
      const listDirectory = (directory) =>
        ctx.uiWorkspace.listDirectory(directory)
      ctx.effect(
        () => () => form.dispose(),
        'dsh-per-session-folder: form subscription',
      )

      ctx.effect(
        () => installWorkingDirectoryCompatibility(ctx),
        'dsh-per-session-folder: working-directory UI compatibility',
      )

      note('apply ran')
      if (typeof ctx.inject !== 'function') {
        note('ctx.inject unavailable')
        console.warn('[psf] ctx.inject unavailable')
      } else {
        ctx.inject(['remote'], (scope) => {
          note('inject remote resolved')
          scope.effect(
            () => installLazyAddressShim(scope),
            'dsh-per-session-folder: file address compatibility',
          )
        })
        ctx.inject(['remote.workspaceFiles'], (scope) => {
          note('inject remote.workspaceFiles resolved')
          scope.effect(
            () => installLazyAddressShim(scope),
            'dsh-per-session-folder: file address compatibility (declared face)',
          )
        })
        ctx.inject(['sidebarRight'], (scope) => {
          note('inject sidebarRight resolved')
          scope.effect(
            () => installOpenResourceCompatibility(scope),
            'dsh-per-session-folder: open resource compatibility',
          )
        })
      }

      ctx.effect(
        () =>
          ctx.slots.inject('plugins.bundle.config', () =>
            ctx.slots.register(
              {
                name: 'plugins.bundle.config',
                key: BUNDLE_KEY,
                locale: NS,
                inject: () => ({
                  hooks: { sessionDirCard: store },
                  pickDirectory,
                  canVerifyDirectory,
                  listDirectory,
                  ...form.actions(),
                }),
              },
              SessionDirCard,
            ),
          ),
        'dsh-per-session-folder: bundle detail configuration',
      )
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale', 'configForms', 'uiWorkspace', 'sessions']
    return module.exports
  },
})
