//
//  NoopAnalytics.swift
//  Crossy
//
//  The silent side of the analytics seam (mockAdapter.ts's slot): selected when the
//  plist token is empty and for the compositions that would only emit noise (Xcode
//  previews, the lab rigs, the demo room, the fixture walk, the harness). The
//  selection lives in makeAnalytics, so no call site checks anything.
//

import Foundation

struct NoopAnalytics: Analytics {
    func capture(_ event: String, properties: [String: Any]?) {}
    func identify(userId: String) {}
    func reset() {}
}
