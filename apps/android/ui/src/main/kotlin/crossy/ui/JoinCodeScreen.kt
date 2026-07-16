// Join a room (iOS JoinCodeScreen, EXPERIENCE.md §3): camera-first, code always standing. The
// viewport scans an invite QR — the projector's share link, the §12 unfurl link, or a bare code,
// all digested by InviteScan the same way the field's paste is — and a hit fills the field and
// submits, so the scan is legible as the same act as typing. Beneath it the one field keeps the
// read-aloud alphabet honest through InviteCode (uppercase as typed, alphabet-only, INV-1). DENIED
// is calm and never a dead end: one plain sentence, the field still standing beneath it.
//
// AD-2 (iOS): the camera and its permission live in the app target. This screen takes a verdict
// (JoinScanState) and a scanner slot, and renders the chrome: the viewport, the quiet denied
// sentence, the typed path. The scanner slot is a composable the composition root fills with the
// CameraX preview (JoinCameraScan in :app); in the NONE composition (no camera, previews) the
// screen is the one-field card exactly as before. A pure function of its inputs; the host owns the
// join call and the busy/error state.

package crossy.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** How scanning stands on this composition (iOS JoinScanState, AD-2: the camera and its permission
 *  are the app target's; the screen renders the verdict). */
enum class JoinScanState {
    /** No scanning here (previews, or a device with no camera path): the one-field card. */
    NONE,

    /** Permission resolving: the viewport holds its quiet dark ground. */
    PROBING,

    /** The injected scanner is live in the viewport. */
    LIVE,

    /** Camera refused or absent: one plain sentence, the field still beneath. */
    DENIED,
}

@Composable
fun JoinCodeScreen(
    isBusy: Boolean,
    error: String?,
    onJoin: (String) -> Unit,
    onBack: () -> Unit,
    scanState: JoinScanState = JoinScanState.NONE,
    // A code an invite deep link prefills (iOS deepLinkPrefill): the field opens carrying it so the
    // join is one tap away, no retype. Sanitized through the same alphabet as typing (INV-1); empty
    // for a hand-tapped Join, the camera-first blank field as before.
    initialCode: String = "",
    // The live camera view, built around this screen's ingest so a scanned payload takes exactly the
    // typed path. The composition root fills it with the CameraX preview; NONE never calls it.
    scanner: @Composable ((String) -> Unit) -> Unit = {},
) {
    var code by remember { mutableStateOf(InviteCode.sanitize(initialCode)) }
    // The last code a scan attempted: one attempt per scanned code, so a QR lingering in front of the
    // lens never hammers the join call with a retry loop (iOS scannedAttempt). A fresh code supersedes.
    var scannedAttempt by remember { mutableStateOf<String?>(null) }

    // A scanned payload takes the typed path exactly: digest through InviteScan, fill the field,
    // submit. One attempt per scanned code; a busy join swallows the scan (iOS ingest).
    fun ingest(payload: String) {
        if (isBusy) return
        val scanned = InviteScan.parse(payload) ?: return
        if (scanned == scannedAttempt) return
        scannedAttempt = scanned
        code = scanned
        // Haptic feedback on a locked scan is a later haptics track (iOS .sensoryFeedback on
        // scannedAttempt): the seam is here, deliberately unwired.
        onJoin(scanned)
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Join a room", fontSize = 24.sp, fontWeight = FontWeight.Bold)

        if (scanState != JoinScanState.NONE) {
            Viewport(scanState) { scanner(::ingest) }
            Text(
                "Or type the invite code a host shared with you.",
                fontSize = 14.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            Text(
                "Enter the invite code a host shared with you.",
                fontSize = 14.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

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

/** The camera window: a dark pane on either ground (a viewport reads as a window, not paper), the
 *  live scanner filling it edge to edge, or the one quiet denied sentence. The dark ground is
 *  Observatory's canvas in both grounds, mirroring iOS. */
@Composable
private fun Viewport(scanState: JoinScanState, scanner: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(280.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(GridGround.OBSERVATORY.tokens.canvas.toColor()),
        contentAlignment = Alignment.Center,
    ) {
        when (scanState) {
            JoinScanState.LIVE -> scanner()
            JoinScanState.DENIED -> Text(
                "Camera access is off. Type the code below to join, or turn the camera on in Settings.",
                fontSize = 14.sp,
                color = GridGround.OBSERVATORY.tokens.number.toColor(),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 32.dp),
            )
            JoinScanState.PROBING, JoinScanState.NONE -> Unit
        }
    }
}
