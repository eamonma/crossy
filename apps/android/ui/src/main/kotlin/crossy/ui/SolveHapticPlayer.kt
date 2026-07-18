// The solve haptics player: the Vibrator-and-View-backed twin of iOS SolveHaptics.swift's generator
// class (SolveHaptics.kt holds the pure grammar and stays JVM-pure for headless tests; the platform
// rendering lives here). It renders each SolveHaptic the fold derives, and the deck's per-press tick,
// into a concrete Android effect.
//
// The mapping (DESIGN.md §7; tuned on hardware in the I2e pass). Android has no continuous UIImpact
// intensity analog on the system-gated feedback rail, so the single-pulse moments map to the nearest
// HapticFeedbackConstants and the tuning INTENSITIES order them by choice of constant, not amplitude;
// the two multi-beat patterns render through the Vibrator, where the tuning amplitudes are
// load-bearing. Divergences from iOS are noted per case.
//
//   TRAVEL_TICK     -> performHapticFeedback(CLOCK_TICK)   (iOS UIImpact .light @0.6: a light tick)
//   WORD_THUD       -> performHapticFeedback(LONG_PRESS)   (iOS .soft @1.0: a firmer single thud)
//   REACTION_SENT   -> performHapticFeedback(KEYBOARD_TAP) (iOS .light @0.7: a crisp confirm)
//   REACTION_LANDED -> performHapticFeedback(CLOCK_TICK)   (iOS .soft @0.5: the softest tap)
//   CHECK_LANDED    -> Vibrator single beat at the 0.8 amplitude (iOS thud @0.8: one soft thud, the
//                      room-event register weighted up; the amplitude is load-bearing, so it rides
//                      the Vibrator rather than the constant rail that cannot express it)
//   DOUBLE_TICK     -> Vibrator waveform, two beats with the 90ms gap at the 0.8 amplitude
//   COMPLETION      -> Vibrator waveform, a distinct rising two-beat (the analog of iOS's
//                      UINotification .success; Android has no notification-success primitive)
//   key press tick  -> performHapticFeedback(KEYBOARD_TAP) (iOS KeyHaptics UIImpact .light per press)
//
// Respecting the system's haptic settings by construction: the single-pulse rail runs through
// View.performHapticFeedback, which the platform gates on the view's and the system's haptic-feedback
// setting with no help from us. The two Vibrator patterns carry USAGE_TOUCH attributes (API 33+) or
// the sonification AudioAttributes below, the closest each floor offers to that same gate.

package crossy.ui

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView

/** Renders the solve's haptic grammar (the fold's moments) and the deck's per-press tick. One
 *  instance per room; the composition root builds it from the live View and Vibrator. */
interface SolveHapticPlayer {
    /** Render one board moment (SolveHaptic.COMPLETION included; the room fires it off the INV-3 gate). */
    fun play(haptic: SolveHaptic)

    /** The deck's per-key tick, fired at touch-DOWN (iOS KeyHaptics.tick), a light confirm gated by
     *  the system's haptic setting. */
    fun keyTick()

    companion object {
        /** The inert player: previews, the demo room, and any composition with no View. */
        val NONE: SolveHapticPlayer = object : SolveHapticPlayer {
            override fun play(haptic: SolveHaptic) {}
            override fun keyTick() {}
        }
    }
}

/** The platform player. The single-pulse moments run through the View (system-gated); the two
 *  multi-beat patterns run through the Vibrator with the tuning amplitudes. */
