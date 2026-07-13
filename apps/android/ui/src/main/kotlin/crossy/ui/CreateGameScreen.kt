// Create a game (iOS PuzzlesScreen + create flow, Wave A4 functional bar): choose a puzzle the
// caller uploaded and name the room. When the puzzle list is unavailable (offline, or the ingestion
// track has not landed) the caller can paste a puzzleId directly, so the create path is exercisable
// without a running stack. A pure function of the field state plus the loaded puzzle list; the
// composition root runs the create call.

package crossy.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.foundation.clickable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import crossy.protocol.PuzzleSummary

@Composable
fun CreateGameScreen(
    puzzles: List<PuzzleSummary>,
    isBusy: Boolean,
    error: String?,
    onCreate: (puzzleId: String, name: String?) -> Unit,
    onBack: () -> Unit,
) {
    var puzzleId by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    Column(
        modifier = Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("New room", fontSize = 24.sp, fontWeight = FontWeight.Bold)
        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            label = { Text("Room name (optional)") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = puzzleId,
            onValueChange = { puzzleId = it },
            label = { Text("Puzzle id") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        if (puzzles.isNotEmpty()) {
            Text("Your puzzles", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
            LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(puzzles, key = { it.puzzleId }) { p ->
                    Card(modifier = Modifier.fillMaxWidth().clickable { puzzleId = p.puzzleId }) {
                        Column(Modifier.padding(12.dp)) {
                            Text(p.title?.takeIf { it.isNotBlank() } ?: p.puzzleId, fontWeight = FontWeight.Medium, fontSize = 15.sp)
                            Text("${p.rows}x${p.cols}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
        if (error != null) Text(error, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
        Button(
            onClick = { onCreate(puzzleId, name.ifBlank { null }) },
            enabled = !isBusy && puzzleId.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) { Text(if (isBusy) "Creating..." else "Create room") }
        TextButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Back") }
    }
}
