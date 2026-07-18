// The completion share card's public artifact (design/post-game/SHARE.md; PROTOCOL.md §12
// `GET /s/{token}/card.png`). The server is the single visual source of truth: it rasterizes the
// SAME @crossy/share-card builder the web client uses, so the client never renders a native card.
// This object is the pure string logic the app rides to reach that artifact: the card PNG URL from a
// minted `shareUrl`, and the file name the download wears in the system share sheet.
//
// It lives in :api (a JVM-pure, CI-tested module), NOT in :app: android.yml builds only the six pure
// modules (ARCHITECTURE.md §CI), so decision-shaped logic put in :app would ship untested. Nothing
// here touches an Android type or the network; the download and the share intent are :app's, over
// this pure contract. No solution content is in reach (INV-6): the inputs are a URL and a ground.

package crossy.api

/** The completion share card's URL contract and its download name. Pure and dependency-free. */
public object ShareCard {
    /**
     * The card's ground, following the app's current theme (Studio -> [LIGHT], Observatory ->
     * [DARK]; SHARE.md's two brand grounds). Modeled as a small enum with the exact wire token the
     * `card.png` query reads, so the :app edge maps its `GridGround` onto this without dragging a
     * :design type into this pure module (the AAD-1 graph: :api imports :protocol only).
     */
    public enum class Ground(public val wire: String) {
        LIGHT("light"),
        DARK("dark"),
    }

    /**
     * The server-rendered card PNG URL for a minted share link. `shareUrl` is exactly the value the
     * mint returned (`{share-origin}/s/{token}`, e.g. `https://crossy.ing/s/{token}`); the card is
     * its `/card.png` sibling with the variant and the ground as query. Portrait is the only variant
     * a client requests (the flagship poster; SHARE.md's layout contract). The endpoint is public
     * (no bearer) and immutable-cached, so the app fetches it with a plain GET.
     *
     * A trailing slash on `shareUrl` is trimmed so the path never doubles up; the contract is built
     * verbatim otherwise, since the mint owns the origin and the token.
     */
    public fun pngUrl(shareUrl: String, ground: Ground): String {
        val base = shareUrl.trimEnd('/')
        return "$base/card.png?variant=portrait&ground=${ground.wire}"
    }

    /**
     * The downloaded card's file name for the system share sheet: a stable human label, no token and
     * no clock, so a save-to-files keeps a readable name and two shares of the same card do not
     * multiply files. The card is a PNG (SHARE.md; the endpoint's `image/png`).
     */
    public const val FILE_NAME: String = "crossy-card.png"
}
