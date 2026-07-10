// The client-store conformance suite: executes every shared vector case against the
// real GameStore (PROTOCOL.md §13). This is the iOS half of the drift fence — the same
// JSON runs in apps/web's vitest suite — and the bound consumer that drains the
// `client-store` foreign family's execution debt (apps/ios/vectors.skip.json): the
// vector runner shape-validates the family, this suite executes it.
//
// Coverage is guarded in the runner's "skipping silently is forbidden" ethos: the
// bound-cluster set must equal what discovery finds on disk (a new vector file fails
// until a method binds it), and the total case count is pinned exactly as the web
// runner pins it, so a case addition updates both suites deliberately.

import CrossyStore
import XCTest

@available(iOS 17.0, macOS 14.0, *)
@MainActor
final class ClientStoreVectorTests: XCTestCase {
    /// Every cluster this suite binds to an execution method below. Discovery is
    /// checked against this set, so a vector file cannot appear (or vanish) silently.
    private static let boundClusters: Set<String> = [
        "echo-and-error",
        "first-fill-at",
        "local-command",
        "sequencing",
        "snapshot-reconciliation",
    ]

    // MARK: - Coverage guards

    func test_everyClientStoreVectorFileOnDiskIsBoundToAnExecutionMethod_INV10() throws {
        XCTAssertEqual(
            Set(try ClientStoreVectors.discover().map(\.cluster)), Self.boundClusters,
            "vectors/v1/client-store and this suite's bound clusters must match exactly; "
                + "bind a new file with an execution method, never skip it silently")
    }

    func test_discoversAllTwentyCases_aVectorAdditionUpdatesThisCountDeliberately_INV10() throws {
        // Mirrors the web runner's count guard (client-store.vectors.test.ts): 14
        // Wave 1.1e cases plus 6 first-fill-at cases.
        let total = try ClientStoreVectors.discover().reduce(0) { $0 + $1.cases.count }
        XCTAssertEqual(total, 20)
    }

    // MARK: - Execution, one method per cluster (all cases in the file run)

    func test_echoAndError_echoAndNonFatalErrorClearOverlayFatalPreservesIt_INV10() throws {
        try execute("echo-and-error")
    }

    func test_firstFillAt_derivedTimerOriginFromDeltaAndSnapshot_D15() throws {
        try execute("first-fill-at")
    }

    func test_localCommand_optimisticOverlayEntryRendersAndSends_INV10() throws {
        try execute("local-command")
    }

    func test_sequencing_contiguousSeqGapToResyncStaleDiscarded_INV2() throws {
        try execute("sequencing")
    }

    func test_snapshotReconciliation_welcomeSyncAndCrashRollbackIdentical_INV10_INV5() throws {
        try execute("snapshot-reconciliation")
    }

    private func execute(
        _ cluster: String, file: StaticString = #filePath, line: UInt = #line
    ) throws {
        XCTAssertTrue(
            Self.boundClusters.contains(cluster),
            "\(cluster) executes but is not in boundClusters; the coverage guard is stale",
            file: file, line: line)
        let clusters = try ClientStoreVectors.discover()
        guard let found = clusters.first(where: { $0.cluster == cluster }) else {
            return XCTFail(
                "vectors/v1/client-store/\(cluster).json is missing", file: file, line: line)
        }
        for vectorCase in found.cases {
            try runClientStoreCase(vectorCase, cluster: cluster, file: file, line: line)
        }
    }
}
