function hashString(input: string) {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0
  }
  return hash
}

export function avatarSvg(seed: string, cell = 5) {
  const h = hashString(seed)
  const hue = h % 360
  const bg = `hsl(${hue} 35% 22%)`
  const fg = `hsl(${hue} 65% 62%)`

  const cells: string[] = []
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      const mirror = cell - 1 - x
      const bit = (h >> ((y * cell + Math.min(x, mirror)) % 32)) & 1
      if (bit === 0) continue
      cells.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${fg}"/>`)
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cell} ${cell}" shape-rendering="crispEdges"><rect width="${cell}" height="${cell}" fill="${bg}"/>${cells.join('')}</svg>`
}

export function avatarUrl(seed: string) {
  const svg = avatarSvg(seed)
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
