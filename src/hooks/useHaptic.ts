export const useHaptic = () => {
  const vibrate = (pattern: number | number[] = 18) => {
    if ('vibrate' in navigator) {
      navigator.vibrate(pattern)
    }
  }

  return { vibrate }
}
