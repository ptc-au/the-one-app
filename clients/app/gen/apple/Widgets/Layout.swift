import SwiftUI
import WidgetKit

// A widget's layout, drawn in SwiftUI as the UI library's `Widget` draws it (core/ui/src/styled-components/widget.tsx):
// the same parts, sizes and colours, from the same tokens (core/ui/src/tokens.ts), an iPhone's.

enum Look {
    struct Context {
        /// The widget's app, whose tools its controls call (`<app>_<tool>`).
        let app: String
        /// How wide the widget is, under which a column or row with `from` is dropped.
        let width: CGFloat
    }

    /// The tokens' colours, light and dark.
    static let label = colour(light: (0.106, 0.106, 0.122, 1), dark: (1, 1, 1, 1))
    static let secondary = colour(light: (0.106, 0.106, 0.122, 0.7), dark: (1, 1, 1, 0.6))
    static let quaternary = colour(light: (0.106, 0.106, 0.122, 0.2), dark: (1, 1, 1, 0.2))
    static let quinary = colour(light: (0.106, 0.106, 0.122, 0.1), dark: (1, 1, 1, 0.1))
    static let green = colour(light: (0, 0.605, 0.256, 1), dark: (0.188, 0.82, 0.345, 1))
    static let orange = colour(light: (0.776, 0.376, 0, 1), dark: (0.999, 0.623, 0.039, 1))
    static let red = colour(light: (0.772, 0.081, 0.135, 1), dark: (1, 0.446, 0.44, 1))
    /// The widget's tile: the text at 10% over the background, as the launcher draws one.
    static let card = colour(light: (0.883, 0.883, 0.893, 1), dark: (0.1, 0.1, 0.1, 1))

    static func colour(light: (CGFloat, CGFloat, CGFloat, CGFloat), dark: (CGFloat, CGFloat, CGFloat, CGFloat)) -> Color {
        Color(UIColor { traits in
            let (r, g, b, a) = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: r, green: g, blue: b, alpha: a)
        })
    }

    /// The system's font: WidgetKit draws a widget in a process of its own, which has only the system's fonts and the
    /// extension's bundled ones by name.
    static func font(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight)
    }

    static func tone(_ part: [String: Any]) -> Color? {
        switch part["tone"] as? String {
        case "muted": secondary
        case "warn": orange
        case "bad": red
        default: nil
        }
    }

    static func number(_ value: Any?) -> Double? {
        if let value = value as? NSNumber, !(value is Bool) { return value.doubleValue }
        if let value = value as? String { return Double(value) }
        return nil
    }

    static func share(_ value: Any?) -> Double { max(0, min(1, number(value) ?? 0)) }
}

/// One part of a layout. A part this doesn't know draws nothing.
struct Part: View {
    let part: [String: Any]
    let context: Look.Context
    var root = false
    /// Whether it's in a row, where words keep to one line, and grows across, not down.
    var row = false
    var first = false

    var body: some View {
        drawn
            .modifier(Room(part: part, row: row))
    }

    private var kind: String { part["part"] as? String ?? "" }
    private var parts: [[String: Any]] { part["parts"] as? [[String: Any]] ?? [] }
    private var width: CGFloat? { Look.number(part["width"]).map { CGFloat($0) } }

