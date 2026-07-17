// The Settings surface (roadmap I3: thin v1, iOS SettingsScreen's shape). Who is signed in (the
// identity card: the roster puck, the name with its inline editor, the provider line), the per-device
// Solving preferences, the personal reaction set, sign out, and a destructive delete behind a two-beat
// confirm. A quiet legal pair and a version footer close the screen, exactly as iOS closes it.
//
// A pure function of the passed state and closures (AD-2: the screen sees plain data, never
// CrossyAPI or the auth machine). The composition root owns the /me load, the write paths behind the
// editors, sign-out, the delete calls, the avatar cache the puck reads, and the platform acts the
// legal row reports (the Custom Tab). The delete confirmation is a Material3 AlertDialog (the twin of
// iOS's confirmationDialog); a failed delete renders inline on this surface, never silent, and stays
// retryable (the arrival error voice).

package crossy.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/** The per-device solving preferences the card renders, plain :ui data mapped by the composition root
 *  from the persisted NavigationSettingsStore. Null (a harness composition) renders no Solving
 *  section. */
data class SolvingPrefs(
    val skipFilledInWord: Boolean,
    val endOfWordIsNextClue: Boolean,
)

/** The result of the injected delete call: success (the parent navigates to sign-in), or a failure
 *  carrying the stable §12 code the inline sentence keys on (null is network weather). The twin of
 *  iOS's `ArrivalFailure?` return. */
sealed interface DeleteAccountResult {
    data object Success : DeleteAccountResult
    data class Failure(val code: String?) : DeleteAccountResult
}

/** One human sentence per delete failure, keyed on the stable §12 code. A thin alias now: the
 *  sentences live on [ArrivalCopy.deleteFailure] (the sentence-for-sentence iOS port), so this name
 *  only stands for the callers that already read it. A null code is network weather; the raw code
 *  never renders. */
fun deleteAccountErrorCopy(code: String?): String = ArrivalCopy.deleteFailure(code)

