// The OAuth browser leg: open the authorize URL in a Chrome Custom Tab, the Android twin of
// iOS ASWebAuthenticationSession's web hop. Browser and intent concerns live here in :app, never
// in :ui (AAD-2); the redirect comes back through MainActivity's crossy://auth/callback deep link.

package crossy.app

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import okhttp3.HttpUrl

object AuthBrowser {
    /** Open [url] in a Custom Tab, or a plain ACTION_VIEW when no Custom Tabs host resolves (the
     *  CustomTabsIntent itself degrades to a full browser; the catch covers a device with no
     *  browser activity at all). Returns false when nothing could open it, so the host can show
     *  the calm inline reason instead of crashing. */
    fun open(context: Context, url: HttpUrl): Boolean {
        val uri = Uri.parse(url.toString())
        return try {
            CustomTabsIntent.Builder()
                .setShowTitle(true)
                .build()
                .launchUrl(context, uri)
            true
        } catch (e: ActivityNotFoundException) {
            try {
                context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                true
            } catch (e: ActivityNotFoundException) {
                false
            }
        }
    }
}
