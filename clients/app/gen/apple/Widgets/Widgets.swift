import AppIntents
import SwiftUI
import WidgetKit

// The widgets apps show on a Home Screen page, on the iPhone's own: the person picks any widget they could put on a page
// in the app, and it's drawn from what its tool answers, as the app draws it (Layout.swift). Its buttons and switches
// call their tools, and pressing it anywhere else opens the app at the widget's app.

/// A widget there is to pick: one of the Home Screen's (`home-screen_pages`' `widgets`), by its `<app>/<tool>`.
struct Listed: Codable {
    let widget: String
    let name: String
    let sizes: [String]
    let opens: Opens?

    struct Opens: Codable {
        let entrypoint: String
        let name: String
    }

    /// The widgets as they were last listed, kept in the App Group, so a widget finds its own without asking.
    static var kept: [Listed] {
        guard let file = Network.folder?.appendingPathComponent("widgets.json"), let data = try? Data(contentsOf: file) else { return [] }
        return (try? JSONDecoder().decode([Listed].self, from: data)) ?? []
    }

    /// The widgets there are now, which are kept.
    static func list() async -> Result<[Listed], Problem> {
        switch await Network.call("home-screen_pages", [:]) {
        case .result(let pages):
            let widgets = (pages as? [String: Any])?["widgets"] ?? []
            guard let data = try? JSONSerialization.data(withJSONObject: widgets),
                  let listed = try? JSONDecoder().decode([Listed].self, from: data) else { return .failure(.failed("Its widgets couldn't be read.")) }
            if let file = Network.folder?.appendingPathComponent("widgets.json") { try? data.write(to: file, options: .atomic) }
            return .success(listed)
        case .signedOut:
            return .failure(.signedOut)
        case .failed(let why):
            return .failure(.failed(why))
        }
    }

    /// The size to draw it at for `family`: the family's own, or the nearest it comes in.
    func size(for family: WidgetFamily) -> String {
        let wanted = family == .systemSmall ? "2x2" : family == .systemMedium ? "4x2" : "4x4"
        if sizes.contains(wanted) { return wanted }
        let order = ["2x2", "4x2", "4x4"]
        let index = order.firstIndex(of: wanted) ?? 0
        return order[..<index].reversed().first(where: sizes.contains) ?? sizes.first ?? wanted
    }
}

/// Why a widget shows nothing of its own, which it says, with what to do.
enum Problem: Error, CustomLocalizedStringResourceConvertible {
    case signedOut
    case gone
    case none
    case failed(String)

    var text: String {
        switch self {
        case .signedOut: "Open \(Network.app) and sign in to see this widget."
        case .gone: "This widget is gone. Touch and hold to choose another."
        case .none: "Your apps have no widgets yet."
        case .failed(let why): "This widget stopped working. \(why)"
        }
    }

    var localizedStringResource: LocalizedStringResource { "\(text)" }
}

struct WidgetChoice: AppEntity {
    let id: String
    let name: String
    let app: String?

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Widget"
    static let defaultQuery = WidgetChoices()
    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: app.map { "\($0)" })
    }

    init(id: String, name: String, app: String?) {
        self.id = id
        self.name = name
        self.app = app
    }

    init(_ listed: Listed) {
        id = listed.widget
        name = listed.name
        app = listed.opens?.name == listed.name ? nil : listed.opens?.name
    }
}

struct WidgetChoices: EntityQuery {
    // A chosen widget is found by its id among those last listed, without asking; one that's gone keeps its id, so its
    // widget says it's gone.
    func entities(for identifiers: [String]) async throws -> [WidgetChoice] {
        let kept = Listed.kept
        return identifiers.map { id in kept.first { $0.widget == id }.map(WidgetChoice.init) ?? WidgetChoice(id: id, name: id, app: nil) }
    }

    func suggestedEntities() async throws -> [WidgetChoice] {
        try await Listed.list().get().map(WidgetChoice.init)
    }
}

struct ChooseWidget: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Choose a Widget"
    static let description = IntentDescription("Shows a widget from your apps.")
    @Parameter(title: "Widget") var widget: WidgetChoice?
}

/// What a widget's button, switch or checklist row calls: its app's tool, with its inputs (JSON), and the widget is
/// drawn again after.
struct CallTool: AppIntent {
    static let title: LocalizedStringResource = "Press a Widget's Button"
    static let isDiscoverable = false
    @Parameter(title: "Tool") var tool: String
    @Parameter(title: "Inputs") var inputs: String

