import { useEffect, useRef } from 'react'
import { audioEngine } from '../audio/engine'

/** Lissage visuel du domaine temporel (smoothingTimeConstant n’affecte pas getFloatTimeDomainData). */
const WAVE_SMOOTH = 0.32

export function AudioVisualizer() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const timeDataRef = useRef<Float32Array | null>(null)
  const smoothedRef = useRef<Float32Array | null>(null)
  const freqDataRef = useRef<Uint8Array | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const smoothingAppliedRef = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const rect = container.getBoundingClientRect()
      const w = Math.max(1, Math.floor(rect.width))
      const h = Math.max(1, Math.floor(rect.height))
      sizeRef.current = { w, h }
      const dpr = window.devicePixelRatio ?? 1
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const ro = new ResizeObserver(() => resize())
    ro.observe(container)
    resize()

    let raf = 0

    const tick = () => {
      const analyser = audioEngine.getAnalyser()
      const { w, h } = sizeRef.current

      if (!analyser || w < 1 || h < 1) {
        raf = requestAnimationFrame(tick)
        return
      }

      if (!smoothingAppliedRef.current) {
        analyser.smoothingTimeConstant = 0.8
        smoothingAppliedRef.current = true
      }

      const fft = analyser.fftSize
      if (!timeDataRef.current || timeDataRef.current.length !== fft) {
        timeDataRef.current = new Float32Array(fft)
        smoothedRef.current = new Float32Array(fft)
        smoothedRef.current.fill(0)
        freqDataRef.current = new Uint8Array(analyser.frequencyBinCount)
      }

      const timeBuf = timeDataRef.current
      const smoothBuf = smoothedRef.current!
      const freqBuf = freqDataRef.current!

      analyser.getFloatTimeDomainData(timeBuf)
      for (let i = 0; i < fft; i += 1) {
        smoothBuf[i] += (timeBuf[i] - smoothBuf[i]) * WAVE_SMOOTH
      }

      analyser.getByteFrequencyData(freqBuf)

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'
      ctx.fillRect(0, 0, w, h)

      const bins = freqBuf.length
      const barW = w / bins
      for (let i = 0; i < bins; i += 1) {
        const v = freqBuf[i] / 255
        const barH = v * h * 0.42
        ctx.fillStyle = `rgba(34, 197, 94, ${0.05 + v * 0.12})`
        ctx.fillRect(i * barW, h - barH, Math.max(1, barW - 0.5), barH)
      }

      ctx.beginPath()
      const n = smoothBuf.length
      for (let i = 0; i < n; i += 1) {
        const x = (i / Math.max(1, n - 1)) * w
        const y = (smoothBuf[i] * 0.5 + 0.5) * h
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = '#22c55e'
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.shadowColor = '#22c55e'
      ctx.shadowBlur = 8
      ctx.stroke()
      ctx.shadowBlur = 0

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      smoothingAppliedRef.current = false
    }
  }, [])

  return (
    <div className="rounded-xl border border-slate-800 bg-panel-900 p-3">
      <div className="flex flex-col gap-2">
        <div className="text-xs uppercase tracking-wider text-slate-500">Audio scope</div>
        <div ref={containerRef} className="w-full">
          <canvas ref={canvasRef} className="block h-24 w-full rounded-md bg-slate-950/80" />
        </div>
      </div>
    </div>
  )
}
