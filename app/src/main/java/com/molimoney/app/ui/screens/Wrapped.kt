package com.molimoney.app.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.molimoney.app.data.Store
import com.molimoney.app.logic.Daily
import com.molimoney.app.logic.DaySummary
import com.molimoney.app.ui.components.BubbleShape
import com.molimoney.app.ui.components.Buddy
import com.molimoney.app.ui.components.Ease
import com.molimoney.app.ui.components.PrimaryButton
import com.molimoney.app.ui.components.Reveal
import com.molimoney.app.ui.components.StreamText
import com.molimoney.app.ui.components.animatedValue
import com.molimoney.app.ui.theme.Moli
import com.molimoney.app.ui.theme.Type
import java.time.format.TextStyle as JTextStyle
import java.util.Locale

private val Cream = Color(0xFFFBF7EF)

private data class Slide(val bg: Color, val content: @Composable () -> Unit)

/** Story-style recap of the day. Tap right/left to move, or let it play. */
@Composable
fun WrappedScreen(store: Store, fmt: (Double) -> String, onClose: () -> Unit) {
    val c = Moli.c
    val d = remember(store.txs.toList(), store.settings) { Daily.summarize(store.txs.toList(), store.settings, fmt) }
    val slides = remember(d) { buildSlides(d, fmt) }
    var i by rememberSaveable { mutableIntStateOf(0) }
    val last = slides.size - 1
    val prog = remember { Animatable(0f) }
    LaunchedEffect(i) {
        prog.snapTo(0f)
        prog.animateTo(1f, tween(if (i == last) 600 else 5200, easing = LinearEasing))
        if (i < last) i++
    }
    val bg by animateColorAsState(if (i == last) c.bg else slides[i].bg, tween(500), label = "wbg")
    val fg = if (i == last) c.ink else Cream

    Box(
        Modifier.fillMaxSize().background(bg).pointerInput(slides.size) {
            detectTapGestures { p -> if (p.x < size.width * 0.3f) { if (i > 0) i-- } else if (i < last) i++ }
        },
    ) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 20.dp)) {
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                slides.indices.forEach { k ->
                    Box(Modifier.weight(1f).height(3.dp).clip(CircleShape).background(fg.copy(alpha = 0.25f))) {
                        val f = when { k < i -> 1f; k == i -> prog.value; else -> 0f }
                        Box(Modifier.fillMaxWidth(f).fillMaxHeight().background(fg))
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Moli Wrapped · " + d.date.dayOfWeek.getDisplayName(JTextStyle.FULL, Locale.getDefault()),
                    style = Type.label, color = fg.copy(alpha = 0.8f), modifier = Modifier.weight(1f))
                Box(Modifier.size(36.dp).clip(CircleShape).pointerInput(Unit) { detectTapGestures { onClose() } }, contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.Close, "Close", tint = fg)
                }
            }
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.CenterStart) {
                AnimatedContent(i, transitionSpec = {
                    (fadeIn(tween(450, 120)) + slideInVertically(tween(550, easing = Ease)) { it / 10 }) togetherWith fadeOut(tween(180))
                }, label = "slide") { k ->
                    if (k == last) FinalSlide(d, onClose) else slides[k].content()
                }
            }
        }
    }
}

@Composable
private fun Big(text: String) = Text(text, style = Type.display.copy(fontSize = 54.sp, lineHeight = 60.sp), color = Cream)

@Composable
private fun Small(text: String) = Text(text, style = Type.body.copy(fontSize = 17.sp, lineHeight = 25.sp), color = Cream.copy(alpha = 0.85f))

