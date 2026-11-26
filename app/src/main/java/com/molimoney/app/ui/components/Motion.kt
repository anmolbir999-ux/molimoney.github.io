package com.molimoney.app.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.molimoney.app.ui.theme.Moli
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

val Ease = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)

/** Fade + rise in, staggered by [index]. */
@Composable
fun Reveal(index: Int = 0, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val a = remember { Animatable(0f) }
    LaunchedEffect(Unit) { delay(70L * index); a.animateTo(1f, tween(620, easing = Ease)) }
    Box(modifier.graphicsLayer {
        alpha = a.value
        translationY = (1f - a.value) * 22.dp.toPx()
    }) { content() }
}

/** Counts a number up from zero (or from its previous value). */
@Composable
fun animatedValue(target: Double, durationMs: Int = 1100): Double {
    val a = remember { Animatable(0f) }
    LaunchedEffect(target) { a.animateTo(target.toFloat(), tween(durationMs, easing = Ease)) }
    return a.value.toDouble()
}

/** Remembers which texts have already streamed this session, so they don't replay every time. */
object Streamed { val seen = mutableSetOf<String>() }

/** Words appear one at a time, like a reply being written. Layout never jumps. */
@Composable
fun StreamText(
    text: String, style: TextStyle, color: Color, modifier: Modifier = Modifier,
    startDelay: Long = 0, perWord: Long = 26, key: String = text,
) {
    val words = remember(text) { text.split(" ") }
    val already = remember(key) { key in Streamed.seen }
    var shown by remember(key) { mutableIntStateOf(if (already) words.size + 3 else 0) }
    LaunchedEffect(key) {
        if (!already) {
            delay(startDelay)
            for (i in 1..words.size + 3) { shown = i; delay(perWord) }
            Streamed.seen += key
        }
    }
    val s = buildAnnotatedString {
        words.forEachIndexed { i, w ->
            val alpha = when { i < shown - 2 -> 1f; i < shown -> 0.55f + 0.45f * (shown - i) / 3f; else -> 0f }
            withStyle(SpanStyle(color = color.copy(alpha = color.alpha * alpha.coerceIn(0f, 1f)))) { append(w) }
            if (i < words.lastIndex) append(" ")
        }
    }
    Text(s, style = style, modifier = modifier)
}

/**
 * The app's mark: a soft starburst of rounded strokes that slowly turns and breathes.
 * When [thinking], the strokes ripple quickly.
 */
@Composable
fun Bloom(size: Dp, thinking: Boolean = false, color: Color = Moli.c.clay, modifier: Modifier = Modifier) {
    val t = rememberInfiniteTransition(label = "bloom")
    val rot by t.animateFloat(0f, 360f, infiniteRepeatable(tween(if (thinking) 3200 else 24000, easing = LinearEasing)), label = "rot")
    val phase by t.animateFloat(0f, (2 * PI).toFloat(), infiniteRepeatable(tween(if (thinking) 1100 else 4200, easing = LinearEasing)), label = "ph")
    val amp by animateFloatAsState(if (thinking) 0.42f else 0.14f, tween(600), label = "amp")
    val base = floatArrayOf(1f, 0.78f, 0.95f, 0.72f, 1f, 0.82f, 0.9f, 0.68f, 0.98f, 0.76f)
    Canvas(modifier.size(size)) {
        val r = min(this.size.width, this.size.height) / 2f
        val ctr = Offset(this.size.width / 2, this.size.height / 2)
        rotate(rot, ctr) {
            for (i in 0 until 10) {
                val ang = (i * 36f - 90f) * (PI / 180f).toFloat()
                val dir = Offset(cos(ang), sin(ang))
                val wob = 0.5f + 0.5f * sin(phase - i * 0.63f)
                val len = r * base[i] * (1f - amp + amp * wob)
                drawLine(color, ctr + dir * (r * 0.16f), ctr + dir * len, strokeWidth = r * 0.17f, cap = StrokeCap.Round)
            }
        }
    }
}

/** Clickable that gently scales down when pressed (no ripple). */
fun Modifier.press(onClick: () -> Unit): Modifier = composed {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val s by animateFloatAsState(if (pressed) 0.965f else 1f, spring(dampingRatio = 0.6f, stiffness = 600f), label = "press")
    this.graphicsLayer { scaleX = s; scaleY = s }.clickable(interactionSource = src, indication = null, onClick = onClick)
}

