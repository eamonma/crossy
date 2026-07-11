// The web-auth seam (roadmap I3a): AuthSession asks for one round trip, URL out and
// callback URL back, so tests inject a fake and never present a sheet. The real
// implementation is ASWebAuthenticationSession, iOS-only (the package also builds
// for macOS to test headlessly; nothing there ever presents).

import Foundation

/// Present the system web-auth UI for `url` and resolve the callback URL delivered
/// to `callbackScheme`. Main-actor because the real implementation presents UI.
public protocol WebAuthenticating: Sendable {
    @MainActor
    func authenticate(url: URL, callbackScheme: String) async throws -> URL
}

/// The two ways the web leg ends without a callback. Cancellation is its own case
/// because it is a choice, not a failure (AuthStateMachine: a quiet return to
/// signed out, no retry copy).
public enum WebAuthenticationError: Error {
    case canceled
    case failed(underlying: any Error)
}

#if os(iOS)
    import AuthenticationServices

    /// The production presenter. Not ephemeral: the Discord session cookie
    /// surviving between sign-ins is the second sign-in being one tap.
    public final class WebAuthenticationPresenter: NSObject, WebAuthenticating,
        ASWebAuthenticationPresentationContextProviding
    {
        override public init() {
            super.init()
        }

        @MainActor
        public func authenticate(url: URL, callbackScheme: String) async throws -> URL {
            try await withCheckedThrowingContinuation { continuation in
                let session = ASWebAuthenticationSession(
                    url: url,
                    callback: .customScheme(callbackScheme)
                ) { callbackURL, error in
                    if let callbackURL {
                        continuation.resume(returning: callbackURL)
                        return
                    }
                    if let error = error as? ASWebAuthenticationSessionError,
                        error.code == .canceledLogin
                    {
                        continuation.resume(throwing: WebAuthenticationError.canceled)
                        return
                    }
                    continuation.resume(
                        throwing: WebAuthenticationError.failed(
                            underlying: error ?? URLError(.unknown)))
                }
                session.presentationContextProvider = self
                session.start()
            }
        }

        public func presentationAnchor(for session: ASWebAuthenticationSession)
            -> ASPresentationAnchor
        {
            // The frontmost key window; a fresh anchor is the documented fallback
            // when no scene is up yet (cold launch straight into sign-in).
            let scenes = UIApplication.shared.connectedScenes
            let window = scenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first(where: \.isKeyWindow)
            return window ?? ASPresentationAnchor()
        }
    }
#endif
