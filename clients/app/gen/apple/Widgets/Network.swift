import Foundation

/// What a widget asks its network, through the app's client in the App Group the two share (`clients/app/widgets`).
enum Network {
    /// What the network answered: a result, or why there's none, and whether that's because this device isn't in it.
    enum Answer {
        case result(Any)
        case signedOut
        case failed(String)
    }

    static let group = Bundle.main.object(forInfoDictionaryKey: "AppGroup") as? String ?? ""
    static var folder: URL? { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) }
    /// The app's name, as its widget names it.
    static let app = Bundle.main.object(forInfoDictionaryKey: "AppName") as? String ?? "the app"

    static func request(_ method: String, _ params: [String: Any]) async -> Answer {
        guard let home = folder?.path else { return .failed("This widget can't reach \(app).") }
        let asked = String(data: (try? JSONSerialization.data(withJSONObject: params)) ?? Data("{}".utf8), encoding: .utf8) ?? "{}"
        let said: String = await Task.detached {
            guard let answer = one_widgets_request(home, method, asked) else { return "{}" }
            defer { one_widgets_free(answer) }
            return String(cString: answer)
        }.value
        let answer = (try? JSONSerialization.jsonObject(with: Data(said.utf8))) as? [String: Any] ?? [:]
        if answer["signedOut"] as? Bool == true { return .signedOut }
        if let error = answer["error"] as? String { return .failed(error) }
        return .result(answer["result"] ?? NSNull())
    }

    /// Calls the app's tool `name` with `arguments`, and gives what it answered: its structured content, or the JSON
    /// its text is, as the Home Screen reads it.
    static func call(_ name: String, _ arguments: [String: Any]) async -> Answer {
        switch await request("tools/call", ["name": name, "arguments": arguments]) {
        case .result(let result):
            let result = result as? [String: Any] ?? [:]
            let text = ((result["content"] as? [[String: Any]])?.first?["text"] as? String) ?? ""
            if result["isError"] as? Bool == true { return .failed(text) }
            if let structured = result["structuredContent"] { return .result(structured) }
            return .result((try? JSONSerialization.jsonObject(with: Data(text.utf8), options: .fragmentsAllowed)) ?? text)
        case let other:
            return other
        }
    }
}
