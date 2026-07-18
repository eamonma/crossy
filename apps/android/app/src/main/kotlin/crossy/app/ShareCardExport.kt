// The completion share card's :app-side plumbing (design/post-game/SHARE.md; Wave 14.6): download the
// SERVER-rendered card PNG (the single visual source of truth; no native renderer) and expose it to
// the system share sheet through a narrowly-scoped FileProvider. The pure card URL and file name live
// in :api (ShareCard); this file owns the platform acts :ui cannot (the network, the file, the content
// Uri), the same AAD-2 split the AvatarImageCache and the Turnstile minter hold.
//
// INV-6: no solution content is in reach here either. The card endpoint is public and immutable-cached,
// so the download rides no bearer; a failure throws, and the composition root resolves it quietly.

package crossy.app

import android.content.Context
import android.net.Uri
import androidx.core.content.FileProvider
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException

/**
 * Fetch the server-rendered card PNG and hand back a shareable content Uri. Blocking (call off the main
 * thread): one public GET, then the bytes to a file in the share cache, then a FileProvider Uri the
 * chooser can read. The subdir matches `res/xml/file_paths.xml` (`share-cards/` under the cache dir),
 * so the provider grants exactly this one folder, nothing else of the app's storage.
 */
object ShareCardExport {
    /** The FileProvider authority, `{applicationId}.fileprovider`, matching the manifest `<provider>`.
     *  applicationId equals the package name here (no per-flavor suffix), so the package name resolves
     *  it. */
    private fun authority(context: Context): String = "${context.packageName}.fileprovider"

    /** The one cache subdir the provider is scoped to. */
    private const val SHARE_DIR = "share-cards"

    /**
     * Download [cardUrl] and write it to [fileName] in the share cache, returning the content Uri for
     * `Intent.EXTRA_STREAM`. Throws [IOException] on a non-2xx or an empty body, so the caller's
     * runCatching swallows a mint-gated 404, offline weather, or a transient card failure alike.
     */
    fun download(
        context: Context,
        client: OkHttpClient,
        cardUrl: String,
        fileName: String,
    ): Uri {
        val request = Request.Builder()
            .url(cardUrl)
            .header("Accept", "image/png")
            .build()
        val bytes = client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("card ${response.code}")
            response.body?.bytes() ?: throw IOException("empty card body")
        }
        val dir = File(context.cacheDir, SHARE_DIR).apply { mkdirs() }
        val file = File(dir, fileName)
        file.writeBytes(bytes)
        return FileProvider.getUriForFile(context, authority(context), file)
    }
}
