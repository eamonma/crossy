// CrossyEngine: the pure crossword domain (reducer, comparator, navigation), the Swift
// twin of packages/engine (DESIGN.md §5). INV-9 holds here too: this module imports
// nothing (not even Foundation), and takes timestamps and user ids as data.
//
// The public surface mirrors packages/engine, in Swift terms so the future iOS store finds
// the same vocabulary:
//
//   reduce(_:_:)                  one-command reducer (Reducer.swift)
//   applyWithCompletion(_:_:_:)   two-phase completion driver (Completion.swift)
//   matches(_:_:)                 the comparator (Comparator.swift)
//   getNextCell / wordBounds / tabTarget / typingAdvance / backspaceTarget
//                                 the five navigation operations (Navigation.swift)
//
// The domain types are Swift-native structs and enums (Types.swift), not JSON mirrors.
// Nothing keeps this port and the TypeScript engine in agreement except the shared
// conformance vectors under vectors/: Tests/VectorRunnerTests runs the same JSON through
// both, so a drift shows up as a failing vector rather than a silent divergence.
