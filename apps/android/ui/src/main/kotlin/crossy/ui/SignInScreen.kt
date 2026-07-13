// Sign in (AAD-3: email/password plus the dev-token fallback). The email path is the Supabase
// password grant; the dev-token field is the twin of iOS FixedTokenProvider and the web `?token=`
// override, for driving the app against the local stack before native providers land (AAD-3: Google
// Sign-In is its own owner-gated track). A pure function of the fields plus busy/error state; the
// composition root runs the grant and swaps the bearer provider on the dev-token path.

package crossy.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun SignInScreen(
    isBusy: Boolean,
    error: String?,
    onSignIn: (email: String, password: String) -> Unit,
    onDevToken: (String) -> Unit,
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var devToken by remember { mutableStateOf("") }
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Crossy", fontSize = 30.sp, fontWeight = FontWeight.Bold)
        Text("Sign in to solve together.", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)

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

        HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))

        Text("Developer", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
}