    @ViewBuilder private var drawn: some View {
        switch kind {
        case "column", "row":
            if fits { stack }
        case "text":
            words(part["text"] as? String ?? "")
        case "time":
            words(Self.time(Look.number(part["at"]) ?? 0, part["style"] as? String))
        case "stat":
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(Self.figure(part["value"])).font(Look.font(34, .semibold)).monospacedDigit().tracking(-1)
                    if let unit = part["unit"] as? String { Text(unit).font(Look.font(17, .medium)).foregroundStyle(Look.secondary) }
                }
                .lineLimit(1)
                if let label = part["label"] as? String { small(label) }
            }
            .fixedSize(horizontal: true, vertical: false)
        case "gauge":
            Gauge(part: part)
        case "progress":
            VStack(alignment: .leading, spacing: 4) {
                if let label = part["label"] as? String { small(label) }
                Bar(value: Look.share(part["value"])).frame(height: 8)
            }
        case "spark":
            Spark(part: part).frame(width: width, height: CGFloat(Look.number(part["height"]) ?? 28))
        case "chart":
            Chart(part: part)
        case "item":
            Item(part: part, context: context, first: first)
        case "image":
            Picture(part: part)
        case "icon":
            Icon(part: part)
        case "divider":
            Rectangle().fill(Look.quaternary).frame(height: 1).padding(.vertical, 4)
        case "button":
            Button(intent: CallTool(tool: "\(context.app)_\(part["tool"] as? String ?? "")", inputs: part["inputs"] as? [String: Any] ?? [:])) {
                Text(part["label"] as? String ?? "").font(Look.font(15, .medium)).lineLimit(1)
                    .frame(minHeight: 32).padding(.horizontal, 12).frame(maxWidth: width)
                    .background(Capsule().fill(Look.quinary))
            }
            .buttonStyle(.plain)
        case "switch":
            // It calls its tool with the new `on`, as a checklist row does: WidgetKit draws no system switch, and a
            // toggle styled as one doesn't call its intent.
            let on = part["on"] as? Bool ?? false
            let inputs = (part["inputs"] as? [String: Any] ?? [:]).merging(["on": !on]) { $1 }
            Button(intent: CallTool(tool: "\(context.app)_\(part["tool"] as? String ?? "")", inputs: inputs)) {
                HStack(spacing: 8) {
                    Text(part["label"] as? String ?? "").font(Look.font(15)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                    Flip(on: on)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        default:
            EmptyView()
        }
    }

    /// A column or row with `from` is dropped where the widget is narrower than 15 or 18 rem, whole.
    private var fits: Bool {
        switch part["from"] as? String {
        case "md": context.width >= 288
        case "sm": context.width >= 240
        default: true
        }
    }

    @ViewBuilder private var stack: some View {
        let gap = Look.number(part["gap"]).map { CGFloat($0) } ?? (kind == "row" ? 8 : 4)
        let centred = part["align"] as? String == "center"
        if kind == "row" {
            HStack(alignment: .center, spacing: gap) {
                ForEach(parts.indices, id: \.self) { index in
                    Part(part: parts[index], context: context, row: true, first: index == 0)
                }
            }
            .frame(maxWidth: centred ? .infinity : nil, alignment: centred ? .center : .leading)
        } else {
            VStack(alignment: centred ? .center : .leading, spacing: gap) {
                ForEach(parts.indices, id: \.self) { index in
                    Part(part: parts[index], context: context, row: false, first: index == 0)
                }
            }
            .frame(maxWidth: centred ? .infinity : nil, maxHeight: root ? .infinity : nil, alignment: root ? .topLeading : centred ? .center : .leading)
        }
    }

    private func words(_ text: String) -> some View {
        let (size, weight): (CGFloat, Font.Weight) = switch part["size"] as? String {
        case "xl": (34, .semibold)
        case "lg": (28, .semibold)
        case "sm", "xs": (13, .regular)
        default: (15, .regular)
        }
        let weighed: Font.Weight = switch part["weight"] as? String {
        case "medium": .medium
        case "bold": .semibold
        default: weight
        }
        let lines = row ? 1 : Look.number(part["lines"]).map { min(8, max(1, Int($0.rounded()))) }
        // Words in a warning's tone are the label's colour; its orange is its symbols', bars' and gauges'.
        return Text(text).font(Look.font(size, weighed)).lineLimit(lines)
            .modifier(Tone(colour: part["tone"] as? String == "warn" ? Look.label : nil))
    }

    private func small(_ text: String) -> some View {
        Text(text).font(Look.font(13)).foregroundStyle(Look.secondary).lineLimit(1)
    }

    static func figure(_ value: Any?) -> String {
        if let number = value as? NSNumber, !(number is Bool) {
            let format = NumberFormatter()
            format.numberStyle = .decimal
            format.maximumFractionDigits = 2
            return format.string(from: number) ?? "\(number)"
        }
        return (value as? String) ?? "–"
    }

    /// When something was, as the Home Screen says it: a while ago in minutes, hours or days, a clock or a date.
    static func time(_ at: Double, _ style: String?) -> String {
        let date = Date(timeIntervalSince1970: at / 1000)
        switch style {
        case "date": return date.formatted(.dateTime.day().month(.abbreviated))
        case "clock": return date.formatted(date: .omitted, time: .shortened)
        default:
            let ago = Date().timeIntervalSince(date)
            let formatter = RelativeDateTimeFormatter()
            formatter.dateTimeStyle = .named
            formatter.unitsStyle = .short
            var components = DateComponents()
            if abs(ago) < 3600 { components.minute = -Int((ago / 60).rounded()) }
            else if abs(ago) < 86400 { components.hour = -Int((ago / 3600).rounded()) }
            else { components.day = -Int((ago / 86400).rounded()) }
            return formatter.localizedString(from: components)
        }
    }
}

/// What every part may say of itself: that it takes the room that's left, its own width, that it's faded, and its tone.
struct Room: ViewModifier {
    let part: [String: Any]
    let row: Bool

