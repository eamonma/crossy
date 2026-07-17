// The camera half of the join panel (AAD-2, the app-target twin of iOS's CameraScan.swift): the
// permission verdict and the live preview live here, because CameraX and PreviewView are platform
// pieces, not :ui's (the same layering that keeps WebViewTurnstileMinter in :app). :ui's
// JoinCodeScreen takes a JoinScanState verdict and a scanner slot and renders the chrome; this file
// resolves the verdict and fills the slot.
//
// Two pieces:
//   - rememberJoinScanState(): resolves whether scanning can happen — a camera exists and the person
//     allowed it (asking once when the question was never put) — mapped to JoinScanState. A device
//     with no camera, or a refusal, resolves DENIED and the panel stands on its typed path.
//   - CameraScanView(): one back-camera preview filling the viewport, an ImageAnalysis reading QR
//     off each frame's luminance plane. Payloads are throttled (the same code lingering in frame
//     emits at most once a second) and delivered on the main thread; JoinCodeScreen's ingest owns
//     dedupe against attempts, this layer only stops the firehose.
//
// Decode path: zxing-core (a pure JVM jar) over the Y plane, NOT Play-services ML Kit. ML Kit would
// drag in the Google-services plugin and a Play-services dependency onto an app that otherwise needs
// neither; zxing is a small jar that reads a QR off a luminance buffer in a few lines, and the code
// is dark-on-light and centered (the projector's rule), the easy case zxing handles well. If a
// future need (data-matrix, low light) outgrows zxing, ML Kit is the documented next step.

package crossy.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.os.Handler
import android.os.Looper
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.ReaderException
import com.google.zxing.common.HybridBinarizer
import crossy.ui.JoinScanState
import java.util.concurrent.Executors

private fun cameraGranted(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

/**
 * Resolve whether the join panel can scan right now (iOS CameraScanAuthority.resolve, as Compose
 * state). A device with no camera resolves DENIED at once. Otherwise: LIVE if the person already
 * allowed it, else PROBING while the one permission prompt is out, settling to LIVE or DENIED on the
 * answer. Asked once per entry; a refusal is honest and final for this screen (the field still
 * stands beneath it).
 */
@Composable
fun rememberJoinScanState(): JoinScanState {
    val context = LocalContext.current
    val hasCamera = remember {
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
    }
    var state by remember {
        mutableStateOf(
            when {
                !hasCamera -> JoinScanState.DENIED
                cameraGranted(context) -> JoinScanState.LIVE
                else -> JoinScanState.PROBING
            },
        )
    }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        state = if (granted) JoinScanState.LIVE else JoinScanState.DENIED
    }
    LaunchedEffect(Unit) {
        if (hasCamera && !cameraGranted(context)) launcher.launch(Manifest.permission.CAMERA)
    }
    return state
}

/**
 * One back-camera preview filling the viewport (aspect-fill, the viewport clips), an ImageAnalysis
 * reading QR off each frame. A payload takes JoinCodeScreen's [onScan] ingest, hopped to the main
 * thread (the analyzer runs on its own executor; Compose state is main-only). The session binds to
 * the composition's lifecycle and unbinds when the viewport leaves, so leaving the screen releases
 * the camera.
 */
@Composable
fun CameraScanView(onScan: (String) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val latestOnScan by rememberUpdatedState(onScan)
    val previewView = remember {
        PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
    }
    val mainHandler = remember { Handler(Looper.getMainLooper()) }

    DisposableEffect(lifecycleOwner, previewView) {
        val executor = Executors.newSingleThreadExecutor()
        val future = ProcessCameraProvider.getInstance(context)
        val analyzer = QrScanAnalyzer { payload -> mainHandler.post { latestOnScan(payload) } }
        future.addListener({
            val provider = runCatching { future.get() }.getOrNull() ?: return@addListener
            val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also { it.setAnalyzer(executor, analyzer) }
            runCatching {
                provider.unbindAll()
                provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            }
        }, ContextCompat.getMainExecutor(context))
        onDispose {
            runCatching { future.get().unbindAll() }
            executor.shutdown()
        }
    }

    AndroidView(factory = { previewView }, modifier = modifier)
}

/**
 * The QR metadata delegate (iOS's CameraScanView.Coordinator): decode QR off a frame's luminance
 * plane with zxing, throttle a lingering code to one emit a second, hand the raw payload up. Dedupe
 * against join attempts is JoinCodeScreen's; this only stops the per-frame firehose.
 */
private class QrScanAnalyzer(private val onQr: (String) -> Unit) : ImageAnalysis.Analyzer {
    private val reader = MultiFormatReader().apply {
        setHints(mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE)))
    }
    private var lastPayload: String? = null
    private var lastEmit = 0L

    override fun analyze(image: ImageProxy) {
        val payload = try {
            decode(image)
        } finally {
            image.close()
        }
        if (payload == null) return
        val now = System.currentTimeMillis()
        if (payload == lastPayload && now - lastEmit < THROTTLE_MS) return
        lastPayload = payload
        lastEmit = now
        onQr(payload)
    }

    private fun decode(image: ImageProxy): String? {
        if (image.format != ImageFormat.YUV_420_888) return null
        val plane = image.planes[0]
        val buffer = plane.buffer
        val data = ByteArray(buffer.remaining())
        buffer.get(data)
        // The Y plane may be row-padded, so its stride is the data width; the crop stays the image's
        // real width and height. zxing reads only luminance, exactly what QR decoding needs.
        val source = PlanarYUVLuminanceSource(
            data,
            plane.rowStride,
            image.height,
            0,
            0,
            image.width,
            image.height,
            false,
        )
        val bitmap = BinaryBitmap(HybridBinarizer(source))
        return try {
            reader.decodeWithState(bitmap).text
        } catch (_: ReaderException) {
            null
        } finally {
            reader.reset()
        }
    }

    private companion object {
        const val THROTTLE_MS = 1000L
    }
}
