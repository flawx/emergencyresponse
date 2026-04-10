import { useEffect, useRef } from 'react'
import { audioEngine } from '../audio/engine'

const BAR_COUNT = 16

export function AudioVisualizer() {
  const barsRef = useRef<(HTMLDivElement | null)[]>([])
  const dataRef = useRef(new Uint8Array(64))

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const analyser = audioEngine.getAnalyser()
      const data = dataRef.current
      if (!analyser) {
        raf = requestAnimationFrame(tick)
        return
      }
      analyser.getByteFrequencyData(data)
      for (let i = 0; i < BAR_COUNT; i += 1) {
        const el = barsRef.current[i]
        if (!el) continue
        const raw = data[i * 2] ?? 0
        const value = raw / 255
        const scale = 0.2 + value * 0.8
        el.style.transform = `scaleY(${scale})`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="rounded-xl border border-slate-800 bg-panel-900 p-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Audio Visualizer</div>
      <div className="flex h-12 items-end gap-1">
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <div
            key={i}
            ref={(el) => {
              barsRef.current[i] = el
            }}
            className="h-12 w-1.5 origin-bottom will-change-transform rounded-sm bg-cyan-300/90"
            style={{ transform: 'scaleY(0.2)' }}
          />
        ))}
      </div>
    </div>
  )
}
