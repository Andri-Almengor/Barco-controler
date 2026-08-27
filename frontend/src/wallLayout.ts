import type { Geometry, LayoutItem, LayoutKind, Workplace } from './api'
import { idOf, labelOf } from './helpers'

function numberOr(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function labelFor(kind: LayoutKind, id: string, sources: any[], compositions: any[]) {
  const list = kind === 'composition' ? compositions : sources
  const found = list.find(item => idOf(item) === id)
  return found ? labelOf(found) : id
}

function geometryOf(value: any, workplace?: Workplace): Geometry {
  const wallWidth = workplace?.geometry?.width || 1920
  const wallHeight = workplace?.geometry?.height || 1080
  const geometry = value && typeof value === 'object' ? value : {}
  return {
    type: String(geometry.type || 'px'),
    x: numberOr(geometry.x, 0),
    y: numberOr(geometry.y, 0),
    width: Math.max(1, numberOr(geometry.width, wallWidth)),
    height: Math.max(1, numberOr(geometry.height, wallHeight)),
  }
}

function contentKind(value: any): LayoutKind {
  const raw = String(value?.type || value?.kind || '').toLowerCase()
  return raw.includes('composition') ? 'composition' : 'source'
}

function contentId(value: any) {
  if (!value || typeof value !== 'object') return ''
  for (const key of ['id', '_id', 'sourceId', 'compositionId', 'uuid']) {
    const candidate = value[key]
    if (candidate !== undefined && candidate !== null && String(candidate).trim()) return String(candidate)
  }
  return ''
}

export function liveWallItems(
  raw: any,
  workplace: Workplace | undefined,
  sources: any[],
  compositions: any[],
): LayoutItem[] {
  const result: LayoutItem[] = []
  const seen = new Set<any>()

  function visit(node: any) {
    if (!node || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)

    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }

    const geometry = node.geometry
    const content = node.content
    if (geometry && content && typeof content === 'object') {
      const id = contentId(content)
      if (id) {
        const kind = contentKind(content)
        result.push({
          kind,
          id,
          label: labelFor(kind, id, sources, compositions),
          geometry: geometryOf(geometry, workplace),
        })
        return
      }
    }

    for (const value of Object.values(node)) visit(value)
  }

  visit(raw)
  return result
}

export function bringToFront(items: LayoutItem[], index: number) {
  if (index < 0 || index >= items.length - 1) return items
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.push(item)
  return next
}

export function sendToBack(items: LayoutItem[], index: number) {
  if (index <= 0 || index >= items.length) return items
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.unshift(item)
  return next
}