@Composable
fun SettingsScreen(
    userId: String,
    isAnonymous: Boolean,
    // The current /me display name, or null for an account that has not chosen one yet.
    currentName: String?,
    // The provider line beneath the name (Discord, Apple, ...), or null when none is remembered.
    providerLabel: String?,
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
    // The resolved self avatar, or null for the colored initial (the composition root reads the
    // AvatarImageCache; a null or unresolved url is the initial, PROTOCOL.md §4).
    avatar: ImageBitmap? = null,
    // The per-device solving prefs and their writers (personal-settings slice 1). Null renders no
    // Solving section (a harness); the writers persist through the composition root's store, live.
    solving: SolvingPrefs? = null,
    onSkipFilledChange: (Boolean) -> Unit = {},
    onEndOfWordNextClueChange: (Boolean) -> Unit = {},
    // The two-beat destructive delete, or null when the composition supplies none (the harness): the
    // Delete row then does not render. Returns the typed outcome the inline sentence keys on.
    onDeleteAccount: (suspend () -> DeleteAccountResult)? = null,
    // Open a legal page in a Custom Tab (the composition root owns the browser leg, AAD-2).
    onOpenLegal: (LegalPage) -> Unit = {},
    // The quiet version footer ("0.1.0 (1)"), or null where the build carries none.
    versionLabel: String? = null,
    // The personal reaction set editor (Wave 8.5; D25), or null when the composition supplies none
    // (a pre-8.5 host): the Reactions section then does not render at all.
    reactions: ReactionSetEditorModel? = null,
) {
    val ground = if (isSystemInDarkTheme()) GridGround.OBSERVATORY else GridGround.STUDIO
    val scope = rememberCoroutineScope()
    // The delete confirm/in-flight/failure trio, this surface's own state (iOS @State): the dialog is
    // the real gate, a running delete shows inline, a failure renders and stays retryable.
    var confirmingDelete by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var deleteFailure by remember { mutableStateOf<String?>(null) }
    var deleteFailed by remember { mutableStateOf(false) }

    Scaffold { inner ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(inner)
                .padding(horizontal = 16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(ArrivalCopy.settingsTitle, fontSize = 26.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                TextButton(onClick = onBack) { Text("Done") }
            }

            // The identity card: the roster puck (the room's vocabulary, avatar layered when it has
            // resolved), the name (an em dash placeholder while /me is still null), and the provider
            // line beneath. The name shown is the app-DB /me value, the single source any UI renders.
            Row(verticalAlignment = Alignment.CenterVertically) {
                RosterPuck(
                    userId = userId,
                    displayName = currentName ?: "",
                    ground = ground,
                    diameter = 52.dp,
                    avatar = avatar,
                )
                Column(
                    modifier = Modifier.padding(start = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Text(currentName ?: "Signed in", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                    val subtitle = providerLabel ?: if (isAnonymous) "Guest" else "Signed in"
                    Text(subtitle, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
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

            if (solving != null) {
                HorizontalDivider()
                SolvingSection(
                    prefs = solving,
                    onSkipFilledChange = onSkipFilledChange,
                    onEndOfWordNextClueChange = onEndOfWordNextClueChange,
                )
            }

            if (reactions != null) {
                HorizontalDivider()
                ReactionSetSection(model = reactions)
            }

            HorizontalDivider()

            OutlinedButton(onClick = onSignOut, enabled = !deleting, modifier = Modifier.fillMaxWidth()) { Text(ArrivalCopy.signOutAction) }

            if (onDeleteAccount != null) {
                // The destructive action carries the error tone on its label; the confirmation is the
                // real gate (iOS: chrome stays achromatic, this is the label's color).
                OutlinedButton(
                    onClick = { confirmingDelete = true },
                    enabled = !deleting,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (deleting) {
                        CircularProgressIndicator(modifier = Modifier.padding(end = 8.dp))
                    }
                    Text(ArrivalCopy.deleteAccountAction, color = MaterialTheme.colorScheme.error)
                }
                if (deleteFailed) {
                    Text(
                        deleteAccountErrorCopy(deleteFailure),
                        color = MaterialTheme.colorScheme.error,
                        fontSize = 13.sp,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            // The quiet legal pair, standing apart from the actions so it never reads as another
            // account intent (iOS legalRow). Buttons, not links: :app opens the in-app Custom Tab.
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                LegalLink(ArrivalCopy.privacyPolicy, LegalPage.PRIVACY, onOpenLegal)
                Text(" · ", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                LegalLink(ArrivalCopy.termsOfService, LegalPage.TERMS, onOpenLegal)
            }

            if (versionLabel != null) {
                Text(
                    versionLabel,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
            }
        }
    }

    // The two-beat confirmation: a system dialog with the consequence stated plainly (roadmap I3),
    // the Material3 twin of iOS's confirmationDialog. The destructive button runs the delete; the
    // dialog owns its own dismissal.
    if (confirmingDelete && onDeleteAccount != null) {
        AlertDialog(
            onDismissRequest = { confirmingDelete = false },
            title = { Text(ArrivalCopy.deleteAccountConfirmTitle) },
            text = { Text(ArrivalCopy.deleteAccountConfirmBody) },
            confirmButton = {
                TextButton(onClick = {
                    confirmingDelete = false
                    deleteFailed = false
                    deleteFailure = null
                    deleting = true
                    scope.launch {
                        // Success is the parent's navigation to sign-in (its closure purges the local
                        // tokens); a failure renders inline and stays retryable.
                        when (val result = onDeleteAccount()) {
                            is DeleteAccountResult.Failure -> {
                                deleteFailure = result.code
                                deleteFailed = true
                            }
                            DeleteAccountResult.Success -> Unit
                        }
                        deleting = false
                    }
                }) {
                    Text(ArrivalCopy.deleteAccountConfirmAction, color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmingDelete = false }) { Text(ArrivalCopy.deleteAccountCancelAction) }
            },
        )
    }
}

/** The Solving preferences card (personal-settings slice 1): the skip-filled toggle and the
 *  end-of-word picker, one grammar (a label and its one-line subtitle on the left, a native control
 *  on the right), divided by a hairline. Both write straight to the composition root's store, so the
 *  room's cursor follows the change the next time it composes. Twin of iOS solvingCard. */
@Composable
private fun SolvingSection(
    prefs: SolvingPrefs,
    onSkipFilledChange: (Boolean) -> Unit,
    onEndOfWordNextClueChange: (Boolean) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Solving", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
        SettingRow(title = "Skip filled squares", subtitle = "While typing within a word") {
            Switch(checked = prefs.skipFilledInWord, onCheckedChange = onSkipFilledChange)
        }
        HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))
        SettingRow(title = "At the end of a word", subtitle = "Once the word is full") {
            EndOfWordPicker(
                isNextClue = prefs.endOfWordIsNextClue,
                onChange = onEndOfWordNextClueChange,
            )
        }
    }
}

/** One preference row: title over subtitle on the left, the native control trailing. */
@Composable
private fun SettingRow(title: String, subtitle: String, control: @Composable () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, fontSize = 16.sp)
            Text(subtitle, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        control()
    }
}

/** The end-of-word picker: a compact menu whose collapsed value is the short label the copy pins
 *  ("Next clue" / "First blank"), the Android twin of iOS's menu picker. */
@Composable
private fun EndOfWordPicker(isNextClue: Boolean, onChange: (Boolean) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        TextButton(onClick = { expanded = true }) {
            Text(if (isNextClue) "Next clue" else "First blank")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(
                text = { Text("Next clue") },
                onClick = { onChange(true); expanded = false },
            )
            DropdownMenuItem(
                text = { Text("First blank") },
                onClick = { onChange(false); expanded = false },
            )
        }
    }
}

@Composable
private fun LegalLink(label: String, page: LegalPage, onOpenLegal: (LegalPage) -> Unit) {
    TextButton(onClick = { onOpenLegal(page) }) {
        Text(label, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