    init() {}
    init(tool: String, inputs: [String: Any]) {
        self.tool = tool
        self.inputs = String(data: (try? JSONSerialization.data(withJSONObject: inputs)) ?? Data("{}".utf8), encoding: .utf8) ?? "{}"
    }

    func perform() async throws -> some IntentResult {
        try await Called.call(tool, inputs)
        return .result()
    }
}

/// A control's call, and what went wrong with the last one, which its widget says until it's drawn again.
enum Called {
    static func call(_ tool: String, _ inputs: String) async throws {
        let arguments = (try? JSONSerialization.jsonObject(with: Data(inputs.utf8))) as? [String: Any] ?? [:]
        let defaults = UserDefaults(suiteName: Network.group)
        switch await Network.call(tool, arguments) {
        case .result: defaults?.removeObject(forKey: "failed")
        case .signedOut: defaults?.set(Problem.signedOut.text, forKey: "failed")
        case .failed(let why): defaults?.set("\(why) Tap to try again.", forKey: "failed")
        }
    }

    /// What the last call said went wrong, once.
    static func failed() -> String? {
        let defaults = UserDefaults(suiteName: Network.group)
        defer { defaults?.removeObject(forKey: "failed") }
        return defaults?.string(forKey: "failed")
    }
}

struct Entry: TimelineEntry {
    var date = Date()
    var listed: Listed?
    var layout: [String: Any]?
    var problem: Problem?
    var width: CGFloat = 170
}

struct Provider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(width: context.displaySize.width) }

    func snapshot(for configuration: ChooseWidget, in context: Context) async -> Entry {
        await draw(configuration, context)
    }

    /// Drawn again when its layout says (`refresh`), and otherwise as often as WidgetKit gives it, every 15 minutes
    /// at most.
    func timeline(for configuration: ChooseWidget, in context: Context) async -> Timeline<Entry> {
        let entry = await draw(configuration, context)
        let seconds = (entry.layout?["refresh"] as? Double).map { max($0, 60) } ?? 15 * 60
        return Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(seconds)))
    }

    /// The widget chosen, or with none yet the first there is, drawn for its family.
    private func draw(_ configuration: ChooseWidget, _ context: Context) async -> Entry {
        let width = context.displaySize.width
        var listed = Listed.kept
        let chosen = configuration.widget?.id
        if listed.isEmpty || chosen.map({ id in !listed.contains { $0.widget == id } }) ?? false {
            switch await Listed.list() {
            case .success(let now): listed = now
            case .failure(let problem): return Entry(problem: problem, width: width)
            }
        }
        guard let widget = chosen.map({ id in listed.first { $0.widget == id } }) ?? listed.first else {
            return Entry(problem: chosen == nil ? .none : .gone, width: width)
        }
        if let failed = Called.failed() { return Entry(listed: widget, problem: .failed(failed), width: width) }
        switch await Network.call(widget.widget.replacingOccurrences(of: "/", with: "_"), ["size": widget.size(for: context.family)]) {
        case .result(let layout):
            return Entry(listed: widget, layout: layout as? [String: Any], width: width)
        case .signedOut:
            return Entry(listed: widget, problem: .signedOut, width: width)
        case .failed(let why):
            // A widget whose app is gone fails as its tool does: it's gone if it's no longer listed.
            if case .success(let now) = await Listed.list(), !now.contains(where: { $0.widget == widget.widget }) {
                return Entry(problem: .gone, width: width)
            }
            return Entry(listed: widget, problem: .failed(why), width: width)
        }
    }
}

struct EntryView: View {
    let entry: Entry

    var body: some View {
        let app = entry.listed.map { String($0.widget.prefix { $0 != "/" }) } ?? ""
        VStack(alignment: .leading, spacing: 8) {
            if entry.problem != nil || entry.layout?["title"] as? Bool != false, let name = entry.listed?.name {
                Text(name).font(Look.font(13, .medium)).foregroundStyle(Look.secondary).lineLimit(1)
            }
            if let problem = entry.problem {
                Text(problem.text).font(Look.font(13)).foregroundStyle(Look.label)
            } else if let layout = entry.layout {
                Part(part: layout, context: Look.Context(app: app, width: entry.width), root: true)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(12)
        .foregroundStyle(Look.label)
        .widgetURL(entry.listed?.opens.flatMap { URL(string: "one:\($0.entrypoint)") })
        .containerBackground(Look.card, for: .widget)
    }
}

struct AppWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "widget", intent: ChooseWidget.self, provider: Provider()) { entry in
            EntryView(entry: entry)
        }
        .configurationDisplayName(Network.app)
        .description("A widget from your apps.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}

@main
struct Widgets: WidgetBundle {
    var body: some Widget { AppWidget() }
}
