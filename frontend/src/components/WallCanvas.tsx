import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { Geometry, LayoutItem, LayoutKind } from '../api'

export type WallPalettePayload = {
  kind: LayoutKind
  id: string
  label: string
}

type ResizeEdge = 'nw' | 'ne' | 'sw' | 'se'

type WallCanvasProps = {
  items: LayoutItem[]
  wallWidth: number
  wallHeight: number
  selectedIndex?: number
  editable?: boolean
  className?: string
  emptyText?: string
  onItemsChange?: (items: LayoutItem[]) => void
  onSelect?: (index: number) => void
  onDropNew?: (payload: WallPalettePayload, geometry: Geometry) => void
}

const MIME = 'application/x-barco-layout-item'

export function beginPaletteDrag(event: React.DragEvent, payload: WallPalettePayload) {
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData(MIME, JSON.stringify(payload))
  event.dataTransfer.setData('text/plain', payload.label)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function safeGeometry(item: LayoutItem, wallWidth: number, wallHeight: number): Geometry {
  const source = item.geometry || ({ type: 'px', x: 0, y: 0, width: wallWidth, height: wallHeight } as Geometry)
  return {
    type: 'px',
    x: Number.isFinite(source.x) ? source.x : 0,
    y: Number.isFinite(source.y) ? source.y : 0,
    width: Math.max(1, Number.isFinite(source.width) ? source.width : wallWidth),
    height: Math.max(1, Number.isFinite(source.height) ? source.height : wallHeight),
  }
}

function iconFor(kind: LayoutKind) {
  if (kind === 'external') return 'language'
  if (kind === 'composition') return 'dashboard_customize'
  return 'monitor'
}

export function WallCanvas(props: WallCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const width = Math.max(1, props.wallWidth || 1920)
  const height = Math.max(1, props.wallHeight || 1080)
  const editable = props.editable !== false

  function updateItem(index: number, geometry: Geometry) {
    if (!props.onItemsChange) return
    const next = props.items.map((item, itemIndex) => itemIndex === index ? { ...item, geometry } : item)
    props.onItemsChange(next)
  }

  function pointerAction(event: ReactPointerEvent, index: number, mode: 'move' | ResizeEdge) {
    if (!editable || !props.onItemsChange || !containerRef.current) return
    event.preventDefault()
    event.stopPropagation()
    props.onSelect?.(index)

    const rect = containerRef.current.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const scaleX = width / rect.width
    const scaleY = height / rect.height
    const item = props.items[index]
    const start = safeGeometry(item, width, height)
    const startX = event.clientX
    const startY = event.clientY
    const minWidth = Math.max(40, width * 0.035)
    const minHeight = Math.max(30, height * 0.035)

    const onMove = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - startX) * scaleX
      const dy = (moveEvent.clientY - startY) * scaleY
      let x = start.x
      let y = start.y
      let itemWidth = start.width
      let itemHeight = start.height

      if (mode === 'move') {
        x = clamp(start.x + dx, 0, Math.max(0, width - start.width))
        y = clamp(start.y + dy, 0, Math.max(0, height - start.height))
      } else {
        const west = mode === 'nw' || mode === 'sw'
        const east = mode === 'ne' || mode === 'se'
        const north = mode === 'nw' || mode === 'ne'
        const south = mode === 'sw' || mode === 'se'

        if (east) itemWidth = clamp(start.width + dx, minWidth, width - start.x)
        if (south) itemHeight = clamp(start.height + dy, minHeight, height - start.y)
        if (west) {
          const nextX = clamp(start.x + dx, 0, start.x + start.width - minWidth)
          itemWidth = start.width + (start.x - nextX)
          x = nextX
        }
        if (north) {
          const nextY = clamp(start.y + dy, 0, start.y + start.height - minHeight)
          itemHeight = start.height + (start.y - nextY)
          y = nextY
        }
      }

      updateItem(index, {
        type: 'px',
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(itemWidth),
        height: Math.round(itemHeight),
      })
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }

  function handleDrop(event: React.DragEvent) {
    if (!editable || !props.onDropNew || !containerRef.current) return
    event.preventDefault()
    const raw = event.dataTransfer.getData(MIME)
    if (!raw) return

    try {
      const payload = JSON.parse(raw) as WallPalettePayload
      if (!payload?.id || !payload?.kind) return
      const rect = containerRef.current.getBoundingClientRect()
      const xAtPointer = ((event.clientX - rect.left) / rect.width) * width
      const yAtPointer = ((event.clientY - rect.top) / rect.height) * height
      const defaultWidth = Math.round(width * 0.36)
      const defaultHeight = Math.round(height * 0.40)
      const x = clamp(xAtPointer - defaultWidth / 2, 0, Math.max(0, width - defaultWidth))
      const y = clamp(yAtPointer - defaultHeight / 2, 0, Math.max(0, height - defaultHeight))
      props.onDropNew(payload, {
        type: 'px',
        x: Math.round(x),
        y: Math.round(y),
        width: defaultWidth,
        height: defaultHeight,
      })
    } catch {
      // Ignore unrelated browser drag payloads.
    }
  }

  return (
    <div
      ref={containerRef}
      className={`wall-canvas ${editable ? 'editable' : 'readonly'} ${props.className || ''}`}
      style={{ aspectRatio: `${width}/${height}` }}
      onDragOver={event => {
        if (!editable || !props.onDropNew) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={handleDrop}
      onPointerDown={event => {
        if (event.target === event.currentTarget) props.onSelect?.(-1)
      }}
    >
      <div className="wall-canvas-grid" />
      {!props.items.length && <div className="wall-canvas-empty">{props.emptyText || 'ARRASTRA CONTENIDO AQUÍ'}</div>}
      {props.items.map((item, index) => {
        const geom = safeGeometry(item, width, height)
        const selected = props.selectedIndex === index
        return (
          <div
            key={`${item.kind}-${item.id}-${index}`}
            className={`wall-canvas-item ${item.kind} ${selected ? 'selected' : ''}`}
            style={{
              left: `${(geom.x / width) * 100}%`,
              top: `${(geom.y / height) * 100}%`,
              width: `${(geom.width / width) * 100}%`,
              height: `${(geom.height / height) * 100}%`,
              zIndex: index + 1,
            }}
            onPointerDown={event => pointerAction(event, index, 'move')}
            onClick={event => {
              event.stopPropagation()
              props.onSelect?.(index)
            }}
          >
            <div className="wall-canvas-item-art">
              <span className="material-symbols-outlined">{iconFor(item.kind)}</span>
            </div>
            <div className="wall-canvas-item-label">
              <strong>{item.label || item.id}</strong>
              <small>{item.kind}</small>
            </div>
            {editable && selected && (
              <>
                <span className="wall-resize nw" onPointerDown={event => pointerAction(event, index, 'nw')} />
                <span className="wall-resize ne" onPointerDown={event => pointerAction(event, index, 'ne')} />
                <span className="wall-resize sw" onPointerDown={event => pointerAction(event, index, 'sw')} />
                <span className="wall-resize se" onPointerDown={event => pointerAction(event, index, 'se')} />
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
