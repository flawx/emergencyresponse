export function makeDistortionCurve(amount: number): Float32Array {
  const n = 44100
  const curve = new Float32Array(n)
  const drive = Math.max(1, amount)
  for (let i = 0; i < n; i += 1) {
    const x = (i * 2) / n - 1
    curve[i] = Math.tanh((drive / 12) * x)
  }
  return curve
}

/** Saturation locale WAIL/YELP : tanh impaire, sans offset DC. */
export function makeSirenLocalTanhCurve(drive = 2.55): Float32Array {
  const n = 4096
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(drive * x)
  }
  return curve
}

export function makeWailBiasCurve(): Float32Array {
  const n = 1024
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = x < 0 ? x * 0.4 : x
  }
  return curve
}
