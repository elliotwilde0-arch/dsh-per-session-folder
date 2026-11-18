import test from 'node:test'
import assert from 'node:assert/strict'

import {
  cleanMessageText,
  isDefaultFolderName,
  latestTitleInfo,
  renameDecision,
  safeFolderName,
} from '../index.js'

test('cleanMessageText strips @path references', () => {
  assert.equal(
    cleanMessageText('@C:\\Users\\Lilli\\Downloads\\收益凭证.xlsx 帮我处理一下这份Excel文档： 1、以产品名称'),
    '帮我处理一下这份Excel文档： 1、以产品名称',
  )
  assert.equal(cleanMessageText('@"C:\\My Docs\\a.xlsx" 汇总一下'), '汇总一下')
  assert.equal(cleanMessageText('@./data.csv 分析'), '分析')
  assert.equal(cleanMessageText('@C:\\a.xlsx'), '')
})

test('cleanMessageText strips URLs but keeps emails', () => {
  assert.equal(
    cleanMessageText('看看 https://github.com/openfilm/openfilm 这个项目'),
    '看看 这个项目',
  )
  assert.equal(cleanMessageText('详见 www.example.com 文档'), '详见 文档')
  assert.equal(cleanMessageText('联系 user@example.com 谢谢'), '联系 user@example.com 谢谢')
  assert.equal(cleanMessageText('https://example.com'), '')
})

test('cleanMessageText trims leftover edge punctuation', () => {
  assert.equal(cleanMessageText('帮我处理一下：'), '帮我处理一下')
  assert.equal(cleanMessageText('，。你好；'), '你好')
  assert.equal(cleanMessageText('   '), '')
})

test('safeFolderName sanitizes illegal characters and reserved names', () => {
  assert.equal(safeFolderName('a<b>c:d"e/f\\g|h?i*j'), 'a-b-c-d-e-f-g-h-i-j')
  assert.equal(safeFolderName('CON'), '_CON')
  assert.equal(safeFolderName('nul.txt'), '_nul.txt')
  assert.equal(safeFolderName('...'), '')
  assert.equal(safeFolderName('  a.  '), 'a')
  assert.equal(safeFolderName('多  个   空格'), '多 个 空格')
})

test('safeFolderName truncates by code points', () => {
  const long = '汉'.repeat(70)
  assert.equal(Array.from(safeFolderName(long, 60)).length, 60)
})

test('isDefaultFolderName recognizes only timestamp names', () => {
  assert.equal(isDefaultFolderName('会话-20261118-143257-bb227d29'), true)
  assert.equal(isDefaultFolderName('会话-20261118-143257'), true)
  assert.equal(isDefaultFolderName('收益凭证Excel处理'), false)
  assert.equal(isDefaultFolderName('@C--Users-Lilli'), false)
  assert.equal(isDefaultFolderName(undefined), false)
})

const base = {
  policy: 'once',
  followUserRename: true,
  kind: 'provider',
  isDefault: true,
  lastNameKind: '',
  renameCount: 0,
  maxRenames: 3,
}

test('once: first provider title renames, later ones are locked out', () => {
  assert.equal(renameDecision(base), 'rename')
  assert.equal(
    renameDecision({ ...base, isDefault: false, lastNameKind: 'provider', renameCount: 1 }),
    'skip',
  )
})

test('once: a clean-text fallback name can be upgraded by the first LLM title', () => {
  assert.equal(
    renameDecision({ ...base, isDefault: false, lastNameKind: 'text', renameCount: 1 }),
    'rename',
  )
  assert.equal(
    renameDecision({ ...base, kind: 'text', isDefault: false, lastNameKind: 'text' }),
    'skip',
  )
})

test('fallback titles and unknown sources never rename', () => {
  assert.equal(renameDecision({ ...base, kind: 'fallback' }), 'skip')
  assert.equal(renameDecision({ ...base, kind: '' }), 'skip')
})

test('user renames follow only when followUserRename is on, ignoring the lock', () => {
  const locked = { ...base, kind: 'user', isDefault: false, lastNameKind: 'provider' }
  assert.equal(renameDecision(locked), 'rename')
  assert.equal(renameDecision({ ...locked, followUserRename: false }), 'skip')
  assert.equal(renameDecision({ ...locked, policy: 'never' }), 'rename')
  assert.equal(renameDecision({ ...locked, policy: 'follow', renameCount: 99 }), 'rename')
})

test('follow: automatic renames are capped by maxRenames', () => {
  const follow = { ...base, policy: 'follow', isDefault: false, lastNameKind: 'provider' }
  assert.equal(renameDecision({ ...follow, renameCount: 2 }), 'rename')
  assert.equal(renameDecision({ ...follow, renameCount: 3 }), 'skip')
})

test('never: no automatic rename at all', () => {
  assert.equal(renameDecision({ ...base, policy: 'never' }), 'skip')
  assert.equal(renameDecision({ ...base, policy: 'never', kind: 'text' }), 'skip')
})

function sessionWith(events) {
  return { snapshotEvents: () => events }
}

test('latestTitleInfo picks the last non-empty title and classifies its source', () => {
  const events = [
    { type: 'session/title', data: { title: '原文前导词', source: { kind: 'fallback' } } },
    { type: 'session/title', data: { title: '收益凭证Excel处理', source: { kind: 'provider' } } },
    { type: 'user/message', data: {} },
  ]
  assert.deepEqual(latestTitleInfo(sessionWith(events)), {
    title: '收益凭证Excel处理',
    kind: 'provider',
  })
  events.push({ type: 'session/title', data: { title: '手动改名', source: { kind: 'user' } } })
  assert.deepEqual(latestTitleInfo(sessionWith(events)), { title: '手动改名', kind: 'user' })
})

test('latestTitleInfo skips empty titles and treats unknown sources as fallback', () => {
  const events = [
    { type: 'session/title', data: { title: '好标题', source: { kind: 'provider' } } },
    { type: 'session/title', data: { title: '   ', source: { kind: 'fallback' } } },
  ]
  assert.deepEqual(latestTitleInfo(sessionWith(events)), { title: '好标题', kind: 'provider' })
  assert.deepEqual(
    latestTitleInfo(sessionWith([{ type: 'session/title', data: { title: 'x' } }])),
    { title: 'x', kind: 'fallback' },
  )
  assert.deepEqual(latestTitleInfo(sessionWith([])), { title: '', kind: '' })
  assert.deepEqual(latestTitleInfo(undefined), { title: '', kind: '' })
})
