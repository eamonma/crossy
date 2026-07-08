import Foundation

/// One discovered vector file: its family, cluster (basename without `.json`), raw
/// bytes for typed decoding, and the generically parsed cases for labels, counts, and
/// the honest-failure run. Case counts are never hardcoded; concurrent tracks add files
/// and the runner reports whatever is on disk.
struct DiscoveredFile {
    let family: VectorFamily
    let cluster: String
    let data: Data
    let rawCases: [[String: Any]]

    var caseCount: Int { rawCases.count }

    var caseLabels: [String] {
        rawCases.enumerated().map { index, raw in
            if family == .comparator, let solution = raw["solution"] as? String {
                return "solution \"\(solution)\""
            }
            if let name = raw["name"] as? String { return name }
            return "case \(index)"
        }
    }
}

/// Strict on purpose (vectors/README.md: skipping silently is forbidden). An unknown
/// family, a stray file, or a file that is not a non-empty array of case objects throws
/// instead of being skipped, mirroring the TS `discover()`. Entries are sorted so the
/// output order is stable across platforms.
func discover() throws -> [DiscoveredFile] {
    let fileManager = FileManager.default
    var files: [DiscoveredFile] = []

    let familyEntries = try fileManager
        .contentsOfDirectory(
            at: RepoLayout.vectorsV1, includingPropertiesForKeys: [.isDirectoryKey])
        .sorted { $0.lastPathComponent < $1.lastPathComponent }

    for entry in familyEntries {
        let isDirectory = (try entry.resourceValues(forKeys: [.isDirectoryKey])).isDirectory ?? false
        guard isDirectory else { throw VectorError.strayEntry(entry.lastPathComponent) }
        guard let family = VectorFamily(rawValue: entry.lastPathComponent) else {
            throw VectorError.unknownFamily(entry.lastPathComponent)
        }

        let clusterEntries = try fileManager
            .contentsOfDirectory(at: entry, includingPropertiesForKeys: [.isRegularFileKey])
            .sorted { $0.lastPathComponent < $1.lastPathComponent }

        for file in clusterEntries {
            let name = file.lastPathComponent
            let isFile = (try file.resourceValues(forKeys: [.isRegularFileKey])).isRegularFile ?? false
            guard isFile, name.hasSuffix(".json") else {
                throw VectorError.strayFile(family: family.rawValue, file: name)
            }

            let data = try Data(contentsOf: file)
            let path = "\(family.rawValue)/\(name)"
            guard let array = try? JSONSerialization.jsonObject(with: data) as? [Any],
                !array.isEmpty
            else {
                throw VectorError.notCaseArray(path: path)
            }
            var rawCases: [[String: Any]] = []
            for element in array {
                guard let object = element as? [String: Any] else {
                    throw VectorError.notCaseArray(path: path)
                }
                rawCases.append(object)
            }

            files.append(
                DiscoveredFile(
                    family: family,
                    cluster: String(name.dropLast(".json".count)),
                    data: data,
                    rawCases: rawCases))
        }
    }

    return files
}

/// The checked skip manifest. Mirrors packages/engine/vectors.skip.json semantics: a
/// listed family that does not name a real family is a hard error here, so the manifest
/// cannot drift into meaninglessness.
func loadSkipManifest() throws -> (reason: String, families: Set<VectorFamily>) {
    let data = try Data(contentsOf: RepoLayout.skipManifest)
    guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let reason = object["reason"] as? String,
        let rawFamilies = object["families"] as? [Any]
    else {
        throw VectorError.badManifest(
            "vectors.skip.json must be { reason: string, families: string[] }")
    }
    var families: Set<VectorFamily> = []
    for entry in rawFamilies {
        guard let name = entry as? String, let family = VectorFamily(rawValue: name) else {
            throw VectorError.unknownManifestFamily(String(describing: entry))
        }
        families.insert(family)
    }
    return (reason, families)
}

/// Decodes every case in a file to its family's shape (straight from bytes) and adds the
/// semantic problems. Empty means the file matches vectors/README.md exactly. A decode
/// failure returns one problem locating the offending case and field.
func shapeProblems(for file: DiscoveredFile) -> [String] {
    let decoder = JSONDecoder()
    do {
        switch file.family {
        case .reducer:
            return try decoder.decode([ReducerCase].self, from: file.data)
                .flatMap { c in c.shapeProblems().map { "\(c.label): \($0)" } }
        case .comparator:
            return try decoder.decode([ComparatorCase].self, from: file.data)
                .flatMap { c in c.shapeProblems().map { "\(c.label): \($0)" } }
        case .navigation:
            return try decoder.decode([NavigationCase].self, from: file.data)
                .flatMap { c in c.shapeProblems().map { "\(c.label): \($0)" } }
        case .completion:
            return try decoder.decode([CompletionCase].self, from: file.data)
                .flatMap { c in c.shapeProblems().map { "\(c.label): \($0)" } }
        }
    } catch {
        return ["does not decode to the \(file.family.rawValue) shape: \(describeDecodingError(error))"]
    }
}

/// A readable, located rendering of a `DecodingError`, so a shape failure names the case
/// index and field rather than dumping the raw error.
func describeDecodingError(_ error: Error) -> String {
    guard let error = error as? DecodingError else { return "\(error)" }
    func path(_ context: DecodingError.Context) -> String {
        context.codingPath
            .map { key in key.intValue.map { "[\($0)]" } ?? ".\(key.stringValue)" }
            .joined()
    }
    switch error {
    case .keyNotFound(let key, let context):
        return "missing key \"\(key.stringValue)\" at \(path(context))"
    case .typeMismatch(let type, let context):
        return "type mismatch, expected \(type) at \(path(context))"
    case .valueNotFound(let type, let context):
        return "missing value of \(type) at \(path(context))"
    case .dataCorrupted(let context):
        return "\(context.debugDescription) at \(path(context))"
    @unknown default:
        return "\(error)"
    }
}