private fun buildSlides(d: DaySummary, fmt: (Double) -> String): List<Slide> = buildList {
    add(Slide(Color(0xFFD9775A)) {
        Column {
            Reveal(0) { Small("Today you spent") }
            Spacer(Modifier.height(8.dp))
            Reveal(1) { Big(fmt(animatedValue(d.spent, 1500))) }
            Spacer(Modifier.height(8.dp))
            Reveal(3) { Small(if (d.count == 0) "Nothing at all. A no-spend day ✨" else "across ${d.count} purchase${if (d.count == 1) "" else "s"}") }
        }
    })
    d.top?.let { (cat, v) ->
        add(Slide(Color(0xFF3D4A5C)) {
            Column {
                Reveal(0) { Small("Most of it went to") }
                Spacer(Modifier.height(8.dp))
                Reveal(1) { Big(cat.label) }
                Spacer(Modifier.height(8.dp))
                Reveal(2) { Small("${fmt(v)} · ${if (d.spent > 0) (v / d.spent * 100).toInt() else 0}% of the day") }
            }
        })
    }
    if (d.usual > 0) add(Slide(Color(0xFF6E9077)) {
        Column {
            Reveal(0) { Small("Compared with a usual day") }
            Spacer(Modifier.height(24.dp))
            val mx = maxOf(d.everyday, d.usual).coerceAtLeast(1.0)
            Reveal(1) { CompareBar("Today", d.everyday, mx, fmt, Cream) }
            Spacer(Modifier.height(14.dp))
            Reveal(2) { CompareBar("Usual", d.usual, mx, fmt, Cream.copy(alpha = 0.45f)) }
            Spacer(Modifier.height(24.dp))
            Reveal(4) {
                val diff = d.everyday - d.usual
                Small(
                    when {
                        d.everyday == 0.0 -> "Zero extras today. That's ${fmt(d.usual)} kept."
                        diff > 0 -> "${fmt(diff)} more than usual on everyday things."
                        else -> "${fmt(-diff)} less than usual. Nicely done."
                    },
                )
            }
            Spacer(Modifier.height(6.dp))
            Reveal(5) { Text("Everyday spending: rent, bills and subscriptions left out.", style = Type.small, color = Cream.copy(alpha = 0.6f)) }
        }
    })
    d.biggest?.takeIf { d.count > 1 }?.let { b ->
        add(Slide(Color(0xFF2B2A26)) {
            Column {
                Reveal(0) { Small("Biggest single buy") }
                Spacer(Modifier.height(8.dp))
                Reveal(1) { Big(fmt(b.amount)) }
                Spacer(Modifier.height(8.dp))
                Reveal(2) { Small(b.note.ifBlank { b.category.label } + " · " + b.category.label) }
            }
        })
    }
    if (d.monthBudget > 0) add(Slide(Color(0xFFB9853A)) {
        Column {
            Reveal(0) { Small("This month so far") }
            Spacer(Modifier.height(8.dp))
            Reveal(1) { Big(fmt(animatedValue(d.monthSpent, 1400))) }
            Spacer(Modifier.height(4.dp))
            Reveal(2) { Small("of a ${fmt(d.monthBudget)} spending budget") }
            Spacer(Modifier.height(22.dp))
            Reveal(3) {
                val f = (d.monthSpent / d.monthBudget).toFloat().coerceIn(0f, 1f)
                val a = remember { Animatable(0f) }
                LaunchedEffect(Unit) { a.animateTo(f, tween(1300, 300, Ease)) }
                Box(Modifier.fillMaxWidth().height(12.dp).clip(CircleShape).background(Cream.copy(alpha = 0.25f))) {
                    Box(Modifier.fillMaxWidth(a.value).fillMaxHeight().clip(CircleShape).background(Cream))
                }
            }
        }
    })
    add(Slide(Color.Transparent) {}) // final slide is drawn by FinalSlide
}

@Composable
private fun CompareBar(label: String, v: Double, max: Double, fmt: (Double) -> String, col: Color) {
    val a = remember { Animatable(0f) }
    LaunchedEffect(Unit) { a.animateTo((v / max).toFloat().coerceIn(0.02f, 1f), tween(1200, 200, Ease)) }
    Column {
        Row { Text(label, style = Type.small, color = Cream.copy(alpha = 0.8f), modifier = Modifier.weight(1f)); Text(fmt(v), style = Type.small, color = Cream) }
        Spacer(Modifier.height(6.dp))
        Box(Modifier.fillMaxWidth(a.value).height(14.dp).clip(RoundedCornerShape(7.dp)).background(col))
    }
}

@Composable
private fun FinalSlide(d: DaySummary, onClose: () -> Unit) {
    val c = Moli.c
    Column(Modifier.fillMaxWidth()) {
        Reveal(0) { Text("Moli's note for tomorrow", style = Type.title, color = c.ink) }
        Spacer(Modifier.height(24.dp))
        Row(verticalAlignment = Alignment.Top) {
            Reveal(1) { Buddy(92.dp, d.mood) }
            Spacer(Modifier.width(6.dp))
            Reveal(2, Modifier.weight(1f)) {
                Box(Modifier.clip(BubbleShape()).background(c.card).padding(start = 9.dp)) {
                    StreamText(d.advice, Type.body, c.ink, Modifier.padding(16.dp), startDelay = 500, key = "wrap_" + d.date + d.advice.hashCode())
                }
            }
        }
        Spacer(Modifier.height(40.dp))
        Reveal(6) { PrimaryButton("Done", Modifier.fillMaxWidth(), onClick = onClose) }
    }
}

