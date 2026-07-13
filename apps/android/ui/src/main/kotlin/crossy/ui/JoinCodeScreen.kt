// Join by invite code (iOS JoinCodeScreen, Wave A4 functional bar): one code field and a join
// intent. The code is sent verbatim; the server owns normalization (INV-1), so nothing here folds
// it. QR scan and the short-link path are later tracks. A pure function of the field plus busy/error
// state; the composition root runs the join call.

package crossy.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun JoinCodeScreen(
    isBusy: Boolean,
    error: String?,
    onJoin: (String) -> Unit,
    onBack: () -> Unit,
) {
    var code by remember { mutableStateOf("") }
    Column(
        modifier = Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Join a room", fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Text("Enter the invite code a host shared with you.", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(
            value = code,
            onValueChange = { code = it },
            label = { Text("Invite code") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        if (error != null) Text(error, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
        Button(
            onClick = { onJoin(code) },
            enabled = !isBusy && code.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) { Text(if (isBusy) "Joining..." else "Join") }
        TextButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Back") }
    }
}
