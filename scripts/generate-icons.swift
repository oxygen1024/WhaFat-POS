import AppKit
let base = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
for size in [192, 512] {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSColor(srgbRed: 20/255, green: 63/255, blue: 59/255, alpha: 1).setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: size, height: size)).fill()
    let s = CGFloat(size)
    NSColor(srgbRed: 240/255, green: 200/255, blue: 123/255, alpha: 1).setStroke()
    let p = NSBezierPath()
    p.lineWidth = s * 0.055
    p.lineCapStyle = .round
    p.lineJoinStyle = .round
    p.move(to: NSPoint(x:s*0.26,y:s*0.66))
    p.line(to: NSPoint(x:s*0.37,y:s*0.34))
    p.line(to: NSPoint(x:s*0.50,y:s*0.56))
    p.line(to: NSPoint(x:s*0.63,y:s*0.34))
    p.line(to: NSPoint(x:s*0.74,y:s*0.66))
    p.stroke()
    NSGraphicsContext.restoreGraphicsState()
    try rep.representation(using: .png, properties: [:])!.write(to:base.appendingPathComponent("icon-\(size).png"))
}
