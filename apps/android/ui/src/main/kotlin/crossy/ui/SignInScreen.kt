// Sign in, providers first (the iOS WelcomeScreen shape): Apple then Discord as the two primary
// buttons (Apple leads, per Apple's guideline 4.8; web AuthBar agrees), and a quiet "Continue
// another way" affordance revealing Hisbaan and the email one-time code (mirrors #230). There are
// no passwords in production, so no password form. The screen knows nothing of browsers or
// intents: a provider tap is an intent the host maps to the Custom Tab leg (AAD-2: browser
// concerns live in :app). A pure function of the passed state: the composition root runs the
// network and owns the busy/error and which OTP step is showing; the screen renders it and emits
// intents back.

package crossy.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * The OAuth providers the screen offers, :ui's own vocabulary (the module imports :store and
 * :design only, so :api's AuthProvider never reaches here; the host maps this one-to-one). Email
 * OTP is not an entry: it rides its own [EmailOtpStep] sub-flow, no browser leg.
 */
enum class SignInProvider {
    /** Leads the stack (Apple's guideline 4.8: at least as prominent as any third-party entry). */
    APPLE,
    DISCORD,

    /** The custom OIDC provider, behind "Continue another way" with email (the iOS sheet's rows). */
    HISBAAN,
}

/** The provider buttons' copy, iOS ArrivalCopy verbatim. Internal so a test can pin it. */
internal fun signInProviderLabel(provider: SignInProvider): String = when (provider) {
    SignInProvider.APPLE -> "Continue with Apple"
    SignInProvider.DISCORD -> "Continue with Discord"
    SignInProvider.HISBAAN -> "Continue with Hisbaan"
}

/**
 * The email one-time-code sub-flow's screen state (AAD-3, mirrors #230). The host owns which step
 * shows and the busy/error for each; the screen renders it. `Closed` keeps the OTP path behind the
 * "Continue another way" affordance so the providers stay primary. `Email` collects the address.
 * `Code` collects the code for the address it was sent to, carrying that address for the
 * "we sent a code to {email}" line and the resend.
 */
sealed interface EmailOtpStep {
    data object Closed : EmailOtpStep
    data class Email(val error: String?) : EmailOtpStep
    data class Code(val email: String, val error: String?) : EmailOtpStep
}

/** The one-time code length the server issues, read by the field cap and the Verify gate so the two
 *  can never drift. Eight: the captcha-on production project issues 8-digit codes (#230 raised
 *  iOS/web to eight when the Turnstile captcha landed, EMAIL_OTP_CODE_LENGTH there), and this Android
 *  track now mints that captcha, so it follows the same server OTP length. A stale 6 would reject
 *  every valid code and mislead the "8-digit code" copy. `internal`, not private, so the field-cap
 *  and Verify-gate helpers below are exercised by EmailOtpGateTests without a Compose host. */
internal const val EMAIL_OTP_CODE_LENGTH = 8

/** Keep digits only and cap at the code length: the raw field input filtered to what the OTP field
 *  accepts. Pure so the same rule the field cap enforces is unit-testable. */
internal fun sanitizeOtpCode(raw: String): String =
    raw.filter(Char::isDigit).take(EMAIL_OTP_CODE_LENGTH)

/** The Verify gate: the code is complete at exactly the OTP length. Pure so the button's enable rule
 *  is testable, not reimplemented, by the tests. */
internal fun isOtpCodeComplete(code: String): Boolean = code.length == EMAIL_OTP_CODE_LENGTH

/** Seconds the resend stays disabled after a send, so a user cannot outrun GoTrue's send limiter. */
private const val RESEND_COOLDOWN_SECONDS = 45

