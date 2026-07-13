//
//  TurnstileProvider.swift
//  Crossy
//
//  The invisible captcha leg for the email OTP send (auth I3b follow-up). Supabase
//  has Cloudflare Turnstile protection on project-wide, so GoTrue refuses the /otp
//  send with `captcha_failed` unless the request carries a captcha token. iOS has no
//  guest flow, so it had no Turnstile until now; this mints an invisible token from
//  the public site key in a hidden WKWebView and hands it to the send.
//
//  Why the app target and not CrossyUI: the widget is WebKit, and CrossyUI stays free
//  of UIKit/WebKit (AD-2, the SafariSheet/CameraScan/ShareSheet precedent). The sheet
//  in CrossyUI takes the web view as an injected @ViewBuilder closure and an async
//  token function, exactly as JoinCodeScreen takes its camera scanner. The web view
//  lives INSIDE the sheet so a forced interactive challenge can be revealed in place;
//  in the calm case it renders nothing (appearance "interaction-only") and stays
//  zero-size offscreen.
//
//  The token lifecycle: token() resets the widget and executes it, then suspends on a
//  continuation the script message handler resumes when Turnstile calls back with a
//  fresh token. Tokens are single-use and expire (~300s), so every send/resend calls
//  token() again for a new one. A timeout resolves the continuation with a calm error
//  rather than deadlocking if a token never arrives.
//

import Observation
import SwiftUI
import WebKit

/// Why a Turnstile token acquisition failed. The sheet renders one calm sentence for
/// all of these (the arrival-error voice): the specific reason is diagnostic only.
enum TurnstileError: Error, Equatable {
    /// No site key in this build: the plist slot is empty and no launch fact set one.
    /// Callers with a nil provider never reach here; this is the belt-and-suspenders
    /// case a misconfigured provider would raise.
    case unconfigured
    /// The widget signaled an error callback (a network fault reaching Cloudflare, an
    /// expired challenge, a bad site key).
    case widgetError
    /// No token arrived inside the timeout window, so the send is not left hanging.
    case timedOut
    /// The web view went away mid-request (the sheet dismissed).
    case canceled
}

/// The pure HTML/JS the hidden web view loads, plus the message names it posts back on.
/// Split out as a value with no WebKit so the render options and the script contract are
/// unit-testable without a live web view (the invariant: interaction-only appearance, so
/// nothing shows in the calm case; explicit render, so we control size and callbacks).
enum TurnstilePage {
    /// The single message-handler name the page posts every event through
    /// (`window.webkit.messageHandlers.<name>.postMessage`). The Coordinator registers
    /// exactly this name.
    static let messageHandlerName = "turnstile"

    /// The base URL the page loads under, so Turnstile sees an allowed hostname on the
    /// site key's allowlist. NEVER nil/about:blank (Turnstile refuses an opaque origin).
    static let baseURL = URL(string: "https://crossy.party")!

    /// The event kinds the page posts back, as the `event` field of each message.
    enum Event: String {
        /// A fresh token is ready; the `token` field carries it.
        case token
        /// The widget errored (the JS error-callback).
        case error
        /// Turnstile is about to raise an interactive challenge: reveal the web view.
        case challengeOpen = "challenge-open"
        /// The interactive challenge finished (solved or dismissed): hide the web view.
        case challengeClose = "challenge-close"
    }

    /// The page: the Turnstile script, an explicit render with the site key, and the
    /// callbacks that post each event back. `appearance: "interaction-only"` keeps the
    /// widget invisible unless a challenge is actually needed (the owner ruling: no
    /// visible captcha box in the calm sheet), and `size: "flexible"` lets it fill the
    /// revealed area when a challenge does appear. The site key is injected as a JS
    /// string literal; it is the public key (a plain token, no quoting hazard), but it
    /// is still escaped to keep the page well-formed for any future key shape.
    static func html(siteKey: String) -> String {
        let escaped = jsStringLiteral(siteKey)
        return """
            <!doctype html>
            <html>
            <head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
            <style>
              html, body { margin: 0; padding: 0; background: transparent; }
              #widget { display: flex; align-items: center; justify-content: center; }
            </style>
            </head>
            <body>
            <div id="widget"></div>
            <script>
              function post(payload) {
                try {
                  window.webkit.messageHandlers.\(messageHandlerName).postMessage(payload);
                } catch (e) {}
              }
              var widgetId = null;
              function renderWidget() {
                if (typeof turnstile === "undefined") { return false; }
                widgetId = turnstile.render("#widget", {
                  sitekey: \(escaped),
                  appearance: "interaction-only",
                  size: "flexible",
                  retry: "never",
                  callback: function (token) { post({ event: "token", token: token }); },
                  "error-callback": function () { post({ event: "error" }); return true; },
                  "before-interactive-callback": function () { post({ event: "challenge-open" }); },
                  "after-interactive-callback": function () { post({ event: "challenge-close" }); }
                });
                return true;
              }
              // execute(): reset any prior render and run a fresh challenge, so every
              // call yields a single-use token. The first call renders; later calls
              // reset then re-execute the same widget.
              window.__crossyExecute = function () {
                if (widgetId === null) {
                  if (!renderWidget()) {
                    // The script is still loading; retry shortly.
                    setTimeout(window.__crossyExecute, 150);
                  }
                  return;
                }
                try {
                  turnstile.reset(widgetId);
                  turnstile.execute(widgetId);
                } catch (e) {
                  post({ event: "error" });
                }
              };
            </script>
            </body>
            </html>
            """
    }

