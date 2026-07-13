// Sign in (AAD-3: email/password and email one-time code, plus the dev-token fallback). The
// password path is the Supabase password grant; the OTP path (mirrors #230) sends a one-time code
// to an address, then verifies it into the same session the password grant lands. The dev-token
// field is the twin of iOS FixedTokenProvider and the web `?token=` override, for driving the app
// against the local stack before native providers land (Google Sign-In is its own owner-gated
// track). A pure function of the passed state: the composition root runs the network and owns the
// busy/error and which OTP step is showing; the screen renders it and emits intents back.

package crossy.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * The email one-time-code sub-flow's screen state (AAD-3, mirrors #230). The host owns which step
 * shows and the busy/error for each; the screen renders it. `Closed` keeps the OTP path behind a
 * quiet affordance so email/password and the dev token stay primary. `Email` collects the address.
 * `Code` collects the code for the address it was sent to, carrying that address for the
 * "we sent a code to {email}" line and the resend.
 */
sealed interface EmailOtpStep {
    data object Closed : EmailOtpStep
    data class Email(val error: String?) : EmailOtpStep
    data class Code(val email: String, val error: String?) : EmailOtpStep
}

/** The one-time code length the server issues, read by the field cap and the Verify gate so the two
 *  can never drift. Six on this track; #230's iOS/web ended at eight once the Turnstile captcha
 *  landed (a later Android track), so this is the one line that follows the server's OTP length. */
private const val EMAIL_OTP_CODE_LENGTH = 6

/** Seconds the resend stays disabled after a send, so a user cannot outrun GoTrue's send limiter. */
private const val RESEND_COOLDOWN_SECONDS = 45

@Composable
fun SignInScreen(
    isBusy: Boolean,
    error: String?,
    onSignIn: (email: String, password: String) -> Unit,
    onDevToken: (String) -> Unit,
    otpStep: EmailOtpStep = EmailOtpStep.Closed,
    otpBusy: Boolean = false,
    // Closed -> Email, and Code -> Email ("use a different email"): both land on a fresh address step.
    onEmailStep: () -> Unit = {},
    // Email -> Closed: back out of the OTP path to email/password.
    onCancelOtp: () -> Unit = {},
    onSendCode: (email: String) -> Unit = {},
    onResendCode: () -> Unit = {},
    onVerifyCode: (code: String) -> Unit = {},
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Crossy", fontSize = 30.sp, fontWeight = FontWeight.Bold)
        Text(
            "Sign in to solve together.",
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        when (val step = otpStep) {
            EmailOtpStep.Closed -> PasswordAndDevToken(
                isBusy = isBusy,
                error = error,
                onSignIn = onSignIn,
                onDevToken = onDevToken,
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
    }
}

/** The primary sign-in: email/password, then the dev-token fallback, with the quiet "continue with
 *  email" affordance under the Sign in button. */
@Composable
private fun PasswordAndDevToken(
    isBusy: Boolean,
    error: String?,
    onSignIn: (email: String, password: String) -> Unit,
    onDevToken: (String) -> Unit,
    onContinueWithEmail: () -> Unit,
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var devToken by remember { mutableStateOf("") }

    OutlinedTextField(
        value = email,
        onValueChange = { email = it },
        label = { Text("Email") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    OutlinedTextField(
        value = password,
        onValueChange = { password = it },
        label = { Text("Password") },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        modifier = Modifier.fillMaxWidth(),
    )
    if (error != null) Text(error, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
    Button(
        onClick = { onSignIn(email, password) },
        enabled = !isBusy && email.isNotBlank() && password.isNotBlank(),
        modifier = Modifier.fillMaxWidth(),
    ) { Text(if (isBusy) "Signing in..." else "Sign in") }

    // The quiet tertiary path (mirrors #230): a code to your inbox, no password to remember.
    TextButton(
        onClick = onContinueWithEmail,
        enabled = !isBusy,
        modifier = Modifier.fillMaxWidth(),
    ) { Text("Continue with email") }

    HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))

    Text(
        "Developer",
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    OutlinedTextField(
        value = devToken,
        onValueChange = { devToken = it },
        label = { Text("Dev bearer token") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    OutlinedButton(
        onClick = { onDevToken(devToken) },
        enabled = devToken.isNotBlank(),
        modifier = Modifier.fillMaxWidth(),
    ) { Text("Use dev token") }
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

    Text("Continue with email", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
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
        onValueChange = { code = it.filter(Char::isDigit).take(EMAIL_OTP_CODE_LENGTH) },
        label = { Text("Code") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        modifier = Modifier.fillMaxWidth(),
    )
    if (error != null) Text(error, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
    Button(
        onClick = { onVerify(code) },
        enabled = !isBusy && code.length == EMAIL_OTP_CODE_LENGTH,
        modifier = Modifier.fillMaxWidth(),
    ) { Text(if (isBusy) "Verifying..." else "Verify") }
    TextButton(
        onClick = {
            resendNonce += 1
            onResend()
        },
        enabled = !isBusy && secondsLeft == 0,
        modifier = Modifier.fillMaxWidth(),
    ) { Text(if (secondsLeft > 0) "Resend code in ${secondsLeft}s" else "Resend code") }
    TextButton(
        onClick = onUseDifferentEmail,
        enabled = !isBusy,
        modifier = Modifier.fillMaxWidth(),
    ) { Text("Use a different email") }
}
