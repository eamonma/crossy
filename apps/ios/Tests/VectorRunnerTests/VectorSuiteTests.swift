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

    func test_discoversClientStoreFamilyAsForeign_INV10() throws {
        let families = Set(try discover().map(\.family))
        XCTAssertTrue(
            families.contains(.clientStore), "vectors/v1/client-store/*.json not discovered")
        let manifest = try loadSkipManifest()
        XCTAssertTrue(
            manifest.foreignFamilies.contains(.clientStore),
            "client-store must be a foreign family in vectors.skip.json")
        // Foreign: never a skipped-until-engine family, never an engine binding. This is the
        // distinction the Wave 3 rebind relies on (PROTOCOL.md §13).
        XCTAssertFalse(
            manifest.families.contains(.clientStore),
            "client-store is foreign, not skipped-until-engine; it must not be in `families`")
        XCTAssertFalse(
            EngineBindings.bound.contains(.clientStore),
            "client-store is foreign; it must never bind to CrossyEngine")
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

    func test_everySkippedOrForeignFamilyHasVectorFilesOnDisk() throws {
        let discovered = Set(try discover().map(\.family))
        let manifest = try loadSkipManifest()
        for family in manifest.families.union(manifest.foreignFamilies) {
            XCTAssertTrue(
                discovered.contains(family),
                "vectors.skip.json lists \"\(family.rawValue)\" but no vectors/v1/\(family.rawValue)/*.json exists; remove the dead entry"
            )
        }
    }

    func test_everyDiscoveredFamilyIsBoundSkippedOrForeign() throws {
        let manifest = try loadSkipManifest()
        for family in Set(try discover().map(\.family)) {
            XCTAssertTrue(
                EngineBindings.bound.contains(family) || manifest.families.contains(family)
                    || manifest.foreignFamilies.contains(family),
                "family \"\(family.rawValue)\" has no engine binding and no vectors.skip.json entry; its cases would fail"
            )
        }
    }

    func test_aForeignFamilyIsNeverBoundToTheEngine() throws {
        // Foreign families execute in apps/web + iOS, never here. This holds through the
        // Wave 3 rebind: that wave binds `families`, never `foreignFamilies`.
        for family in try loadSkipManifest().foreignFamilies {
            XCTAssertFalse(
                EngineBindings.bound.contains(family),
                "family \"\(family.rawValue)\" is foreign but binds to CrossyEngine; foreign families run in their own consumer's suite, not the engine"
            )
        }
    }

    func test_eachEngineFamilyIsBoundIffDrainedFromManifest() throws {
        // Replaces Wave 0.2b's coarse "bound is empty while any family is skipped" guard,
        // exactly as vectors.test.ts replaced its coarse export guard when it drained. That
        // guard fired the moment the first family bound; the Wave 3 port binds and drains
        // one family at a time, so the invariant is now per family: a family the engine
        // implements is bound here and absent from the manifest; a family still awaiting
        // the engine is unbound and listed. Never both, never neither. This holds at every
        // intermediate commit as the four families drain one at a time. Foreign families are
        // covered by their own guards below.
        let manifest = try loadSkipManifest()
        for family in Set(try discover().map(\.family)) where !manifest.foreignFamilies.contains(family) {
            let bound = EngineBindings.bound.contains(family)
            let skipped = manifest.families.contains(family)
            XCTAssertNotEqual(
                bound, skipped,
                "family \"\(family.rawValue)\" must be bound-and-drained or unbound-and-skipped, not bound=\(bound) skipped=\(skipped)"
            )
        }
    }

    func test_aForeignFamilyRunThrowsNoEngineBinding() throws {
        // Repointed from Wave 0.2b's honest-failure guard, mirroring vectors.test.ts. That
        // guard proved a skipped-until-engine family threw rather than silently passing;
        // once the Wave 3 port drains `families` to empty, that subject is gone (real
        // executions now prove red is real). The remaining never-bound family is the foreign
        // one (client-store): running it through the engine seam must still throw
        // `.noEngineBinding`, since its consumer is a client store, not CrossyEngine. This
        // keeps the honest-failure invariant with a live subject through and after the drain
        // (PROTOCOL §13, vectors/README.md).
        let manifest = try loadSkipManifest()
        guard let file = try discover().first(where: { manifest.foreignFamilies.contains($0.family) }),
            let first = file.rawCases.first
        else {
            return  // no foreign family present
        }
        XCTAssertFalse(
            EngineBindings.bound.contains(file.family),
            "\(file.family.rawValue) is foreign; it must never bind to CrossyEngine")
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
    // others (XCTSkip aborts the whole method, so a single shared method could not). A
    // foreign family skips with a `[foreign: apps/web + iOS store]` label instead of the
    // until-engine reason: its consumer is a client store, so it is never run here.

    func test_executeReducer() throws { try execute(.reducer) }
    func test_executeComparator() throws { try execute(.comparator) }
    func test_executeNavigation() throws { try execute(.navigation) }
    func test_executeCompletion() throws { try execute(.completion) }
    func test_executeCheck() throws { try execute(.check) }
    func test_executeClientStore() throws { try execute(.clientStore) }
    func test_executeClueRuns() throws { try execute(.clueRuns) }

    private func execute(_ family: VectorFamily) throws {
        let files = try discover().filter { $0.family == family }
        let manifest = try loadSkipManifest()
        if manifest.foreignFamilies.contains(family) {
            // Foreign: shape-only here, executed by apps/web + iOS. Labeled apart from the
            // until-engine skip so the two reasons stay legible in the summary.
            let labels = files.flatMap(\.caseLabels)
            throw XCTSkip(
                "\(family.rawValue) [foreign: apps/web + iOS store]: \(labels.count) case(s) shape-only here, executed by the consumer's suite - "
                    + labels.joined(separator: "; "))
        }
        if manifest.families.contains(family) {
            let labels = files.flatMap(\.caseLabels)
            throw XCTSkip(
                "\(family.rawValue): \(labels.count) case(s) skipped, CrossyEngine unimplemented until Wave 3 - "
                    + labels.joined(separator: "; "))
        }
        for file in files {
            for rawCase in file.rawCases {
                try EngineBindings.run(family, rawCase: rawCase)
            }
        }
    }
}
