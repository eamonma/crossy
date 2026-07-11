// The Apple-auth seam (roadmap I3a, second provider): AuthSession asks for one round
// trip, a nonce challenge out and an Apple identity token back, so tests inject a fake
// and never present the system sheet. The real implementation is ASAuthorizationController,
// iOS-only (the package also builds for macOS to test headlessly; nothing there presents).
//
// The full name rides this seam because Apple only delivers it on the FIRST authorization
// for an app; every authorization after is name-less forever. AuthSession pushes it to
// the display-name mirror once, so the seam has to carry it out on that one occasion.

import CryptoKit
import Foundation

/// One completed Sign in with Apple authorization: the identity token AuthSession trades
/// for a Supabase session, and the full name when Apple chose to deliver it (nil on every
/// authorization after the first, and nil when the person withheld it).
public struct AppleIDAuthorization: Sendable, Equatable {
    public let idToken: String
    public let fullName: String?

    public init(idToken: String, fullName: String?) {
        self.idToken = idToken
        self.fullName = fullName
    }
}

/// Present the system Sign in with Apple UI and resolve the authorization. `nonceChallenge`
/// is the hashed nonce Apple stamps into the id_token (AppleNonce.challenge); the raw nonce
/// stays with AuthSession for the token grant. Main-actor because the real implementation
/// presents UI.
public protocol AppleAuthenticating: Sendable {
    @MainActor
    func authenticate(nonceChallenge: String) async throws -> AppleIDAuthorization
}

/// The two ways the Apple leg ends without an authorization. Cancellation is its own case
/// because it is a choice, not a failure (AuthStateMachine: a quiet return to signed out,
/// no retry copy), mirroring WebAuthenticationError.
public enum AppleAuthenticationError: Error {
    case canceled
    case failed(underlying: any Error)
}

/// The nonce Apple stamps into the id_token. GoTrue, on the token grant, hashes the raw
/// nonce we send and compares its lowercase hex against the id_token's `nonce` claim, so
/// the value handed to Apple must be that same hex of SHA-256 over the raw nonce's ASCII
/// bytes. This is hex, NOT the base64url PKCE.challenge form; the two are not interchangeable.
public enum AppleNonce {
    /// Lowercase hex of SHA-256(ASCII(raw)). The raw nonce is a PKCE verifier (base64url,
    /// ASCII by construction), so `raw.utf8` is its ASCII bytes.
    public static func challenge(for raw: String) -> String {
        SHA256.hash(data: Data(raw.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }
}

#if os(iOS)
    import AuthenticationServices

    /// The production presenter. Wraps ASAuthorizationController around an Apple ID request
    /// scoped to full name and email, carrying the hashed nonce. ASAuthorizationController
    /// holds only a weak delegate, so the presenter retains the delegate (which retains the
    /// controller) for the round trip; both drop when the continuation resumes.
    @MainActor
    public final class AppleSignInPresenter: NSObject, AppleAuthenticating {
        private var inFlight: Delegate?

        override public init() {
            super.init()
        }

        public func authenticate(nonceChallenge: String) async throws -> AppleIDAuthorization {
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = nonceChallenge

            let controller = ASAuthorizationController(authorizationRequests: [request])
            return try await withCheckedThrowingContinuation { continuation in
                let delegate = Delegate(controller: controller, continuation: continuation) {
                    [weak self] in self?.inFlight = nil
                }
                inFlight = delegate
                controller.delegate = delegate
                controller.presentationContextProvider = delegate
                controller.performRequests()
            }
        }

        /// The delegate bridges the ASAuthorizationController callbacks to the checked
        /// continuation and answers the presentation anchor. One-shot: the continuation
        /// resumes exactly once, and the presenter's strong hold drops with it.
        private final class Delegate: NSObject, ASAuthorizationControllerDelegate,
            ASAuthorizationControllerPresentationContextProviding
        {
            private let controller: ASAuthorizationController
            private var continuation: CheckedContinuation<AppleIDAuthorization, any Error>?
            private let release: () -> Void

            init(
                controller: ASAuthorizationController,
                continuation: CheckedContinuation<AppleIDAuthorization, any Error>,
                release: @escaping () -> Void
            ) {
                self.controller = controller
                self.continuation = continuation
                self.release = release
            }

            private func finish(_ result: Result<AppleIDAuthorization, any Error>) {
                guard let continuation else { return }
                self.continuation = nil
                continuation.resume(with: result)
                release()
            }

            func authorizationController(
                controller: ASAuthorizationController,
                didCompleteWithAuthorization authorization: ASAuthorization
            ) {
                guard
                    let credential = authorization.credential
                        as? ASAuthorizationAppleIDCredential,
                    let tokenData = credential.identityToken,
                    let idToken = String(data: tokenData, encoding: .utf8)
                else {
                    finish(.failure(AppleAuthenticationError.failed(underlying: URLError(.unknown))))
                    return
                }
                finish(
                    .success(
                        AppleIDAuthorization(
                            idToken: idToken, fullName: Self.fullName(credential.fullName))))
            }

            func authorizationController(
                controller: ASAuthorizationController, didCompleteWithError error: any Error
            ) {
                if let authError = error as? ASAuthorizationError,
                    authError.code == .canceled
                {
                    finish(.failure(AppleAuthenticationError.canceled))
                    return
                }
                finish(.failure(AppleAuthenticationError.failed(underlying: error)))
            }

            func presentationAnchor(for controller: ASAuthorizationController)
                -> ASPresentationAnchor
            {
                // The frontmost key window; a fresh anchor is the documented fallback when
                // no scene is up yet (WebAuthenticationPresenter's approach, verbatim).
                let scenes = UIApplication.shared.connectedScenes
                let window = scenes
                    .compactMap { $0 as? UIWindowScene }
                    .flatMap(\.windows)
                    .first(where: \.isKeyWindow)
                return window ?? ASPresentationAnchor()
            }

            /// Given plus family joined with a space; nil when both are absent (Apple
            /// delivers the name only on first authorization, so this is nil forever after).
            private static func fullName(_ components: PersonNameComponents?) -> String? {
                let parts = [components?.givenName, components?.familyName].compactMap { $0 }
                let joined = parts.joined(separator: " ")
                return joined.isEmpty ? nil : joined
            }
        }
    }
#endif
