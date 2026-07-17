// The email OTP field cap and Verify gate as pure functions (AAD-3, mirrors iOS #230). The captcha-on
// production project issues 8-digit codes, so the field, the copy, and the button gate all count to
// eight; a stale 6 would reject every valid code. These pin the length and the two rules the
// Composable actually uses (sanitizeOtpCode, isOtpCodeComplete), so a future drift is a red check.
// Twin of the iOS ArrivalCopyTests emailOTPCodeLength == 8 assertion.

package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class EmailOtpGateTests {

    @Test
    fun `the OTP length is eight (the captcha-on project's code length, #230)`() {
        assertEquals(8, EMAIL_OTP_CODE_LENGTH)
    }

    @Test
    fun `the field keeps digits only and caps at eight`() {
        // Non-digits stripped, then capped: a paste of a longer or dirty string lands a clean code.
        assertEquals("12345678", sanitizeOtpCode("12ab34 56-789012"))
        assertEquals("12345678", sanitizeOtpCode("123456789"))
        assertEquals("1234", sanitizeOtpCode("1234"))
        assertEquals("", sanitizeOtpCode("abcd"))
    }

    @Test
    fun `Verify is gated on a complete eight-digit code`() {
        assertFalse(isOtpCodeComplete("1234567"), "seven digits is short of the gate")
        assertTrue(isOtpCodeComplete("12345678"), "eight digits opens the gate")
        // The field never yields more than eight (sanitizeOtpCode caps), but the gate is exact so a
        // longer value would not slip through either.
        assertFalse(isOtpCodeComplete("123456789"))
    }
}