internal class AndroidSolveHapticPlayer(
    private val view: View,
    private val vibrator: Vibrator?,
) : SolveHapticPlayer {

    override fun play(haptic: SolveHaptic) {
        when (haptic) {
            SolveHaptic.TRAVEL_TICK -> view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
            SolveHaptic.WORD_THUD -> view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            SolveHaptic.REACTION_SENT -> view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
            SolveHaptic.REACTION_LANDED -> view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
            SolveHaptic.CHECK_LANDED -> vibrate(checkLandedWaveform())
            SolveHaptic.DOUBLE_TICK -> vibrate(doubleTickWaveform())
            SolveHaptic.COMPLETION -> vibrate(completionWaveform())
            // The vote ceremony (D32): open is a firm click, a ballot a light tick, the pass a
            // success-shaped double timed to the wash, the fail two soft ticks.
            SolveHaptic.VOTE_OPENED -> vibrate(voteOpenedWaveform())
            SolveHaptic.VOTE_BALLOT -> view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
            SolveHaptic.VOTE_PASSED -> vibrate(votePassedWaveform())
            SolveHaptic.VOTE_FAILED -> vibrate(voteFailedWaveform())
        }
    }

    override fun keyTick() {
        view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
    }

    /** Play a waveform on the touch rail so the system's haptic setting still gates it: VibrationAttributes
     *  USAGE_TOUCH on API 33+, the sonification AudioAttributes below (the closest each floor offers). */
    private fun vibrate(effect: VibrationEffect) {
        val vib = vibrator ?: return
        if (!vib.hasVibrator()) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            vib.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH))
        } else {
            @Suppress("DEPRECATION")
            vib.vibrate(
                effect,
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
        }
    }

    /** The room check's landing (D27): one soft thud at the 0.8 amplitude, a single deliberate beat,
     *  distinct from the local word thud's constant and the sticker's tick (iOS's thud @0.8). */
    private fun checkLandedWaveform(): VibrationEffect {
        val amp = amplitude(SolveHapticTuning.CHECK_LANDED_INTENSITY)
        return waveform(longArrayOf(0L, BEAT_MS), intArrayOf(0, amp))
    }

    /** The double tick: a beat, the 90ms gap, a beat, at the 0.8 amplitude (the iOS two-`tick` play). */
    private fun doubleTickWaveform(): VibrationEffect {
        val gap = SolveHapticTuning.DOUBLE_TICK_GAP_MILLISECONDS.toLong()
        val timings = longArrayOf(0L, BEAT_MS, gap, BEAT_MS)
        val amp = amplitude(SolveHapticTuning.DOUBLE_TICK_INTENSITY)
        return waveform(timings, intArrayOf(0, amp, 0, amp))
    }

    /** The completion pattern: a distinct rising two-beat, unmistakably not a tick or a thud, standing
     *  in for iOS's UINotification .success (which Android has no primitive for). */
    private fun completionWaveform(): VibrationEffect {
        val timings = longArrayOf(0L, 26L, 70L, 30L, 44L, 70L)
        val amps = intArrayOf(0, amplitude(0.55), 0, amplitude(0.8), 0, amplitude(1.0))
        return waveform(timings, amps)
    }

    /** The vote open (D32): one firm click, heavier than the check thud, the call of the ceremony. */
    private fun voteOpenedWaveform(): VibrationEffect =
        waveform(longArrayOf(0L, BEAT_MS), intArrayOf(0, amplitude(0.95)))

    /** The vote passed (D32): a success-shaped rising double, timed by the caller to the wash start;
     *  lighter than the game-completion pattern (a check is not the solve). */
    private fun votePassedWaveform(): VibrationEffect =
        waveform(longArrayOf(0L, 22L, 60L, 30L), intArrayOf(0, amplitude(0.7), 0, amplitude(0.95)))

    /** The vote failed or cancelled (D32): two soft ticks, quieter than the pass, a gentle "not now." */
    private fun voteFailedWaveform(): VibrationEffect {
        val gap = SolveHapticTuning.DOUBLE_TICK_GAP_MILLISECONDS.toLong()
        return waveform(longArrayOf(0L, BEAT_MS, gap, BEAT_MS), intArrayOf(0, amplitude(0.4), 0, amplitude(0.4)))
    }

    /** Build a waveform, honoring the tuning amplitudes when the motor supports them and falling back
     *  to the on/off timing pattern when it does not. */
    private fun waveform(timings: LongArray, amplitudes: IntArray): VibrationEffect {
        val vib = vibrator
        return if (vib != null && vib.hasAmplitudeControl()) {
            VibrationEffect.createWaveform(timings, amplitudes, -1)
        } else {
            VibrationEffect.createWaveform(timings, -1)
        }
    }

    /** A tuning intensity (0..1) as a Vibrator amplitude (1..255); 0 stays 0 (a rest). */
    private fun amplitude(intensity: Double): Int =
        if (intensity <= 0.0) 0 else (intensity * 255).toInt().coerceIn(1, 255)

    private companion object {
        /** A single beat's on-duration: short enough to read as a tap, long enough for the motor to speak. */
        const val BEAT_MS = 18L
    }
}

/** One player over the current View and the system Vibrator, remembered for the room's life. The
 *  View feeds the system-gated feedback rail; the Vibrator the two multi-beat patterns. */
@Composable
fun rememberSolveHapticPlayer(): SolveHapticPlayer {
    val view = LocalView.current
    val context = LocalContext.current
    return remember(view) { AndroidSolveHapticPlayer(view, systemVibrator(context)) }
}

/** The system Vibrator, through the VibratorManager on API 31+ and the legacy service below. */
private fun systemVibrator(context: Context): Vibrator? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }
