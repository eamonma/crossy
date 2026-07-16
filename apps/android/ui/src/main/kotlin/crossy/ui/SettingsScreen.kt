// The minimal Settings surface (docs/design/name-onboarding §7.3; iOS puts the nickname editor in
// its Settings account card). Android had no Settings screen, so this is the smallest honest one:
// the account row, the inline nickname editor (the same DisplayNameEditor onboarding uses), and
// sign-out. Fuller Settings parity (the rest of iOS #197: avatar, account management, preferences)
// is a separate track, noted in PARITY.md. A pure function of the passed state; the composition
// root owns the /me load, the DisplayNameOnboardingModel behind the editor, and sign-out.

package crossy.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun SettingsScreen(
    userId: String,
    isAnonymous: Boolean,
    // The current /me display name, or null for an account that has not chosen one yet.
    currentName: String?,
    nickname: String,
    onNicknameChange: (String) -> Unit,
    canSave: Boolean,
    isSaving: Boolean,
    // The resolved inline error (from displayNameErrorCopy), or null.
    error: String?,
    saved: Boolean,
    onSave: () -> Unit,
    onSignOut: () -> Unit,
    onBack: () -> Unit,
    // The personal reaction set editor (Wave 8.5; D25), or null when the composition supplies none
    // (a pre-8.5 host): the Reactions section then does not render at all.
    reactions: ReactionSetEditorModel? = null,
) {
    Scaffold { inner ->
        Column(
            modifier = Modifier.fillMaxSize().padding(inner).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Settings", fontSize = 26.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                TextButton(onClick = onBack) { Text("Done") }
            }

            // Account row: who you are signed in as. The name shown is the app-DB /me value (the
            // single source any UI renders), an em dash placeholder while it is still null.
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Account", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(currentName ?: "No name yet", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    if (isAnonymous) "Guest - $userId" else userId,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            HorizontalDivider()

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Display name", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                DisplayNameEditor(
                    draft = nickname,
                    onDraftChange = onNicknameChange,
                    canSave = canSave,
                    isSaving = isSaving,
                    errorMessage = error,
                    saved = saved,
                    onSave = onSave,
                )
            }

            if (reactions != null) {
                HorizontalDivider()
                ReactionSetSection(model = reactions)
            }

            HorizontalDivider()

            OutlinedButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
        }
    }
}
