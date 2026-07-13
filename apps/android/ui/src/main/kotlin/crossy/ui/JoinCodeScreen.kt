// Join by invite code (iOS JoinCodeScreen, Wave A4 functional bar): one code field and a join
// intent. The field digests through InviteScan the same way iOS's scan ingest does, so a pasted
// short link (`crossy.ing/{CODE}`), an old `?code=` link, or the `/g/{code}` unfurl resolves to the
// bare code inline; a partial code being typed folds through InviteCode (bytewise ASCII, INV-1). The
// server still owns lookup normalization. QR scan is a later track. A pure function of the field plus
// busy/error state; the composition root runs the join call.

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
            // A pasted link digests to its code inline (InviteScan); a partial code sanitizes as
            // typed (InviteCode). Both keep the field to the read-aloud alphabet, INV-1.
            onValueChange = { raw -> code = InviteScan.parse(raw) ?: InviteCode.sanitize(raw) },
            label = { Text("Invite code or link") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        if (error != null) Text(error, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
        Button(
            onClick = { onJoin(code) },
            enabled = !isBusy && InviteCode.isComplete(code),
            modifier = Modifier.fillMaxWidth(),
        ) { Text(if (isBusy) "Joining..." else "Join") }
        TextButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Back") }
    }
}