    func body(content: Content) -> some View {
        let width = Look.number(part["width"]).map { CGFloat($0) }
        let grows = part["grow"] as? Bool == true
        content
            .frame(width: width)
            .frame(maxWidth: grows && row ? .infinity : nil, maxHeight: grows && !row ? .infinity : nil, alignment: .leading)
            .layoutPriority(width != nil || (part["part"] as? String) == "stat" ? 1 : 0)
            .opacity(part["dim"] as? Bool == true ? 0.5 : 1)
            .modifier(Tone(colour: Look.tone(part)))
    }
}

/// A part's tone, which what's in it takes, as a colour's inherited.
struct Tone: ViewModifier {
    let colour: Color?

    func body(content: Content) -> some View {
        if let colour { content.foregroundStyle(colour) } else { content }
    }
}

/// A switch, as the UI library's: a pill, green with its thumb at the end when on, as iOS's is.
struct Flip: View {
    let on: Bool

    var body: some View {
        Capsule().fill(on ? Look.green : Look.quaternary)
            .frame(width: 32, height: 20)
            .overlay(alignment: on ? .trailing : .leading) {
                Circle().fill(.white).frame(width: 16, height: 16).padding(2).shadow(color: .black.opacity(0.15), radius: 1, y: 0.5)
            }
    }
}

/// A ring filled to a share, no thicker than a sixth of itself, from the top, clockwise, with round ends.
struct Gauge: View {
    let part: [String: Any]

    var body: some View {
        let size = CGFloat(Look.number(part["width"]) ?? 46)
        let thick = min(5, size / 6)
        ZStack {
            Circle().stroke(Look.quaternary, lineWidth: thick).padding(thick / 2)
            Circle().trim(from: 0, to: Look.share(part["value"])).rotation(.degrees(-90))
                .stroke(Look.tone(part) ?? Look.label, style: StrokeStyle(lineWidth: thick, lineCap: .round)).padding(thick / 2)
            if let label = part["label"] as? String, size >= 36 {
                Text(label).font(Look.font(13, .semibold)).foregroundStyle(Look.label).lineLimit(1).minimumScaleFactor(0.5)
            }
        }
        .frame(width: size, height: size)
    }
}

/// A bar filled to a share: a pill, and over it what's filled.
struct Bar: View {
    let value: Double

    var body: some View {
        GeometryReader { box in
            ZStack(alignment: .leading) {
                Capsule().fill(Look.quaternary)
                if value > 0 { Capsule().frame(width: max(box.size.height, box.size.width * value)) }
            }
        }
    }
}

/// Points along a box, one for each value up to `max`, from the left edge to the right.
private func along(_ values: [Double], _ max: Double, _ size: CGSize) -> [CGPoint] {
    values.enumerated().map { index, value in
        CGPoint(x: values.count > 1 ? Double(index) / Double(values.count - 1) * size.width : size.width / 2,
                y: size.height - 1 - (min(value, max) / max) * (size.height - 2))
    }
}

private func values(_ part: [String: Any]) -> ([Double], Double) {
    let values = (part["values"] as? [Any] ?? []).map { Look.number($0) ?? 0 }
    return (values, Look.number(part["max"]) ?? Swift.max(values.max() ?? 1, 1))
}

/// A small line of values, over the area under it at 15%; with none, a dashed line.
struct Spark: View {
    let part: [String: Any]

