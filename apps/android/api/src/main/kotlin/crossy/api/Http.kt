// OkHttp-to-coroutines bridge, shared by the REST client and the Supabase auth leg. OkHttp's
// Call is callback-based; this suspends over enqueue so a cancelled coroutine cancels the call
// and no request thread is blocked. Twin of the URLSession async `data(for:)` the iOS side rides.

package crossy.api

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Response
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** The one content type every JSON request body carries. */
internal val JSON_MEDIA_TYPE = "application/json".toMediaType()

/** Await one OkHttp call. An [IOException] (network weather) propagates; the caller maps it to
 *  its own transport case. Cancelling the coroutine cancels the call. */
internal suspend fun Call.await(): Response =
    suspendCancellableCoroutine { continuation ->
        continuation.invokeOnCancellation { runCatching { cancel() } }
        enqueue(object : Callback {
            override fun onResponse(call: Call, response: Response) {
                continuation.resume(response)
            }

            override fun onFailure(call: Call, e: IOException) {
                if (continuation.isCancelled) return
                continuation.resumeWithException(e)
            }
        })
    }
