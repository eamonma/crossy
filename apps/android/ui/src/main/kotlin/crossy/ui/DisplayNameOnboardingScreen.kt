// The display-name onboarding gate (docs/design/name-onboarding §7, §9), the Android twin of iOS
// DisplayNameOnboardingSheet's states. It fires when GET /me reports needsName on entering the
// signed-in shell and stands between sign-in and Rooms: required, but never a dead end. A pure
// function of the passed state (the composition root owns the DisplayNameOnboardingModel and the
// /me write); the screen renders the field, the live validation gate, the inline error keyed on the
// server code, and the saving state, and emits the draft edits and the submit intent back.
//
// There is no dismiss affordance while nameless (the goal is always a name), but Continue is
// tappable whenever the draft is valid and stays tappable after a failure, so onboarding never
// walls the app and never signs out (INV-11). INV-1 does not apply here: the field shows the name
// back verbatim, never folded.

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
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun DisplayNameOnboardingScreen(
    draft: String,
    onDraftChange: (String) -> Unit,
    canSubmit: Boolean,
    isSaving: Boolean,
    // The resolved inline error (from displayNameErrorCopy), or null when there is nothing to show.
    errorMessage: String?,
    onSubmit: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Choose a display name", fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Text(
            "This is how you'll show up to everyone in a room. You can change it later in Settings.",
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        OutlinedTextField(
            value = draft,
            onValueChange = onDraftChange,
            label = { Text("Display name") },
            singleLine = true,
            isError = errorMessage != null,
            enabled = !isSaving,
            modifier = Modifier.fillMaxWidth(),
        )
        if (errorMessage != null) {
            Text(errorMessage, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
        }

        Button(
            onClick = onSubmit,
            enabled = canSubmit,
            modifier = Modifier.fillMaxWidth(),
        ) { Text(if (isSaving) "Saving..." else "Continue") }
    }
}

/** The account/nickname block shared by Settings (below) with the onboarding field grammar: a
 *  labelled name field, an inline error, and a save action. Kept small and stateless so both
 *  surfaces render the same editor. */
@Composable
internal fun DisplayNameEditor(
    draft: String,
    onDraftChange: (String) -> Unit,
    canSave: Boolean,
    isSaving: Boolean,
    errorMessage: String?,
    saved: Boolean,
    onSave: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = draft,
            onValueChange = onDraftChange,
            label = { Text("Display name") },
            singleLine = true,
            isError = errorMessage != null,
            enabled = !isSaving,
            modifier = Modifier.fillMaxWidth(),
        )
        if (errorMessage != null) {
            Text(errorMessage, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
        } else if (saved) {
            Text("Saved", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
        }
        Button(onClick = onSave, enabled = canSave, modifier = Modifier.align(Alignment.End)) {
            Text(if (isSaving) "Saving..." else "Save")
        }
    }
}