    /// The JS to kick a fresh challenge; the Coordinator evaluates this each token().
    static let executeScript = "window.__crossyExecute && window.__crossyExecute();"

    /// Escape a string as a double-quoted JS string literal (the site key). Keeps the
    /// page well-formed even if a future key carries a quote or backslash.
    static func jsStringLiteral(_ raw: String) -> String {
        var out = "\""
        for ch in raw {
            switch ch {
            case "\\": out += "\\\\"
            case "\"": out += "\\\""
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            default: out.append(ch)
            }
        }
        out += "\""
        return out
    }
}

/// The captcha provider the composition root builds and the sheet drives. @MainActor
/// @Observable, the AuthSession posture: the sheet reads `isChallengeVisible` to reveal
/// the web view, and token() is the async acquisition the send awaits. It owns no
/// WKWebView directly; the Coordinator (created by the representable) registers itself
/// here so token() can drive the live web view. Before the web view mounts, token()
/// waits briefly for it rather than failing outright.
@MainActor
@Observable
final class TurnstileProvider {
    /// The public site key rendered into the page. nil means this build has no captcha
    /// configured; token() then throws `.unconfigured` and the caller can decide (the
    /// composition root simply omits the provider, so this is the safety net).
    let siteKey: String?

    /// How long to wait for a token before giving up with a calm error. Generous, so a
    /// slow network or a hand-solved interactive challenge still lands; short enough
    /// that a truly dead widget does not hang the send forever.
    static let timeout: Duration = .seconds(30)

    /// True while an interactive challenge is on screen: the sheet reveals the web view.
    /// Invisible-by-default means this stays false in the calm case.
    private(set) var isChallengeVisible = false

    /// The live web view's control surface, set by the Coordinator when the
    /// representable mounts and cleared when it dismantles. token() drives execution
    /// through this.
    private weak var host: (any TurnstileHosting)?

    /// The continuation for the in-flight token() call, resumed once by the first event
    /// that resolves it (token, error, or timeout). Nil when no acquisition is pending.
    private var pending: CheckedContinuation<String, Error>?

    init(siteKey: String?) {
        self.siteKey = siteKey
    }

    /// Acquire a FRESH single-use token. Resets and executes the widget, then suspends
    /// until the script posts a token (resolve), posts an error (throw `.widgetError`),
    /// or the timeout elapses (throw `.timedOut`). One acquisition at a time: a second
    /// call while one is pending cancels the first (the sheet never runs two sends at
    /// once, but a resend racing a stuck send must not leak a continuation).
    func token() async throws -> String {
        guard let siteKey, !siteKey.isEmpty else { throw TurnstileError.unconfigured }

        // A second request supersedes any stuck one: fail the old continuation calmly
        // rather than leaving it dangling.
        resolvePending(.failure(TurnstileError.canceled))

        // The web view may not have mounted yet (the sheet just appeared). Wait a beat
        // for the Coordinator to register a host rather than failing immediately.
        if host == nil {
            await waitForHost()
        }
        guard let host else { throw TurnstileError.timedOut }

        return try await withThrowingTaskGroup(of: String.self) { group in
            group.addTask { @MainActor in
                try await withCheckedThrowingContinuation { continuation in
                    self.pending = continuation
                    host.execute()
                }
            }
            group.addTask { @MainActor in
                try await Task.sleep(for: Self.timeout)
                // The timeout arm resolves the pending continuation itself, so the
                // acquisition arm returns with the thrown error; then this arm returns
                // a sentinel that the winner-takes-all cancellation discards.
                self.resolvePending(.failure(TurnstileError.timedOut))
                throw TurnstileError.timedOut
            }
            // The first arm to finish wins; cancel the other.
            defer { group.cancelAll() }
            let value = try await group.next()!
            return value
        }
    }

