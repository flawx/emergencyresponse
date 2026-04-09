import { useEffect, useMemo, useState } from 'react'
import { audioEngine } from '../audio/engine'

export function AudioVisualizer() {
  const [bars, setBars] = useState<number[]>(() => new Array(16).fill(2))
  const data = useMemo(() => new Uint8Array(64), [])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const analyser = audioEngine.getAnalyser()
      if (!analyser) {
        raf = requestAnimationFrame(tick)
        return
      }
      analyser.getByteFrequencyData(data)
      const next = new Array(16).fill(0).map((_, i) => {
        const value = data[i * 2] ?? 0
        return Math.max(4, Math.round((value / 255) * 40))
      })
      setBars(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [data])

  return (
    <div className="rounded-xl border border-slate-800 bg-panel-900 p-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Audio Visualizer</div>
      <div className="flex h-12 items-end gap-1">
        {bars.map((h, idx) => (
          <span
            key={`${idx}-${h}`}
            className="w-1.5 rounded-sm bg-cyan-300/90 transition-[height] duration-75"
            style={{ height: `${h}px` }}
          />
        ))}
      </div>
    </div>
  )
}
