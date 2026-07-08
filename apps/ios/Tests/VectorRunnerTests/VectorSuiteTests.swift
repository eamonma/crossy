import XCTest

// The XCTest runner. Three concerns, three suites, mirroring vectors.test.ts:
// discovery + shape validation (hard pass/fail), the checked skip manifest, and gated
// execution that surfaces skips as XCTSkip. Every test that reads the vector tree calls
// `discover()`, so a malformed tree fails loudly across the suite rather than silently.

final class VectorSuiteTests: XCTestCase {
    // INV-1: one shared vector suite drives every port.

    func test_discoversReducerAndNavigationFamilies_INV1() throws {
        let families = Set(try discover().map(\.family))
        XCTAssertTrue(families.contains(.reducer), "vectors/v1/reducer/*.json not discovered")
        XCTAssertTrue(families.contains(.navigation), "vectors/v1/navigation/*.json not discovered")
    }

    func test_navigationSingleCellAdvanceEncodesTwelveSeedCases_INV1() throws {
        let seed = try discover().first {
            $0.family == .navigation && $0.cluster == "single-cell-advance"
        }
        let file = try XCTUnwrap(seed, "vectors/v1/navigation/single-cell-advance.json is missing")
        XCTAssertEqual(file.caseCount, 12, "PROTOCOL.md §13 pins exactly 12 seed cases")
    }

    func test_everyCaseMatchesVectorsReadmeShape_INV1() throws {
        var problems: [String] = []
        for file in try discover() {
            for problem in shapeProblems(for: file) {
                problems.append("\(file.family.rawValue)/\(file.cluster): \(problem)")
            }
        }
        XCTAssertTrue(problems.isEmpty, "shape violations:\n" + problems.joined(separator: "\n"))
    }
}

final class SkipManifestTests: XCTestCase {
    // The skip manifest is checked, not trusted (mirrors vectors.test.ts).

    func test_everySkippedFamilyHasVectorFilesOnDisk() throws {
        let discovered = Set(try discover().map(\.family))
        for family in try loadSkipManifest().families {
            XCTAssertTrue(
                discovered.contains(family),
                "vectors.skip.json lists \"\(family.rawValue)\" but no vectors/v1/\(family.rawValue)/*.json exists; remove the dead entry"
            )
        }
    }

    func test_everyDiscoveredFamilyIsBoundOrExplicitlySkipped() throws {
        let skip = try loadSkipManifest().families
        for family in Set(try discover().map(\.family)) {
            XCTAssertTrue(
                EngineBindings.bound.contains(family) || skip.contains(family),
                "family \"\(family.rawValue)\" has no engine binding and no vectors.skip.json entry; its cases would fail"
            )
        }
    }

    func test_skippedFamiliesLoseManifestEntryOnceEngineImplements() throws {
        // Coarse by design, mirroring vectors.test.ts. CrossyEngine exports nothing
        // until Wave 3; the moment a family is bound while the manifest still skips
        // something, this fails, forcing the manifest to be cleaned up. Swift's anchor is
        // `EngineBindings.bound`, not module reflection (see EngineBindings.swift).
        if try !loadSkipManifest().families.isEmpty {
            XCTAssertTrue(
                EngineBindings.bound.isEmpty,
                "CrossyEngine now binds \(EngineBindings.bound.map(\.rawValue)) while vectors.skip.json still skips families; bind them and remove their skip entries"
            )
        }
    }

    func test_aVectorRunAgainstTheUnimplementedEngineFailsHonestly() throws {
        // The honest-failure proof: a real case runs against the engine seam and must
        // throw `.noEngineBinding`. Red is real, so CI staying green means something.
        let skip = try loadSkipManifest().families
        guard let file = try discover().first(where: { skip.contains($0.family) }),
            let first = file.rawCases.first
        else {
            return  // nothing skipped: the bound-or-skipped guard already forces bindings
        }
        XCTAssertThrowsError(try EngineBindings.run(file.family, rawCase: first)) { error in
            guard case VectorError.noEngineBinding = error else {
                return XCTFail("expected .noEngineBinding, got \(error)")
            }
        }
    }
}

final class VectorExecutionTests: XCTestCase {
    // Execution against CrossyEngine. A skipped family surfaces as one XCTSkip carrying
    // its case list, so skips are visible in `swift test` output and never silent. One
    // method per family: the closed family set mirrors the TS `FAMILIES` const, and a
    // per-family method lets a partially-ported suite run some families while skipping
    // others (XCTSkip aborts the whole method, so a single shared method could not).

    func test_executeReducer() throws { try execute(.reducer) }
    func test_executeComparator() throws { try execute(.comparator) }
    func test_executeNavigation() throws { try execute(.navigation) }
    func test_executeCompletion() throws { try execute(.completion) }

    private func execute(_ family: VectorFamily) throws {
        let files = try discover().filter { $0.family == family }
        if try loadSkipManifest().families.contains(family) {
            let labels = files.flatMap(\.caseLabels)
            throw XCTSkip(
                "\(family.rawValue): \(labels.count) case(s) skipped, CrossyEngine unimplemented until Wave 3 — "
                    + labels.joined(separator: "; "))
        }
        for file in files {
            for rawCase in file.rawCases {
                try EngineBindings.run(family, rawCase: rawCase)
            }
        }
    }
}