    /// Wait up to a short window for the web view to register a host, polling gently.
    /// Returns as soon as a host appears, or after the window (token() then throws).
    private func waitForHost() async {
        let deadline = ContinuousClock.now.advanced(by: .seconds(3))
        while host == nil, ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(50))
        }
    }

    // MARK: - Coordinator wiring

    /// The web view registers its control surface here on mount.
    func attach(_ host: any TurnstileHosting) {
        self.host = host
    }

    /// Cleared on dismantle; any pending acquisition fails as canceled.
    func detach() {
        host = nil
        resolvePending(.failure(TurnstileError.canceled))
        isChallengeVisible = false
    }

    /// The single ingest for every script event (the Coordinator forwards each message
    /// here). Token and error resolve a pending acquisition; the challenge events only
    /// flip the reveal flag.
    func handle(event: TurnstilePage.Event, token: String?) {
        switch event {
        case .token:
            if let token, !token.isEmpty {
                resolvePending(.success(token))
            } else {
                resolvePending(.failure(TurnstileError.widgetError))
            }
            isChallengeVisible = false
        case .error:
            resolvePending(.failure(TurnstileError.widgetError))
            isChallengeVisible = false
        case .challengeOpen:
            isChallengeVisible = true
        case .challengeClose:
            isChallengeVisible = false
        }
    }

    /// Resume the pending continuation exactly once, then clear it.
    private func resolvePending(_ result: Result<String, Error>) {
        guard let continuation = pending else { return }
        pending = nil
        continuation.resume(with: result)
    }
}

/// The control surface the provider drives on the live web view (execute a fresh
/// challenge). The Coordinator implements it over the WKWebView; the provider holds it
/// weakly so a dismissed sheet drops the web view.
@MainActor
protocol TurnstileHosting: AnyObject {
    func execute()
}

// MARK: - The web view

// The WKWebView leg is UIKit (WKWebView.scrollView / .isOpaque / .backgroundColor are
// UIKit-only, and UIViewRepresentable is iOS). The app target ships iOS, but this guard
// keeps the file honest on any non-UIKit destination: the provider stays available (it
// holds no UIKit) and just never mints a token there.
#if canImport(UIKit)

/// The hidden WKWebView that runs the widget. Invisible by default (the page renders
/// nothing with `interaction-only`, and this stays a zero-size clear surface); the sheet
/// reveals it only when `provider.isChallengeVisible` flips, sizing it for the challenge.
/// The Coordinator is the message handler and the host: it posts events into the
/// provider and executes fresh challenges on demand.
struct TurnstileWebView: UIViewRepresentable {
    let provider: TurnstileProvider

    func makeCoordinator() -> Coordinator {
        Coordinator(provider: provider)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: TurnstilePage.messageHandlerName)
        configuration.userContentController = controller
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        context.coordinator.webView = webView
        provider.attach(context.coordinator)

        // Load under an allowed hostname so Turnstile accepts the origin (NEVER nil).
        if let siteKey = provider.siteKey, !siteKey.isEmpty {
            webView.loadHTMLString(
                TurnstilePage.html(siteKey: siteKey), baseURL: TurnstilePage.baseURL)
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: TurnstilePage.messageHandlerName)
        coordinator.provider.detach()
    }

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler, TurnstileHosting {
        let provider: TurnstileProvider
        weak var webView: WKWebView?

        init(provider: TurnstileProvider) {
            self.provider = provider
        }

        // TurnstileHosting: run a fresh challenge in the live web view.
        func execute() {
            webView?.evaluateJavaScript(TurnstilePage.executeScript)
        }

        // WKScriptMessageHandler: every widget event arrives here as a small JSON
        // object; forward it to the provider, which resolves the pending token() and
        // flips the reveal flag.
        nonisolated func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            // The body is a JS object literal; read the event and optional token off it.
            let body = message.body as? [String: Any]
            let rawEvent = body?["event"] as? String
            let token = body?["token"] as? String
            MainActor.assumeIsolated {
                guard let rawEvent, let event = TurnstilePage.Event(rawValue: rawEvent)
                else { return }
                provider.handle(event: event, token: token)
            }
        }
    }
}

/// The captcha's place in the sheet: invisible by default (a 1pt clear surface offscreen
/// where the widget still runs its JS but shows nothing), revealed inline only when the
/// provider signals an interactive challenge. This SwiftUI view is the observation seam:
/// reading `provider.isChallengeVisible` in `body` tracks it, so the frame animates open
/// on a challenge and closed again when it clears. CrossyUI receives this type-erased, so
/// it never sees WebKit.
///
/// The web view is kept MOUNTED even when hidden (a near-zero frame, not removed from the
/// tree) so the running widget and its message handler survive across the invisible ->
/// revealed -> invisible cycle; tearing it down would drop the in-flight token() the send
/// is awaiting.
struct TurnstileCaptchaView: View {
    let provider: TurnstileProvider

    var body: some View {
        TurnstileWebView(provider: provider)
            // Revealed: a comfortable challenge area. Hidden: 1pt (not zero, so the web
            // view keeps laying out and running its script) and clipped away.
            .frame(height: provider.isChallengeVisible ? 320 : 1)
            .frame(maxWidth: .infinity)
            .opacity(provider.isChallengeVisible ? 1 : 0)
            .allowsHitTesting(provider.isChallengeVisible)
            .accessibilityHidden(!provider.isChallengeVisible)
            .clipped()
            .animation(.easeInOut(duration: 0.2), value: provider.isChallengeVisible)
    }
}

#endif  // canImport(UIKit)
