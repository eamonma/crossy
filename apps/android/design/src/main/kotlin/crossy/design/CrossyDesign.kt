// Mirrors apps/ios/Sources/CrossyDesign/CrossyDesign.swift. The :design module (AAD-1:
// adapter; JVM-pure, no Android or Compose types). Tokens: the two grounds (Grounds.kt), the
// twelve-color roster and its FNV-1a indexing (IdentityRoster, IdentityHash; a cross-client
// contract, root DESIGN.md §8), type scale, motion constants, and the ID-1 attribution
// switches. Colors are plain ARGB data (RGBColor); Compose `Color` construction lives in
// :ui. Shared with any future widget surface.
package crossy.design