    var body: some View {
        Canvas { canvas, size in
            let (values, max) = values(part)
            let colour = GraphicsContext.Shading.foreground
            guard values.count > 1 else {
                var dashes = Path()
                for x in stride(from: 0, to: size.width, by: 5) { dashes.addRect(CGRect(x: x, y: size.height / 2 - 0.75, width: 2, height: 1.5)) }
                return canvas.fill(dashes, with: colour)
            }
            let points = along(values, max, size)
            var line = Path()
            line.addLines(points)
            var area = line
            area.addLine(to: CGPoint(x: size.width, y: size.height))
            area.addLine(to: CGPoint(x: 0, y: size.height))
            area.closeSubpath()
            canvas.opacity = 0.15
            canvas.fill(area, with: colour)
            canvas.opacity = 1
            canvas.stroke(line, with: colour, style: StrokeStyle(lineWidth: 1.5, lineJoin: .miter))
        }
    }
}

/// Bars of values over their labels, or with `kind: "line"` a line.
struct Chart: View {
    let part: [String: Any]

    var body: some View {
        VStack(spacing: 4) {
            Canvas { canvas, size in
                let (values, max) = values(part)
                if part["kind"] as? String == "line" {
                    var line = Path()
                    line.addLines(along(values, max, size))
                    return canvas.stroke(line, with: .foreground, lineWidth: 1.5)
                }
                let slot = size.width / CGFloat(Swift.max(values.count, 1))
                for (index, value) in values.enumerated() {
                    let tall = min(value, max) / max * size.height
                    guard tall > 0 else { continue }
                    let bar = CGRect(x: CGFloat(index) * slot + slot * 0.2, y: size.height - tall, width: slot * 0.6, height: tall)
                    canvas.fill(Path(roundedRect: bar, cornerRadius: min(3, bar.width / 2, tall / 2)), with: .foreground)
                }
            }
            if let labels = part["labels"] as? [Any] {
                HStack(spacing: 0) {
                    ForEach(labels.indices, id: \.self) { index in
                        Text(String(describing: labels[index])).font(Look.font(13)).foregroundStyle(Look.secondary).lineLimit(1).frame(maxWidth: .infinity)
                    }
                }
            }
        }
        .frame(height: CGFloat(Look.number(part["height"]) ?? 70))
    }
}

/// A row of a list, a hairline above it but the first. One that says `on` has a circle at its start, checked or not, and
/// with a `tool` it's pressed to switch.
struct Item: View {
    let part: [String: Any]
    let context: Look.Context
    let first: Bool

    var body: some View {
        if let tool = part["tool"] as? String {
            let inputs = (part["inputs"] as? [String: Any] ?? [:]).merging(["on": !(part["on"] as? Bool ?? false)]) { $1 }
            Button(intent: CallTool(tool: "\(context.app)_\(tool)", inputs: inputs)) { row }.buttonStyle(.plain)
        } else {
            row
        }
    }

    private var row: some View {
        HStack(spacing: 8) {
            if let on = part["on"] as? Bool { Check(on: on) }
            VStack(alignment: .leading, spacing: 0) {
                Text(part["title"] as? String ?? "").font(Look.font(15)).lineLimit(1)
                if let subtitle = part["subtitle"] as? String {
                    Text(subtitle).font(Look.font(13)).foregroundStyle(Look.secondary).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let at = Look.number(part["at"]) {
                Text(Part.time(at, nil)).font(Look.font(15)).foregroundStyle(Look.secondary).lineLimit(1)
            } else if let trailing = part["trailing"] as? String {
                Text(trailing).font(Look.font(15)).foregroundStyle(Look.secondary).lineLimit(1)
            }
        }
        .padding(.vertical, 4)
        .overlay(alignment: .top) { if !first { Rectangle().fill(Look.quinary).frame(height: 1) } }
        .contentShape(Rectangle())
    }
}

/// A circle that's checked or not, as iOS's Reminders draws a row's: a ring, or a disc with a tick cut out of it.
struct Check: View {
    let on: Bool

    var body: some View {
        ZStack {
            if on {
                Circle().fill(Look.label)
                Path { tick in
                    tick.move(to: CGPoint(x: 5.5, y: 10.5))
                    tick.addLine(to: CGPoint(x: 8.6, y: 13.6))
                    tick.addLine(to: CGPoint(x: 14.5, y: 7))
                }
                .stroke(style: StrokeStyle(lineWidth: 1.75))
                .blendMode(.destinationOut)
            } else {
                Circle().strokeBorder(Look.quaternary, lineWidth: 1.25)
            }
        }
        .compositingGroup()
        .frame(width: 20, height: 20)
    }
}

/// A picture, by a `data:` address; anything else is a grey box, as the Home Screen draws one.
struct Picture: View {
    let part: [String: Any]

    var body: some View {
        let width = Look.number(part["width"]).map { CGFloat($0) }
        let height = Look.number(part["height"]).map { CGFloat($0) }
        let shape = RoundedRectangle(cornerRadius: part["round"] as? Bool == true ? 9999 : 6)
        Group {
            if let url = part["url"] as? String, url.hasPrefix("data:image/"), let comma = url.firstIndex(of: ","),
               let data = Data(base64Encoded: String(url[url.index(after: comma)...])), let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Look.quinary
            }
        }
        .frame(width: width, height: height)
        .frame(maxWidth: width == nil ? .infinity : nil)
        .clipShape(shape)
    }
}

/// An SVG path in a box of 24, with a `badge`, another path, at its corner, or the whole icon where it has no path.
struct Icon: View {
    let part: [String: Any]

