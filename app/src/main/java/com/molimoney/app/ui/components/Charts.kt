package com.molimoney.app.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.unit.dp
import com.molimoney.app.ui.theme.Moli
import kotlin.math.max

private fun smoothPath(pts: List<Offset>): Path = Path().apply {
    if (pts.isEmpty()) return@apply
    moveTo(pts[0].x, pts[0].y)
    for (i in 1 until pts.size) {
        val a = pts[i - 1]; val b = pts[i]; val cx = (a.x + b.x) / 2
        cubicTo(cx, a.y, cx, b.y, b.x, b.y)
    }
}

/**
 * Cumulative spending through the month. Solid line = this month, dashed = last month.
 * Draws itself in, then the latest point breathes.
 */
@Composable
fun SpendLine(current: List<Float>, previous: List<Float>, days: Int, modifier: Modifier = Modifier) {
    val c = Moli.c
    val prog = remember { Animatable(0f) }
    LaunchedEffect(current, previous) { prog.snapTo(0f); prog.animateTo(1f, tween(1500, easing = Ease)) }
    val pulse by rememberInfiniteTransition(label = "pulse")
        .animateFloat(0f, 1f, infiniteRepeatable(tween(2000, easing = LinearEasing)), label = "p")

    Canvas(modifier) {
        val maxV = max(current.maxOrNull() ?: 0f, previous.maxOrNull() ?: 0f).coerceAtLeast(1f) * 1.1f
        val pad = 6.dp.toPx()
        val h = size.height - pad * 2
        fun pt(i: Int, v: Float) = Offset(if (days <= 1) 0f else i / (days - 1f) * size.width, pad + h - v / maxV * h)

        // baseline
        drawLine(c.line, Offset(0f, pad + h), Offset(size.width, pad + h), strokeWidth = 1.dp.toPx())

        val pm = PathMeasure()
        if (previous.size > 1) {
            val p = smoothPath(previous.mapIndexed { i, v -> pt(i, v) })
            pm.setPath(p, false)
            val seg = Path(); pm.getSegment(0f, pm.length * prog.value, seg, true)
            drawPath(seg, c.faint.copy(alpha = 0.7f), style = Stroke(1.6.dp.toPx(), cap = StrokeCap.Round,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 6.dp.toPx()))))
        }
        if (current.isNotEmpty()) {
            val pts = current.mapIndexed { i, v -> pt(i, v) }
            val line = smoothPath(pts)
            // soft fill, revealed left-to-right
            val fill = Path().apply { addPath(line); lineTo(pts.last().x, pad + h); lineTo(pts.first().x, pad + h); close() }
            clipRect(right = pts.last().x * prog.value + 1f) {
                drawPath(fill, Brush.verticalGradient(listOf(c.clay.copy(alpha = 0.16f), c.clay.copy(alpha = 0f)), startY = pad, endY = pad + h))
            }
            pm.setPath(line, false)
            val seg = Path(); pm.getSegment(0f, pm.length * prog.value, seg, true)
            drawPath(seg, c.clay, style = Stroke(2.4.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
            if (prog.value > 0.97f) {
                val e = pts.last()
                drawCircle(c.clay.copy(alpha = (1f - pulse) * 0.3f), radius = 4.dp.toPx() + 12.dp.toPx() * pulse, center = e)
                drawCircle(c.clay, 4.5.dp.toPx(), e)
                drawCircle(c.card, 2.dp.toPx(), e)
            }
        }
    }
}

/** Thin ring split by category; sweeps around on appear. */
@Composable
fun Donut(parts: List<Pair<Color, Float>>, modifier: Modifier = Modifier, center: @Composable BoxScope.() -> Unit = {}) {
    val c = Moli.c
    val prog = remember { Animatable(0f) }
    LaunchedEffect(parts) { prog.snapTo(0f); prog.animateTo(1f, tween(1300, easing = Ease)) }
    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(Modifier.matchParentSize()) {
            val stroke = 9.dp.toPx()
            val d = size.minDimension - stroke
            val tl = Offset((size.width - d) / 2, (size.height - d) / 2)
            drawArc(c.line, 0f, 360f, false, tl, Size(d, d), style = Stroke(stroke))
            val total = parts.sumOf { it.second.toDouble() }.toFloat()
            if (total <= 0f) return@Canvas
            val gap = if (parts.size > 1) 2.5f else 0f
            var start = -90f
            val limit = 360f * prog.value
            var drawn = 0f
            parts.forEach { (col, v) ->
                val sweep = v / total * 360f
                val visible = (limit - drawn).coerceIn(0f, sweep)
                if (visible > gap) drawArc(col, start + gap / 2, visible - gap, false, tl, Size(d, d), style = Stroke(stroke, cap = StrokeCap.Butt))
                start += sweep; drawn += sweep
            }
        }
        center()
    }
}

/** Rounded vertical bars that grow in one after another. */
@Composable
fun Bars(values: List<Float>, highlight: Int, modifier: Modifier = Modifier) {
    val c = Moli.c
    val prog = remember { Animatable(0f) }
    LaunchedEffect(values) { prog.snapTo(0f); prog.animateTo(1f, tween(1200, easing = LinearEasing)) }
    Canvas(modifier) {
        val n = values.size
        if (n == 0) return@Canvas
        val maxV = (values.maxOrNull() ?: 1f).coerceAtLeast(1f)
        val slot = size.width / n
        val w = slot * 0.36f
        values.forEachIndexed { i, v ->
            val local = ((prog.value * (n + 3) - i) / 3f).coerceIn(0f, 1f)
            val eased = Ease.transform(local)
            val bh = (v / maxV * size.height).coerceAtLeast(w) * eased
            val x = slot * i + (slot - w) / 2
            drawRoundRect(if (i == highlight) c.clay else c.line, Offset(x, size.height - bh), Size(w, bh), CornerRadius(w / 2, w / 2))
        }
    }
}

/** A single horizontal bar split into segments (e.g. needs / wants / saved). */
@Composable
fun SplitBar(parts: List<Pair<Color, Float>>, modifier: Modifier = Modifier) {
    val prog = remember { Animatable(0f) }
    LaunchedEffect(parts) { prog.snapTo(0f); prog.animateTo(1f, tween(1200, easing = Ease)) }
    val c = Moli.c
    Canvas(modifier) {
        val total = parts.sumOf { it.second.toDouble() }.toFloat()
        val r = size.height / 2
        drawRoundRect(c.line, cornerRadius = CornerRadius(r, r))
        if (total <= 0f) return@Canvas
        val gap = 3.dp.toPx()
        var x = 0f
        val avail = size.width - gap * (parts.count { it.second > 0 } - 1).coerceAtLeast(0)
        parts.filter { it.second > 0 }.forEach { (col, v) ->
            val w = v / total * avail * prog.value
            drawRoundRect(col, Offset(x, 0f), Size(w, size.height), CornerRadius(r, r))
            x += w + gap
        }
    }
}
