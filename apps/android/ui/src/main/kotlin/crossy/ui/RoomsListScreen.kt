// The rooms list (iOS RoomsScreen, Wave A4 functional bar): the caller's games as PuzzleCards,
// with entry points to join by code, create a game, and open the scripted demo room. A pure
// function of the loaded list plus loading/error state; the composition root owns the data fetch
// and every intent. Recents refetch-on-route-change and the rich empty state are later tracks.

package crossy.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Button
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import crossy.protocol.GameSummary

@Composable
fun RoomsListScreen(
    games: List<GameSummary>,
    ground: GridGround,
    isLoading: Boolean,
    error: String?,
    onOpen: (GameSummary) -> Unit,
    onJoinByCode: () -> Unit,
    onCreate: () -> Unit,
    onOpenDemo: () -> Unit,
    onSignOut: () -> Unit,
) {
    Scaffold { inner ->
        Column(modifier = Modifier.fillMaxSize().padding(inner).padding(horizontal = 16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Rooms", fontSize = 26.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                TextButton(onClick = onSignOut) { Text("Sign out") }
            }
            Row(
                modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(onClick = onCreate, modifier = Modifier.weight(1f)) { Text("Create") }
                OutlinedButton(onClick = onJoinByCode, modifier = Modifier.weight(1f)) { Text("Join by code") }
            }
            OutlinedButton(onClick = onOpenDemo, modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                Text("Open demo room (scripted)")
            }

            if (error != null) {
                Text("Could not load games: $error", color = androidx.compose.material3.MaterialTheme.colorScheme.error, fontSize = 13.sp, modifier = Modifier.padding(bottom = 8.dp))
            }

            when {
                isLoading -> Column(modifier = Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
                    androidx.compose.foundation.layout.Spacer(Modifier.padding(24.dp))
                    CircularProgressIndicator()
                }
                games.isEmpty() -> Text(
                    "No games yet. Create one, join by code, or open the demo room.",
                    color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 14.sp,
                    modifier = Modifier.padding(vertical = 16.dp),
                )
                else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(games, key = { it.gameId }) { game ->
                        PuzzleCard(game, ground, onOpen = { onOpen(game) })
                    }
                }
            }
        }
    }
}