    var body: some View {
        let size = CGFloat(Look.number(part["width"]) ?? 16)
        ZStack(alignment: .topLeading) {
            if let path = part["path"] as? String { SVGPath(data: path).fill(style: FillStyle(eoFill: false)) }
            if let badge = part["badge"] as? String {
                let corner = part["path"] == nil ? 0 : size * 13 / 24
                SVGPath(data: badge).fill().frame(width: size - corner, height: size - corner).offset(x: corner, y: corner)
            }
        }
        .frame(width: size, height: size)
    }
}

/// An SVG path's data, as a shape in its box of 24.
struct SVGPath: Shape {
    let data: String

    func path(in rect: CGRect) -> Path {
        SVGPath.parse(data).applying(CGAffineTransform(scaleX: rect.width / 24, y: rect.height / 24).translatedBy(x: rect.minX, y: rect.minY))
    }

    /// The SVG path grammar (SVG 2, 9.3): every command, absolute and relative, arcs drawn as Béziers.
    static func parse(_ data: String) -> Path {
        var path = Path()
        let chars = Array(data.utf8)
        var at = 0
        var command: UInt8 = 0
        var current = CGPoint.zero, start = CGPoint.zero, control = CGPoint.zero
        var last: UInt8 = 0

        func skip() { while at < chars.count, chars[at] == 32 || chars[at] == 44 || chars[at] == 10 || chars[at] == 9 || chars[at] == 13 { at += 1 } }
        func number() -> CGFloat? {
            skip()
            let begin = at
            if at < chars.count, chars[at] == 43 || chars[at] == 45 { at += 1 }
            var dot = false, digits = false
            while at < chars.count {
                let c = chars[at]
                if c >= 48 && c <= 57 { digits = true; at += 1 }
                else if c == 46 && !dot { dot = true; at += 1 }
                else if (c == 101 || c == 69) && digits {
                    at += 1
                    if at < chars.count, chars[at] == 43 || chars[at] == 45 { at += 1 }
                } else { break }
            }
            guard digits, let value = Double(String(decoding: chars[begin..<at], as: UTF8.self)) else { at = begin; return nil }
            return CGFloat(value)
        }
        func flag() -> Bool? {
            skip()
            guard at < chars.count, chars[at] == 48 || chars[at] == 49 else { return nil }
            at += 1
            return chars[at - 1] == 49
        }

        while true {
            skip()
            guard at < chars.count else { break }
            let c = chars[at]
            if (c >= 65 && c <= 90) || (c >= 97 && c <= 122) { command = c; at += 1 }
            else if command == 0 { break }
            let relative = command >= 97
            let base = relative ? current : .zero
            func point() -> CGPoint? {
                guard let x = number(), let y = number() else { return nil }
                return CGPoint(x: base.x + x, y: base.y + y)
            }
            switch command | 0x20 {
            case 109: // m
                guard let p = point() else { return path }
                path.move(to: p); current = p; start = p
                command = relative ? 108 : 76 // what follows a move is a line
            case 108: // l
                guard let p = point() else { return path }
                path.addLine(to: p); current = p
            case 104: // h
                guard let x = number() else { return path }
                current = CGPoint(x: relative ? current.x + x : x, y: current.y); path.addLine(to: current)
            case 118: // v
                guard let y = number() else { return path }
                current = CGPoint(x: current.x, y: relative ? current.y + y : y); path.addLine(to: current)
            case 99: // c
                guard let c1 = point(), let c2 = point(), let p = point() else { return path }
                path.addCurve(to: p, control1: c1, control2: c2); control = c2; current = p
            case 115: // s
                guard let c2 = point(), let p = point() else { return path }
                let c1 = (last | 0x20 == 99 || last | 0x20 == 115) ? CGPoint(x: 2 * current.x - control.x, y: 2 * current.y - control.y) : current
                path.addCurve(to: p, control1: c1, control2: c2); control = c2; current = p
            case 113: // q
                guard let c1 = point(), let p = point() else { return path }
                path.addQuadCurve(to: p, control: c1); control = c1; current = p
            case 116: // t
                guard let p = point() else { return path }
                let c1 = (last | 0x20 == 113 || last | 0x20 == 116) ? CGPoint(x: 2 * current.x - control.x, y: 2 * current.y - control.y) : current
                path.addQuadCurve(to: p, control: c1); control = c1; current = p
            case 97: // a
                guard let rx = number(), let ry = number(), let rotation = number(), let large = flag(), let sweep = flag(), let p = point() else { return path }
                arc(&path, from: current, to: p, rx: rx, ry: ry, rotation: rotation, large: large, sweep: sweep); current = p
            case 122: // z
                path.closeSubpath(); current = start
            default:
                return path
            }
            last = command
        }
        return path
    }

