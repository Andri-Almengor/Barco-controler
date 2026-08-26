import type { CameraRule, RendererConfig } from './api'

export const labelOf = (value: any) => String(value?.name || value?.title || value?.label || value?.id || value?._id || 'Sin nombre')
export const idOf = (value: any) => String(value?.id || value?._id || '')
export const fmt = (ts?: number) => ts ? new Date(ts * 1000).toLocaleTimeString() : '—'

export const emptyCamera = (workplaceId = ''): CameraRule => ({
  name: 'Nueva cámara',
  enabled: true,
  workplaceId,
  displayKind: 'source',
  itemId: '',
  itemLabel: '',
  rtspUrl: '',
  username: '',
  password: '',
  priority: 1,
  durationSec: 15,
  cooldownSec: 20,
  scheduleStart: '00:00',
  scheduleEnd: '23:59',
  enabledHoursOnly: false,
  detectionMode: 'manual',
  minArea: 2500,
})

export const defaultRenderer = (): RendererConfig => ({
  id: 'main',
  name: 'Renderer principal',
  barco_source_id: '',
  barco_source_label: 'Renderer web local',
  browser_path: '',
  launch_mode: 'kiosk',
  startup_delay_sec: 1.5,
  profile_dir: 'data/browser-profile-main',
  extra_args: [],
})
