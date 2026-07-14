// A one-emoji text field whose input surface is the system EMOJI keyboard (Wave 8.5:
// the Settings slot editor's free-entry lane). SwiftUI's keyboardType has no emoji
// case; UIKit's `textInputMode` override is the one supported hook, so this small
// representable carries it and nothing else. The field asks for the emoji input mode;
// when the device has none enabled (a hardware-keyboard iPad, a stripped keyboard
// list) it degrades to the standard keyboard, and the caller's validator gate
// (ReactionSetSpec) still decides what lands, so the field never has to.
//
// iOS-only by nature: the macOS test host renders the caller's plain-TextField
// fallback instead (SettingsScreen gates on os(iOS)), so this file compiles away
// cleanly wherever UIKit is absent.

#if canImport(UIKit)
    import SwiftUI
    import UIKit

    /// The UITextField that requests the emoji input mode. `textInputContextIdentifier`
    /// must be non-nil for the system to honor a per-field mode at all; the mode lookup
    /// finds the emoji keyboard among the active input modes.
    private final class EmojiUITextField: UITextField {
        override var textInputContextIdentifier: String? { "crossy.reactions.slot" }

        override var textInputMode: UITextInputMode? {
            UITextInputMode.activeInputModes.first { $0.primaryLanguage == "emoji" }
                ?? super.textInputMode
        }
    }

    @available(iOS 17.0, *)
    public struct EmojiKeyboardField: UIViewRepresentable {
        @Binding private var text: String
        private let placeholder: String

        public init(text: Binding<String>, placeholder: String) {
            self._text = text
            self.placeholder = placeholder
        }

        public func makeUIView(context: Context) -> UITextField {
            let field = EmojiUITextField()
            field.placeholder = placeholder
            field.font = .systemFont(ofSize: 22)
            field.autocorrectionType = .no
            field.spellCheckingType = .no
            field.returnKeyType = .done
            field.delegate = context.coordinator
            field.addTarget(
                context.coordinator, action: #selector(Coordinator.editingChanged(_:)),
                for: .editingChanged)
            // The field lives inside a settings row: never stretch the row.
            field.setContentHuggingPriority(.defaultLow, for: .horizontal)
            field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
            return field
        }

        public func updateUIView(_ field: UITextField, context: Context) {
            // Push the binding's value only on a real difference, so the caller's
            // validator rewrites (trim to the newest grapheme) land without fighting
            // the keyboard's own echo.
            if field.text != text {
                field.text = text
            }
        }

        public func makeCoordinator() -> Coordinator {
            Coordinator(text: $text)
        }

        public final class Coordinator: NSObject, UITextFieldDelegate {
            private let text: Binding<String>

            init(text: Binding<String>) {
                self.text = text
            }

            @objc func editingChanged(_ field: UITextField) {
                text.wrappedValue = field.text ?? ""
            }

            public func textFieldShouldReturn(_ field: UITextField) -> Bool {
                field.resignFirstResponder()
                return true
            }
        }
    }
#endif
