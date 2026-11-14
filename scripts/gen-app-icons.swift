// 生成主屏幕图标：树仁绿满底 + 居中的白色盾徽（public/assets/brand/shield-white.png）。
// 盾徽高度只占 54%，落在 Android 自适应图标的安全区内，所以同一张图也可作 maskable 图标。
// 仅 macOS：swift scripts/gen-app-icons.swift
import AppKit

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let mark = NSImage(contentsOf: root.appendingPathComponent("public/assets/brand/shield-white.png"))!
let teal = NSColor(srgbRed: 0, green: 92 / 255, blue: 101 / 255, alpha: 1)

for (name, side) in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)] {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side, bitsPerSample: 8, samplesPerPixel: 4,
                             hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  NSGraphicsContext.current?.imageInterpolation = .high
  teal.setFill()
  NSRect(x: 0, y: 0, width: side, height: side).fill()
  let h = Double(side) * 0.54
  let w = h * Double(mark.size.width / mark.size.height)
  mark.draw(in: NSRect(x: (Double(side) - w) / 2, y: (Double(side) - h) / 2, width: w, height: h))
  NSGraphicsContext.restoreGraphicsState()
  let out = root.appendingPathComponent("public/\(name)")
  try! rep.representation(using: .png, properties: [:])!.write(to: out)
  print("\(name)  \(side)px")
}

// 浏览器标签图标：圆角树仁绿底，盾徽占 82% 高度，在 16–32px 的标签栏里也能认出来
for (name, side) in [("favicon-32.png", 32), ("favicon-64.png", 64)] {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side, bitsPerSample: 8, samplesPerPixel: 4,
                             hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  NSGraphicsContext.current?.imageInterpolation = .high
  let s = Double(side)
  teal.setFill()
  NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: s, height: s), xRadius: s * 0.19, yRadius: s * 0.19).fill()
  let h = s * 0.82
  let w = h * Double(mark.size.width / mark.size.height)
  mark.draw(in: NSRect(x: (s - w) / 2, y: (s - h) / 2, width: w, height: h))
  NSGraphicsContext.restoreGraphicsState()
  let out = root.appendingPathComponent("public/\(name)")
  try! rep.representation(using: .png, properties: [:])!.write(to: out)
  print("\(name)  \(side)px")
}