    /// An elliptical arc, as SVG 2's implementation notes (B.2.4) put it from its end points to its centre, in Béziers
    /// of at most a quarter turn.
    private static func arc(_ path: inout Path, from: CGPoint, to: CGPoint, rx: CGFloat, ry: CGFloat, rotation: CGFloat, large: Bool, sweep: Bool) {
        var rx = abs(rx), ry = abs(ry)
        guard rx > 0, ry > 0, from != to else { return path.addLine(to: to) }
        let phi = rotation * .pi / 180, cosPhi = cos(phi), sinPhi = sin(phi)
        let dx = (from.x - to.x) / 2, dy = (from.y - to.y) / 2
        let x1 = cosPhi * dx + sinPhi * dy, y1 = -sinPhi * dx + cosPhi * dy
        let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
        if lambda > 1 { rx *= sqrt(lambda); ry *= sqrt(lambda) }
        let numerator = max(0, rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1)
        var scale = sqrt(numerator / (rx * rx * y1 * y1 + ry * ry * x1 * x1))
        if large == sweep { scale = -scale }
        let cx1 = scale * rx * y1 / ry, cy1 = -scale * ry * x1 / rx
        let cx = cosPhi * cx1 - sinPhi * cy1 + (from.x + to.x) / 2, cy = sinPhi * cx1 + cosPhi * cy1 + (from.y + to.y) / 2
        func angle(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
            let sign: CGFloat = ux * vy - uy * vx < 0 ? -1 : 1
            let dot = max(-1, min(1, (ux * vx + uy * vy) / (sqrt(ux * ux + uy * uy) * sqrt(vx * vx + vy * vy))))
            return sign * acos(dot)
        }
        let theta = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
        var delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
        if !sweep && delta > 0 { delta -= 2 * .pi } else if sweep && delta < 0 { delta += 2 * .pi }
        let segments = Int(ceil(abs(delta) / (.pi / 2)))
        let step = delta / CGFloat(segments)
        let k = 4 / 3 * tan(step / 4)
        func on(_ t: CGFloat) -> (CGPoint, CGPoint) {
            let (c, s) = (cos(t), sin(t))
            let point = CGPoint(x: cx + rx * c * cosPhi - ry * s * sinPhi, y: cy + rx * c * sinPhi + ry * s * cosPhi)
            let tangent = CGPoint(x: -rx * s * cosPhi - ry * c * sinPhi, y: -rx * s * sinPhi + ry * c * cosPhi)
            return (point, tangent)
        }
        var t = theta
        for index in 0..<segments {
            let (p0, d0) = on(t)
            let (p1, d1) = on(t + step)
            path.addCurve(to: index == segments - 1 ? to : p1, control1: CGPoint(x: p0.x + k * d0.x, y: p0.y + k * d0.y), control2: CGPoint(x: p1.x - k * d1.x, y: p1.y - k * d1.y))
            t += step
        }
    }
}
