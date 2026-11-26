package com.molimoney.app.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathOperation
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.molimoney.app.logic.Mood
import com.molimoney.app.ui.theme.Moli
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

private val Skin = Color(0xFFF1CBA8)
private val Hair = Color(0xFF4A3428)
private val Pants = Color(0xFF4A4740)
private val Blush = Color(0xFFE8907A)
private val Face = Color(0xFF2B2622)

/**
 * Moli's little advisor: a small person in a clay sweater with a starburst sprout.
 * Breathes, bobs, blinks; waves when greeting, frowns a little when concerned,
 * and looks up with thought-dots while thinking.
 */
@Composable
fun Buddy(size: Dp, mood: Mood, modifier: Modifier = Modifier) {
    val clay = Moli.c.clay
    val shadow = Moli.c.ink.copy(alpha = 0.10f)
    val t = rememberInfiniteTransition(label = "buddy")
    val bob by t.animateFloat(0f, (2 * PI).toFloat(), infiniteRepeatable(tween(2600, easing = LinearEasing)), label = "bob")
    val blink by t.animateFloat(1f, 1f, infiniteRepeatable(keyframes {
        durationMillis = 4200
        1f at 0; 1f at 3900; 0.08f at 3990; 1f at 4100
    }), label = "blink")
    val wave by t.animateFloat(0f, 1f, infiniteRepeatable(tween(420, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "wave")
    val dots by t.animateFloat(0f, 3.99f, infiniteRepeatable(tween(1500, easing = LinearEasing)), label = "dots")

    val tilt by animateFloatAsState(when (mood) { Mood.THINKING -> 8f; Mood.CONCERNED -> -5f; else -> 0f }, spring(0.6f, 200f), label = "tilt")
    val armUp by animateFloatAsState(if (mood == Mood.WAVE || mood == Mood.THINKING) 1f else 0f, spring(0.55f, 220f), label = "arm")
    val smile by animateFloatAsState(if (mood == Mood.CONCERNED) -1f else if (mood == Mood.THINKING) 0f else 1f, tween(400), label = "smile")
    val look by animateFloatAsState(if (mood == Mood.THINKING) 1f else 0f, tween(400), label = "look")

    Canvas(modifier.size(size, size * 1.3f)) {
        val u = this.size.width / 100f
        fun o(x: Float, y: Float) = Offset(x * u, y * u)
        val lift = sin(bob) * 2.2f

        // ground shadow
        val sw = 40f - lift * 1.5f
        drawOval(shadow, o(50 - sw / 2, 124f), Size(sw * u, 5 * u))

        translate(top = -lift * u) {
            // legs
            drawLine(Pants, o(43f, 100f), o(43f, 119f), 8 * u, StrokeCap.Round)
            drawLine(Pants, o(57f, 100f), o(57f, 119f), 8 * u, StrokeCap.Round)

            // left arm (resting, swings slightly)
            val swing = sin(bob) * 3f
            drawLine(clay.darken(), o(31f, 72f), o(23f + swing * 0.3f, 95f), 8 * u, StrokeCap.Round)
            drawCircle(Skin, 4.6f * u, o(23f + swing * 0.3f, 96f))

            // body (sweater) with gentle breathing
            val breathe = 1f + sin(bob) * 0.012f
            val bw = 46f * breathe
            drawRoundRect(clay, o(50 - bw / 2, 63f), Size(bw * u, 44 * u), CornerRadius(17 * u, 17 * u))
            // collar
            drawArc(clay.darken(), 180f + 25f, 130f, false, o(41f, 58f), Size(18 * u, 12 * u), style = Stroke(2.4f * u, cap = StrokeCap.Round))

            // head
            rotate(tilt, o(50f, 62f)) {
                val hc = o(50f, 38f)
                drawCircle(Skin, 24 * u, hc)
                // hair: a soft bowl cut
                clipRect(bottom = 31f * u) { drawCircle(Hair, 25.5f * u, hc) }
                drawCircle(Hair, 5 * u, o(29f, 33f)); drawCircle(Hair, 5 * u, o(71f, 33f))
                // starburst sprout
                for (a in listOf(-90f, -58f, -122f)) {
                    val r = a * (PI / 180f).toFloat()
                    val base = o(50f, 14.5f)
                    val l = (if (a == -90f) 8.5f else 6.5f) * u
                    drawLine(clay, base, Offset(base.x + cos(r) * l, base.y + sin(r) * l), 2.8f * u, StrokeCap.Round)
                }
                // cheeks
                drawCircle(Blush.copy(alpha = 0.45f), 4.2f * u, o(36f, 47f))
                drawCircle(Blush.copy(alpha = 0.45f), 4.2f * u, o(64f, 47f))
                // eyes
                val ex = look * 1.6f; val ey = -look * 2.2f
                val eh = 6.4f * blink
                drawOval(Face, o(40f - 2.3f + ex, 40.5f - eh / 2 + ey), Size(4.6f * u, eh * u))
                drawOval(Face, o(60f - 2.3f + ex, 40.5f - eh / 2 + ey), Size(4.6f * u, eh * u))
                // brows when concerned
                if (smile < -0.3f) {
                    drawLine(Face, o(36f, 33.5f), o(43f, 31.5f), 1.8f * u, StrokeCap.Round)
                    drawLine(Face, o(64f, 33.5f), o(57f, 31.5f), 1.8f * u, StrokeCap.Round)
                }
                // mouth
                if (mood == Mood.THINKING) {
                    drawCircle(Face, 1.8f * u, o(53f, 51f))
                } else {
                    val p = Path().apply {
                        moveTo(44f * u, 49.5f * u)
                        quadraticTo(50f * u, (49.5f + 6f * smile) * u, 56f * u, 49.5f * u)
                    }
                    drawPath(p, Face, style = Stroke(2.2f * u, cap = StrokeCap.Round))
                }
            }

            // right arm: rest → wave / chin
            val restAng = 70f
            val waveAng = -62f - wave * 30f
            val thinkAng = -150f
            val ang = (if (mood == Mood.THINKING) restAng + (thinkAng - restAng) * armUp else restAng + (waveAng - restAng) * armUp) * (PI / 180f).toFloat()
            val sh = o(69f, 72f)
            val len = 25f * u
            val hand = Offset(sh.x + cos(ang) * len, sh.y + sin(ang) * len)
            drawLine(clay.darken(), sh, hand, 8 * u, StrokeCap.Round)
            drawCircle(Skin, 4.6f * u, hand)

            // thought dots
            if (mood == Mood.THINKING) {
                val n = dots.toInt()
                listOf(o(80f, 22f) to 2.2f, o(87f, 13f) to 3f, o(94f, 4f) to 3.8f).forEachIndexed { i, (p, r) ->
                    if (i < n) drawCircle(clay.copy(alpha = 0.75f), r * u, p)
                }
            }
        }
    }
}

private fun Color.darken(f: Float = 0.88f) = Color(red * f, green * f, blue * f, alpha)

/** Speech-bubble outline with a small tail pointing left, toward the buddy. */
class BubbleShape(private val radius: Dp = 20.dp, private val tail: Dp = 9.dp, private val tailY: Dp = 26.dp) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val r = with(density) { radius.toPx() }
        val t = with(density) { tail.toPx() }
        val ty = with(density) { tailY.toPx() }
        val body = Path().apply { addRoundRect(RoundRect(t, 0f, size.width, size.height, CornerRadius(r, r))) }
        val tri = Path().apply { moveTo(t + 1f, ty - t); lineTo(0f, ty + t * 0.2f); lineTo(t + 1f, ty + t); close() }
        return Outline.Generic(Path.combine(PathOperation.Union, body, tri))
    }
}
