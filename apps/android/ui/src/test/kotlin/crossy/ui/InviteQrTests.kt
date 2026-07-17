// The QR encoder's module-for-module parity contract (iOS InviteQRTests): the code an Android
// screen shows must be the exact matrix the party projector (apps/web PartyView) and an iPhone
// screen show, so a camera reading one reads them all. The expected matrices below were generated
// by uqr (`encode(text, { ecc: "M", border: 0 })`, uqr 0.1.3) — the same generator the web trusts
// and iOS pins against — so this suite pins the Kotlin port against the shared source of truth, not
// against itself. A divergence is a bug in InviteQr, never a reason to fork the modules.

package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Test

class InviteQrTests {

    private fun rows(vararg lines: String): List<List<Boolean>> =
        lines.map { line -> line.map { it == '1' } }

    private fun assertMatrix(actual: QrMatrix?, version: Int, size: Int, mask: Int, expected: List<List<Boolean>>) {
        assertNotNull(actual, "encoder returned null for a payload within version 40")
        val qr = actual!!
        assertEquals(version, qr.version, "version")
        assertEquals(size, qr.size, "size")
        assertEquals(mask, qr.mask, "auto-selected mask")
        assertEquals(size, qr.modules.size, "row count")
        for (y in 0 until size) {
            assertEquals(
                expected[y].joinToString("") { if (it) "1" else "0" },
                qr.modules[y].joinToString("") { if (it) "1" else "0" },
                "module row $y",
            )
        }
    }

    // The canonical short invite link (ShareInvite.url) is byte mode, ECC M, and uqr chooses
    // version 3, mask 5 for it. Pinned module-for-module against uqr's matrix so the QR ShareQrSheet
    // draws is the projector's and the iPhone's exactly.
    @Test
    fun `pins the invite URL matrix byte-for-byte against uqr (ECC M)`() {
        val expected = rows(
            "11111110010101110111001111111",
            "10000010101110010000101000001",
            "10111010111010101011001011101",
            "10111010101110110110101011101",
            "10111010010111110000101011101",
            "10000010010101101110001000001",
            "11111110101010101010101111111",
            "00000000101001000011000000000",
            "10000010100000110110011001110",
            "01001000111100100000010110110",
            "01110111100110000110110100000",
            "10001000011000111000011011000",
            "11110010110101100011101000001",
            "01010000001011100000111110011",
            "11011110011101111000111101100",
            "11100000001111101011011100101",
            "11110010111100110111010001100",
            "11001101010010001001001110111",
            "11110010101011101101000101001",
            "10010001101110111001101010000",
            "10011011111110001010111110111",
            "00000000110011001110100011000",
            "11111110001001111101101011100",
            "10000010001001000111100010011",
            "10111010000001011101111111010",
            "10111010001011001010110101110",
            "10111010010111000011111111110",
            "10000010001100010000000101101",
            "11111110110101101011000010100",
        )
        assertMatrix(InviteQr.matrix("https://crossy.ing/ABCD2345"), version = 3, size = 29, mask = 5, expected = expected)
    }

    // The empty string: the degenerate version-1 symbol uqr emits (no invite ever shares it, but the
    // encoder must agree here too, or it has forked). uqr chooses version 1, mask 6.
    @Test
    fun `pins the empty-string version-1 matrix against uqr (parity edge)`() {
        val expected = rows(
            "111111101101101111111",
            "100000101101101000001",
            "101110101100101011101",
            "101110100110001011101",
            "101110101101101011101",
            "100000100000001000001",
            "111111101010101111111",
            "000000000000000000000",
            "100111111101010010111",
            "001011011101110111011",
            "001001110101100101001",
            "111111011100111110010",
            "110000110001111111111",
            "000000001010111000111",
            "111111101101000001101",
            "100000101000001000100",
            "101110101110011010110",
            "101110101100111110000",
            "101110100011110111011",
            "100000100101100101011",
            "111111101010110110110",
        )
        assertMatrix(InviteQr.matrix(""), version = 1, size = 21, mask = 6, expected = expected)
    }

    // Byte-mode selection: the invite URL carries lowercase (the scheme, the host), so it is never
    // numeric nor the spec's uppercase alphanumeric set — it takes UTF-8 byte mode, exactly uqr's
    // choice. A version-1 symbol is 21 modules; the URL needs version 3 (29), the size the pin above
    // fixes, so this only guards the mode/version selection stays put as the payload changes.
    @Test
    fun `the invite URL takes byte mode at version 3`() {
        val qr = InviteQr.matrix("https://crossy.ing/ABCD2345")
        assertNotNull(qr)
        assertEquals(29, qr!!.size)
        assertEquals(3, qr.version)
    }
}
