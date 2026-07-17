// The avatar image cache: one url-keyed, in-memory store that fetches a person's avatar once and
// hands the decoded image to every surface that shows them (twin of iOS AvatarImage.swift; DESIGN.md
// §3: the people are the color; PROTOCOL.md §4: the avatarUrl is opaque and nullable, and a null,
// loading, or failed url is the colored initial, the floor). This file owns only "url -> image": the
// puck composition (RosterPuck) is pure :ui and reads whatever image this hands it now.
//
// Hand-rolled over OkHttp rather than Coil, mirroring iOS's dependency-free posture (URLSession, no
// image library): the app already carries one OkHttpClient for the API, and a person's five surfaces
// share one small cache, so a library earns no weight here. A failed or non-image url caches a miss
// so it never retries in a loop; the initial stays the render for it. The slots map is Compose
// snapshot state, so a puck that read a url before the load landed re-renders the instant the image
// publishes, the same live behavior iOS gets from @Observable.

package crossy.app

import android.graphics.BitmapFactory
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

class AvatarImageCache(
    private val client: OkHttpClient,
    // The load coroutines' home. Main-immediate so the snapshot writes that publish an image land on
    // the same dispatcher Compose reads on; the network hop itself is shifted to IO below.
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
) {
    /** A resolved slot: the decoded image, or a known miss (a non-image body, a non-2xx, or a failed
     *  fetch). Absence from the map means not-yet-requested. */
    private sealed interface Slot {
        data class Img(val bitmap: ImageBitmap) : Slot
        data object Miss : Slot
    }

    private val slots = mutableStateMapOf<String, Slot>()
    private val inFlight = mutableSetOf<String>()

    /** The cached image for a url, or null while loading, on a miss, or before the first request.
     *  Reading this during composition registers snapshot observation, so the puck re-renders when a
     *  load publishes. */
    fun image(url: String): ImageBitmap? = (slots[url] as? Slot.Img)?.bitmap

    /** Begin a load if this url has no slot and none is in flight. Idempotent: a resolved url or one
     *  already fetching is a no-op, so calling from every render is safe. */
    fun load(url: String) {
        if (slots.containsKey(url) || url in inFlight) return
        inFlight.add(url)
        scope.launch {
            val bitmap = withContext(Dispatchers.IO) { fetch(url) }
            slots[url] = bitmap?.let { Slot.Img(it) } ?: Slot.Miss
            inFlight.remove(url)
        }
    }

    private fun fetch(url: String): ImageBitmap? =
        try {
            client.newCall(Request.Builder().url(url).build()).execute().use { response ->
                if (!response.isSuccessful) return null
                val bytes = response.body?.bytes() ?: return null
                // A non-image body decodes to null: a miss, so the initial stays (PROTOCOL.md §4).
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
            }
        } catch (e: Exception) {
            // A failed fetch is a miss, not a retry loop (a load error falls back to the initial,
            // first-class like null). The url is never logged: it is opaque identity material.
            null
        }
}

/** The live bridge a puck sits behind: kick the load for `url` (idempotent), and return the cache's
 *  current image for it (null until the first load lands, or forever on a miss). A null url resolves
 *  to null with no load. Reading `cache.image` here subscribes the caller to the snapshot slot, so a
 *  later-arriving image recomposes the puck. Mirrors iOS RosterPuckView's `.task(id:)` + read. */
@Composable
fun rememberAvatarBitmap(cache: AvatarImageCache, url: String?): ImageBitmap? {
    if (url == null) return null
    LaunchedEffect(url) { cache.load(url) }
    return cache.image(url)
}

/** One avatar cache per host that shows a puck (iOS: "This screen mounts outside the room, so it owns
 *  its own instance"). A fresh OkHttpClient shares OkHttp's process-wide pools, so this is cheap. */
@Composable
fun rememberAvatarImageCache(): AvatarImageCache = remember { AvatarImageCache(OkHttpClient()) }
