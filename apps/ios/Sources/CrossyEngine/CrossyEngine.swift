// CrossyEngine: the pure crossword domain (reducer, comparator, navigation), the Swift
// twin of packages/engine (DESIGN.md §5). INV-9 holds here too: this module imports
// nothing and takes timestamps and user ids as data.
//
// It exports nothing today, on purpose. The Wave 3 Swift port lands here, driven
// red-to-green by the shared vectors under vectors/ (ROADMAP.md Phase 3, Track C). The
// vector runner in Tests/VectorRunnerTests proves the port is honestly absent until
// then: every family is skipped under a checked manifest, and one guard test asserts a
// real case still throws "no engine binding".