@Composable
fun SignInScreen(
    // Which provider's browser trip is out (busy shows on that button alone; all providers
    // disable). Null when nothing is in flight; the host clears it when the person returns
    // without completing, so a re-tap is always reachable (begin is effect-free and supersedes).
    busyProvider: SignInProvider?,
    error: String?,
    onProvider: (SignInProvider) -> Unit,
    otpStep: EmailOtpStep = EmailOtpStep.Closed,
    otpBusy: Boolean = false,
    // Closed -> Email, and Code -> Email ("use a different email"): both land on a fresh address step.
    onEmailStep: () -> Unit = {},
    // Email -> Closed: back out of the OTP path to the providers.
    onCancelOtp: () -> Unit = {},
    onSendCode: (email: String) -> Unit = {},
    onResendCode: () -> Unit = {},
    onVerifyCode: (code: String) -> Unit = {},
    // Open a legal page in a Custom Tab (the composition root owns the browser leg, AAD-2). The quiet
    // privacy/terms footer at the screen's foot (iOS WelcomeScreen legalFooter, App Review 5.1.1).
    onOpenLegal: (LegalPage) -> Unit = {},
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        // Explicit onSurface: this screen draws on the window ground with no wrapping Surface, so
        // LocalContentColor would stay default black and vanish on the Observatory ground.
        Text("Crossy", fontSize = 30.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
        Text(
            "Sign in to solve together.",
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        when (val step = otpStep) {
            EmailOtpStep.Closed -> Providers(
                busyProvider = busyProvider,
                error = error,
                onProvider = onProvider,
                onContinueWithEmail = onEmailStep,
            )

            is EmailOtpStep.Email -> EmailEntry(
                isBusy = otpBusy,
                error = step.error,
                onSend = onSendCode,
                onBack = onCancelOtp,
            )

            is EmailOtpStep.Code -> CodeEntry(
                email = step.email,
                isBusy = otpBusy,
                error = step.error,
                onVerify = onVerifyCode,
                onResend = onResendCode,
                onUseDifferentEmail = onEmailStep,
            )
        }

        Spacer(Modifier.weight(1f))
        LegalFooter(onOpenLegal)
    }
}

/** The quiet legal footer standing at the screen's foot: privacy and terms, each opening its live
 *  page in a Custom Tab (App Review 5.1.1: sign-in surfaces name the policy). Twin of iOS
 *  WelcomeScreen.legalFooter. */
@Composable
private fun LegalFooter(onOpenLegal: (LegalPage) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextButton(onClick = { onOpenLegal(LegalPage.PRIVACY) }) {
            Text("Privacy", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(" · ", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick = { onOpenLegal(LegalPage.TERMS) }) {
            Text("Terms", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** Providers lead: Apple then Discord as the primary buttons, then the quiet "Continue another
 *  way" affordance revealing Hisbaan and the email one-time code. The inline error sits above the
 *  buttons (the iOS footer's read): calm, one sentence. */
@Composable
private fun Providers(
    busyProvider: SignInProvider?,
    error: String?,
    onProvider: (SignInProvider) -> Unit,
    onContinueWithEmail: () -> Unit,
) {
    var anotherWay by remember { mutableStateOf(false) }
    val busy = busyProvider != null

    if (error != null) Text(error, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
    ProviderButton(SignInProvider.APPLE, busyProvider, onProvider)
    ProviderButton(SignInProvider.DISCORD, busyProvider, onProvider)

    // The quiet tertiary affordance (the iOS sheet's stand-in): Hisbaan and the email one-time
    // code stay one tap behind the two primary buttons, revealed in place.
    if (!anotherWay) {
        TextButton(
            onClick = { anotherWay = true },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Continue another way") }
    } else {
        OutlinedButton(
            onClick = { onProvider(SignInProvider.HISBAAN) },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                if (busyProvider == SignInProvider.HISBAAN) "Signing in..."
                else signInProviderLabel(SignInProvider.HISBAAN),
            )
        }
        // A code to your inbox, no password to remember (mirrors #230).
        OutlinedButton(
            onClick = onContinueWithEmail,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Continue with email") }
    }
}

/** One primary provider button. The busy label shows on the tapped provider alone; every provider
 *  disables while a browser trip is out (the host clears the busy state when the person returns
 *  without completing, so the buttons come back). */
@Composable
private fun ProviderButton(
    provider: SignInProvider,
    busyProvider: SignInProvider?,
    onProvider: (SignInProvider) -> Unit,
) {
    Button(
        onClick = { onProvider(provider) },
        enabled = busyProvider == null,
        modifier = Modifier.fillMaxWidth(),
    ) { Text(if (busyProvider == provider) "Signing in..." else signInProviderLabel(provider)) }
}

/** Step one: the address. The send goes out on the button; the host advances to code entry when it
 *  lands, or returns here with the send-failed copy. */
@Composable
private fun EmailEntry(
    isBusy: Boolean,
    error: String?,
    onSend: (email: String) -> Unit,
    onBack: () -> Unit,
) {
    var email by remember { mutableStateOf("") }

    Text("Continue with email", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
    OutlinedTextField(
        value = email,
        onValueChange = { email = it },
        label = { Text("Email") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
        modifier = Modifier.fillMaxWidth(),
    )
    Text(
        "We'll email you a $EMAIL_OTP_CODE_LENGTH-digit code to sign in.",
        fontSize = 13.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    if (error != null) Text(error, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
    Button(
        onClick = { onSend(email.trim()) },
        // The provider is the real validator; this only stops an obviously empty submit.
        enabled = !isBusy && email.isNotBlank() && email.contains("@"),
        modifier = Modifier.fillMaxWidth(),
    ) { Text(if (isBusy) "Sending..." else "Send code") }
    TextButton(onClick = onBack, enabled = !isBusy, modifier = Modifier.fillMaxWidth()) {
        Text("Back")
    }
}

/** Step two: the code for the address it went to, with a resend on a cooldown and a calm inline
 *  error. Verify stays disabled until the code is complete and while a verify is in flight (the
 *  AuthSession re-entrancy contract already no-ops a double call; this keeps the button honest). */
@Composable
private fun CodeEntry(
    email: String,
    isBusy: Boolean,
    error: String?,
    onVerify: (code: String) -> Unit,
    onResend: () -> Unit,
    onUseDifferentEmail: () -> Unit,
) {
    var code by remember(email) { mutableStateOf("") }
    // The cooldown counts down from a fresh code (keyed on the address) and again on each resend
    // (the nonce restarts the effect), so the resend cannot outrun GoTrue's send limiter.
    var resendNonce by remember(email) { mutableStateOf(0) }
    var secondsLeft by remember(email) { mutableStateOf(RESEND_COOLDOWN_SECONDS) }
    LaunchedEffect(email, resendNonce) {
        secondsLeft = RESEND_COOLDOWN_SECONDS
        while (secondsLeft > 0) {
            delay(1_000)
            secondsLeft -= 1
        }
    }

    Text("Enter the code", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
    Text(
        "We sent a code to $email. Enter it to sign in.",
        fontSize = 13.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    OutlinedTextField(
        value = code,
        // Digits only, capped at the code length, so the Verify gate is a plain length check.
        onValueChange = { code = sanitizeOtpCode(it) },
        label = { Text("Code") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        // Tabular figures so the fixed-length code does not shuffle width as digits land
        // (TypeScale.numericChromeRequiresTabularNumerals; apps/ios/DESIGN.md §6, invite codes).
        textStyle = LocalTextStyle.current.withTabularNumerals(),
        modifier = Modifier.fillMaxWidth(),
    )
    if (error != null) Text(error, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
    Button(
        onClick = { onVerify(code) },
        enabled = !isBusy && isOtpCodeComplete(code),
        modifier = Modifier.fillMaxWidth(),
    ) { Text(if (isBusy) "Verifying..." else "Verify") }
    TextButton(
        onClick = {
            resendNonce += 1
            onResend()
        },
        enabled = !isBusy && secondsLeft == 0,
        modifier = Modifier.fillMaxWidth(),
    ) {
        // Tabular figures so the ticking countdown holds its width in the two-digit range
        // (TypeScale.numericChromeRequiresTabularNumerals; apps/ios/DESIGN.md §6).
        Text(
            if (secondsLeft > 0) "Resend code in ${secondsLeft}s" else "Resend code",
            style = LocalTextStyle.current.withTabularNumerals(),
        )
    }
    TextButton(
        onClick = onUseDifferentEmail,
        enabled = !isBusy,
        modifier = Modifier.fillMaxWidth(),
    ) { Text("Use a different email") }
}
